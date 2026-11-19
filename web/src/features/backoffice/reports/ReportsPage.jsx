import { useEffect, useMemo, useState } from 'react'
import { getBranchReport, getDailyReport, listPayments } from '../../../api/payment'
import { listApprovals } from '../../../api/pos'
import { hhmm, thb } from '../../../lib/posUtils'
import GroupedBarChart from '../GroupedBarChart'
import { OTHER_COLOR, SERIES_COLORS } from '../seriesColors'
import { errorText, todayTh, useBranchScope } from '../useBranchScope'
import '../../../styles/pos.css'

// แดชบอร์ด (หลังร้าน) — 1.34–1.36
// - manager หรือ owner ที่เลือกสาขา: แดชบอร์ดสาขา (Overview)
// - owner เลือก "ทุกสาขา": แดชบอร์ดรวม + เปรียบเทียบสาขา (OwnerOverview) · กำไรรายเดือนอยู่หน้า /admin/profit
// ยอดขาย = เงินที่รับ (รวม VAT) จาก payment · เมนูขายดีจาก pos ผ่านรายงานรายวัน
// กราฟ: วันนี้ = รวมรายการรับเงินรายชั่วโมง · 7/30 วัน = ยอดขายรายวันจากรายงานรายวัน

const REFRESH_MS = 60_000
const PAGE = 100
const MAX_PAGES = 20 // วันนี้ไม่เกิน 2,000 บิล
const DAY_CONCURRENCY = 5

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const dayLabel = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`
const longDate = (d) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(0, 4)) + 543}`

/** 'YYYY-MM-DD' ย้อนหลัง n วัน */
function shiftDate(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString().slice(0, 10)
}

/** ทำงานพร้อมกันไม่เกิน limit */
async function mapLimit(list, limit, fn) {
  const out = new Array(list.length)
  let i = 0
  async function worker() {
    while (i < list.length) {
      const idx = i++
      out[idx] = await fn(list[idx], idx)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker))
  return out
}

/** ยอดรับเงินวันนี้แยกรายชั่วโมง (เวลาตามเครื่อง = เวลาไทย) */
async function hourlySales(date, branchId) {
  const payments = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await listPayments({ date, type: 'charge', page, limit: PAGE, branch_id: branchId })
    payments.push(...(res.data || []))
    if (payments.length >= (res.meta?.total ?? 0) || !(res.data || []).length) break
  }
  const byHour = new Map()
  for (const p of payments) {
    const h = new Date(p.paid_at).getHours()
    byHour.set(h, (byHour.get(h) || 0) + Number(p.amount))
  }
  // ช่วงเปิดร้านปกติ 10–21 น. + ชั่วโมงที่มียอดนอกช่วง
  const hours = [...new Set([...Array.from({ length: 12 }, (_, i) => i + 10), ...byHour.keys()])].sort((a, b) => a - b)
  return hours.map((h) => ({ key: String(h), label: `${String(h).padStart(2, '0')}:00`, value: Math.round((byHour.get(h) || 0) * 100) / 100 }))
}

async function dailySales(days, branchId) {
  const today = todayTh()
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, days - 1 - i))
  const rows = await mapLimit(dates, DAY_CONCURRENCY, (date) => getDailyReport({ date, branch_id: branchId }).catch(() => null))
  return dates.map((d, i) => ({ key: d, label: dayLabel(d), value: Number(rows[i]?.sales ?? 0) }))
}

function Delta({ now, before, unit = '%', suffix = 'จากเมื่อวาน' }) {
  if (before == null) return <span className="pos-kpi-sub">&nbsp;</span>
  if (unit === '%') {
    if (!before) return <span className="pos-kpi-sub">{now ? 'เมื่อวานไม่มียอด' : 'ยังไม่มียอด'}</span>
    const pct = Math.round(((now - before) / before) * 100)
    return (
      <span className={`pos-kpi-sub ${pct >= 0 ? 'is-ok' : 'is-danger'}`}>
        {pct >= 0 ? '+' : ''}
        {pct}% {suffix}
      </span>
    )
  }
  const diff = now - before
  return (
    <span className={`pos-kpi-sub ${diff >= 0 ? 'is-ok' : 'is-danger'}`}>
      {diff >= 0 ? '+' : ''}
      {diff} {unit} {suffix}
    </span>
  )
}

export default function ReportsPage() {
  const scope = useBranchScope({ allowAll: true })
  const { isOwner, canManage, branches, branchId, ready, branchName } = scope
  const allBranches = isOwner && !branchId

  if (scope.me && !canManage) {
    return (
      <div className="pos-page">
        <div className="pos-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">{allBranches ? 'แดชบอร์ดรวมทุกสาขา' : 'แดชบอร์ดสาขา'}</h1>
          <p className="pos-subtitle">
            {branchId ? `สาขา${branchName(branchId)}` : 'ทุกสาขา'} · วันนี้ {longDate(todayTh())} {allBranches ? '(1.36)' : '(1.34–1.35)'}
          </p>
        </div>
        {isOwner && (
          <select className="pos-input pos-select-sm" value={branchId} onChange={(e) => scope.setBranchId(e.target.value)} aria-label="สาขา">
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {scope.error && <div className="pos-alert">{scope.error}</div>}

      {ready && (allBranches ? <OwnerOverview branches={branches} /> : <Overview key={branchId} branchId={branchId} />)}
    </div>
  )
}

const pctDelta = (now, before) => (before ? Math.round(((now - before) / before) * 100) : null)

/** owner · ทุกสาขา: ตัวเลขรวม กราฟ 7 วันแยกสาขา และตารางเปรียบเทียบสาขาวันนี้ (1.36) */
function OwnerOverview({ branches }) {
  const today = todayTh()
  const [state, setState] = useState({ today: null, yesterday: null, approvals: null, tops: new Map(), error: '', at: null })
  const [week, setWeek] = useState(null) // [{ date, rows }]

  useEffect(() => {
    let cancelled = false
    const load = () =>
      Promise.all([
        getBranchReport({ from: today, to: today }),
        getBranchReport({ from: shiftDate(today, 1), to: shiftDate(today, 1) }).catch(() => null),
        listApprovals({ status: 'pending' }).catch(() => null),
        // เมนูขายดีอันดับ 1 ของแต่ละสาขา
        mapLimit(branches, DAY_CONCURRENCY, (b) => getDailyReport({ date: today, branch_id: b.id }).catch(() => null)),
      ])
        .then(([t, y, a, daily]) => {
          if (cancelled) return
          const tops = new Map(branches.map((b, i) => [b.id, daily[i]?.top_menus?.[0]?.menu_name || null]))
          setState({ today: t, yesterday: y, approvals: a, tops, error: '', at: new Date() })
        })
        .catch((err) => !cancelled && setState((s) => ({ ...s, error: errorText(err) })))
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [today, branches])

  useEffect(() => {
    let cancelled = false
    const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, 6 - i))
    mapLimit(dates, DAY_CONCURRENCY, (d) => getBranchReport({ from: d, to: d }).catch(() => null)).then(
      (rows) => !cancelled && setWeek(dates.map((date, i) => ({ date, rows: rows[i]?.branches || [] }))),
    )
    return () => {
      cancelled = true
    }
  }, [today])

  const t = state.today
  const y = state.yesterday
  const byBranch = (report, id) => report?.branches?.find((b) => b.branch_id === id)

  // สี/ชุดข้อมูลตามลำดับสาขา · เกิน 4 สาขารวมเป็น "สาขาอื่น"
  const shown = branches.slice(0, branches.length > 4 ? 3 : 4)
  const rest = branches.length > 4 ? branches.slice(3) : []
  const series = [
    ...shown.map((b, i) => ({ key: b.id, label: b.name, color: SERIES_COLORS[i] })),
    ...(rest.length ? [{ key: 'other', label: `สาขาอื่น (${rest.length})`, color: OTHER_COLOR }] : []),
  ]
  const colorOf = new Map(series.map((s) => [s.key, s.color]))
  const weekValues = useMemo(() => {
    if (!week) return null
    const values = Object.fromEntries(series.map((s) => [s.key, []]))
    for (const day of week) {
      for (const s of series) {
        const ids = s.key === 'other' ? rest.map((b) => b.id) : [s.key]
        values[s.key].push(day.rows.filter((r) => ids.includes(r.branch_id)).reduce((sum, r) => sum + Number(r.net_sales || 0), 0))
      }
    }
    return values
    // series/rest มาจาก branches
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [week, branches])

  const pending = state.approvals
  const totalNow = t?.total
  const totalBefore = y?.total

  return (
    <>
      {state.error && <div className="pos-alert">{state.error}</div>}

      <div className="pos-kpis is-4">
        <div className="pos-kpi">
          <span className="pos-kpi-label">ยอดขายวันนี้ ({branches.length} สาขา)</span>
          <strong className="pos-kpi-value">{totalNow ? thb(totalNow.net_sales) : '–'}</strong>
          {totalNow ? <Delta now={totalNow.net_sales} before={totalBefore?.net_sales} /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">จำนวนบิล</span>
          <strong className="pos-kpi-value">{totalNow ? totalNow.bill_count : '–'}</strong>
          {totalNow ? <Delta now={totalNow.bill_count} before={totalBefore?.bill_count} unit="บิล" /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">ยอดเฉลี่ยต่อบิล</span>
          <strong className="pos-kpi-value">{totalNow ? thb(Math.round(totalNow.avg_per_bill)) : '–'}</strong>
          {totalNow ? <Delta now={totalNow.avg_per_bill} before={totalBefore?.avg_per_bill} /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">คำขอรออนุมัติ</span>
          <strong className="pos-kpi-value">{pending ? pending.length : '–'}</strong>
          <span className="pos-kpi-sub is-ok">{pending ? 'รวมทุกสาขา' : 'ดึงจากระบบบิลไม่ได้'}</span>
        </div>
      </div>

      <section className="pos-panel" style={{ marginBottom: 16 }} aria-label="ยอดขาย 7 วันแยกสาขา">
        <h2 className="pos-panel-title">ยอดขาย 7 วัน แยกสาขา</h2>
        {!weekValues ? (
          <div className="pos-skeleton" style={{ height: 220 }} />
        ) : (
          <GroupedBarChart
            categories={week.map((d) => ({ key: d.date, label: dayLabel(d.date) }))}
            series={series}
            values={weekValues}
            format={thb}
            caption="ยอดขายสุทธิรายวันแยกสาขา 7 วันล่าสุด"
          />
        )}
      </section>

      <section className="pos-panel" aria-label="เปรียบเทียบสาขาวันนี้">
        <h2 className="pos-panel-title">เปรียบเทียบสาขา · วันนี้{state.at ? ` · อัปเดต ${hhmm(state.at)}` : ''}</h2>
        {!t ? (
          <div className="pos-skeleton" style={{ height: 160 }} />
        ) : (
          <div className="pos-rtable-wrap">
            <table className="pos-rtable">
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th className="is-num">ยอดขาย</th>
                  <th className="is-num">บิล</th>
                  <th className="is-num">เฉลี่ย/บิล</th>
                  <th>เมนูขายดี</th>
                  <th>เทียบเมื่อวาน</th>
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => {
                  const now = byBranch(t, b.id)
                  const before = byBranch(y, b.id)
                  const d = pctDelta(Number(now?.net_sales || 0), Number(before?.net_sales || 0))
                  return (
                    <tr key={b.id}>
                      <td>
                        <span className="pos-dot-label">
                          <i style={{ background: colorOf.get(b.id) || OTHER_COLOR }} aria-hidden="true" />
                          <strong>{b.name}</strong>
                        </span>
                      </td>
                      <td className="is-num">{thb(now?.net_sales || 0)}</td>
                      <td className="is-num">{now?.bill_count || 0}</td>
                      <td className="is-num">{thb(Math.round(now?.avg_per_bill || 0))}</td>
                      <td>{state.tops.get(b.id) || <span className="pos-muted">—</span>}</td>
                      <td>
                        {d == null ? (
                          <span className="pos-muted pos-small">{now?.net_sales ? 'เมื่อวานไม่มียอด' : '—'}</span>
                        ) : (
                          <span className={`pos-pill ${d >= 0 ? 'is-available' : 'is-waiting'}`}>
                            {d >= 0 ? '+' : ''}
                            {d}%
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function Overview({ branchId }) {
  const today = todayTh()
  const [state, setState] = useState({ today: null, yesterday: null, approvals: null, error: '', at: null })
  const [range, setRange] = useState('today') // today | 7 | 30
  const [chart, setChart] = useState({ key: null, points: [], error: '' })
  const [tick, setTick] = useState(0)

  // ตัวเลขหลัก + รีเฟรชทุกนาที
  useEffect(() => {
    let cancelled = false
    const load = () =>
      Promise.all([
        getDailyReport({ date: today, branch_id: branchId }),
        getDailyReport({ date: shiftDate(today, 1), branch_id: branchId }).catch(() => null),
        listApprovals({ status: 'pending' }).catch(() => null),
      ])
        .then(([t, y, a]) => !cancelled && setState({ today: t, yesterday: y, approvals: a, error: '', at: new Date() }))
        .catch((err) => !cancelled && setState((s) => ({ ...s, error: errorText(err) })))
    load()
    const id = setInterval(() => {
      load()
      setTick((n) => n + 1)
    }, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [today, branchId])

  // กราฟ (วันนี้รีเฟรชตามรอบ · 7/30 วันโหลดครั้งเดียว)
  const chartKey = `${range}|${branchId}|${range === 'today' ? tick : 0}`
  useEffect(() => {
    let cancelled = false
    const load = range === 'today' ? hourlySales(today, branchId) : dailySales(Number(range), branchId)
    load
      .then((points) => !cancelled && setChart({ key: chartKey, points, error: '' }))
      .catch((err) => !cancelled && setChart({ key: chartKey, points: [], error: errorText(err) }))
    return () => {
      cancelled = true
    }
  }, [chartKey, range, today, branchId])

  const t = state.today
  const y = state.yesterday
  const pending = state.approvals
  const discountCount = pending?.filter((a) => a.type === 'discount').length ?? 0
  const refundCount = pending?.filter((a) => a.type === 'refund').length ?? 0
  const chartLoading = chart.key?.split('|').slice(0, 2).join('|') !== `${range}|${branchId}`

  return (
    <>
      {state.error && <div className="pos-alert">{state.error}</div>}
      {t?.warnings?.map((w) => (
        <p key={w.code} className="pos-note is-warn">
          {w.message}
        </p>
      ))}

      <div className="pos-kpis is-4">
        <div className="pos-kpi">
          <span className="pos-kpi-label">ยอดขายวันนี้</span>
          <strong className="pos-kpi-value">{t ? thb(t.net_sales) : '–'}</strong>
          {t ? <Delta now={t.net_sales} before={y?.net_sales} /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">จำนวนบิล</span>
          <strong className="pos-kpi-value">{t ? t.bill_count : '–'}</strong>
          {t ? <Delta now={t.bill_count} before={y?.bill_count} unit="บิล" /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">ยอดเฉลี่ยต่อบิล</span>
          <strong className="pos-kpi-value">{t ? thb(Math.round(t.avg_per_bill)) : '–'}</strong>
          {t ? <Delta now={t.avg_per_bill} before={y?.avg_per_bill} /> : <span className="pos-kpi-sub">&nbsp;</span>}
        </div>
        <div className="pos-kpi">
          <span className="pos-kpi-label">คำขอรออนุมัติ</span>
          <strong className="pos-kpi-value">{pending ? pending.length : '–'}</strong>
          <span className="pos-kpi-sub is-ok">{pending ? `ส่วนลด ${discountCount} · คืนเงิน ${refundCount}` : 'ดึงจากระบบบิลไม่ได้'}</span>
        </div>
      </div>

      <div className="pos-dash-layout">
        <section className="pos-panel" aria-label="ยอดขาย">
          <div className="pos-panel-head">
            <div>
              <h2 className="pos-panel-title" style={{ margin: 0 }}>
                {range === 'today' ? 'ยอดขายรายชั่วโมง' : `ยอดขายรายวัน · ${range} วัน`}
              </h2>
              <p className="pos-dialog-sub">เงินที่รับ รวม VAT{state.at ? ` · อัปเดต ${hhmm(state.at)}` : ''}</p>
            </div>
            <div className="pos-tabs" role="tablist" style={{ margin: 0 }}>
              {[
                ['today', 'วันนี้'],
                ['7', '7 วัน'],
                ['30', '30 วัน'],
              ].map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={range === key} className={range === key ? 'is-active' : ''} onClick={() => setRange(key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {chart.error && !chartLoading ? (
            <p className="pos-note is-warn">{chart.error}</p>
          ) : chartLoading ? (
            <div className="pos-skeleton" style={{ height: 240 }} />
          ) : (
            <BarChart points={chart.points} dense={range === '30'} />
          )}
        </section>

        <section className="pos-panel" aria-label="เมนูขายดีวันนี้">
          <h2 className="pos-panel-title">เมนูขายดีวันนี้</h2>
          {!t ? (
            <div className="pos-skeleton" style={{ height: 200 }} />
          ) : !t.top_menus ? (
            <p className="pos-muted">ดึงเมนูขายดีจากระบบบิลไม่ได้ชั่วคราว</p>
          ) : t.top_menus.length === 0 ? (
            <div className="pos-cart-empty">ยังไม่มีรายการขายวันนี้</div>
          ) : (
            <div className="pos-rtable-wrap">
              <table className="pos-rtable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>เมนู</th>
                    <th className="is-num">จำนวน</th>
                    <th className="is-num">ยอดขาย</th>
                  </tr>
                </thead>
                <tbody>
                  {t.top_menus.map((m, i) => (
                    <tr key={m.menu_id || i}>
                      <td className="pos-muted">{i + 1}</td>
                      <td>{m.menu_name}</td>
                      <td className="is-num">{m.quantity}</td>
                      <td className="is-num">{thb(m.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  )
}

/** กราฟแท่งชุดเดียว · ชี้/โฟกัสแท่งเพื่อดูยอด · มีตารางสำหรับโปรแกรมอ่านหน้าจอ */
function BarChart({ points, dense }) {
  const [active, setActive] = useState(null)
  const max = useMemo(() => Math.max(1, ...points.map((p) => p.value)), [points])
  const total = points.reduce((s, p) => s + p.value, 0)

  if (!points.length || total === 0) return <div className="pos-cart-empty">ยังไม่มียอดขายในช่วงนี้</div>

  const labelEvery = dense ? 5 : 1
  const hovered = active != null ? points[active] : null

  return (
    <div className="pos-chart">
      <div className="pos-chart-tip" aria-hidden="true">
        {hovered ? (
          <>
            <strong>{thb(hovered.value)}</strong> · {hovered.label}
          </>
        ) : (
          <span className="pos-muted">รวม {thb(total)} · ชี้ที่แท่งเพื่อดูยอด</span>
        )}
      </div>
      <div className="pos-chart-plot" role="img" aria-label={`กราฟยอดขาย รวม ${thb(total)}`} onMouseLeave={() => setActive(null)}>
        {points.map((p, i) => (
          <button
            key={p.key}
            type="button"
            className={`pos-chart-col ${active === i ? 'is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onFocus={() => setActive(i)}
            onBlur={() => setActive(null)}
            aria-label={`${p.label} ${thb(p.value)}`}
          >
            <span className="pos-chart-bar" style={{ height: `${(p.value / max) * 100}%` }} />
          </button>
        ))}
      </div>
      <div className="pos-chart-axis" aria-hidden="true">
        {points.map((p, i) => (
          <span key={p.key}>{i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}</span>
        ))}
      </div>
      <table className="pos-sr-only">
        <caption>ยอดขาย</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>{thb(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
