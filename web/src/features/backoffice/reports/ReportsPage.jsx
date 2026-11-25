import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { getBranchReport, getDailyReport, listPayments } from '../../../api/payment'
import { useApprovalFeed } from '../../../api/approvalFeed'
import { listApprovals } from '../../../api/pos'
import { useReportFeed } from '../../../api/reportFeed'
import { hhmm, thb } from '../../../lib/posUtils'
import { YGrid, niceMax } from '../chartScale'
import GroupedBarChart from '../GroupedBarChart'
import SaleDetail from '../payments/SaleDetail'
import { METHOD_LABEL, TYPE_LABEL, dateTime } from '../payments/paymentLabels'
import { OTHER_COLOR, SERIES_COLORS } from '../seriesColors'
import { errorText, todayTh, useBranchScope } from '../useBranchScope'
import '../../../styles/pos.css'

// แดชบอร์ด (หลังร้าน) — 1.34–1.36
// - manager หรือ owner ที่เลือกสาขา: แดชบอร์ดสาขา (Overview)
// - owner เลือก "ทุกสาขา": แดชบอร์ดรวม + เปรียบเทียบสาขา (OwnerOverview) · กำไรรายเดือนอยู่หน้า /admin/profit
// ยอดขาย = เงินที่รับ (รวม VAT) จาก payment · เมนูขายดีจาก pos ผ่านรายงานรายวัน
// กราฟ: วันนี้ = รวมรายการรับเงินรายชั่วโมง · 7/30 วัน = ยอดขายรายวันจากรายงานรายวัน
// realtime: SSE 2 เส้น — payment (รับเงิน/คืนเงิน/รายจ่าย) + pos (คำขออนุมัติ) → โหลดตัวเลขใหม่ทันที
//           หลุด → poll ทุก 15 วินาทีแทน (ต่ออยู่ poll ทุก 60 วินาทีกันพลาด)

const REFRESH_MS = 60_000
const REFRESH_OFFLINE_MS = 15_000 // SSE ยอดขายหลุด → poll ถี่ขึ้น
const APPROVAL_POLL_OFFLINE = 10_000 // SSE หลุด → poll คำขอถี่ขึ้น
const LIVE_DEBOUNCE_MS = 400 // เหตุการณ์มาติดกัน (เช่น อนุมัติ + คืนเงิน) → โหลดครั้งเดียว
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

/** ยอดรับเงินวันนี้แยกรายชั่วโมง (เวลาตามเครื่อง = เวลาไทย) · คืนเงินหักตั้งแต่ชั่วโมงที่อนุมัติ */
async function hourlySales(date, branchId) {
  const payments = []
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await listPayments({ date, page, limit: PAGE, branch_id: branchId })
    payments.push(...(res.data || []))
    if (payments.length >= (res.meta?.total ?? 0) || !(res.data || []).length) break
  }
  // คืนเงินที่อนุมัติแล้วแต่ยังไม่ได้จ่ายคืน (ไม่มีในรายการรับเงิน)
  const pending = (await getDailyReport({ date, branch_id: branchId }).catch(() => null))?.pending_refunds || []
  const byHour = new Map()
  for (const p of payments) {
    const h = new Date(p.paid_at).getHours()
    const signed = p.type === 'refund' ? -Number(p.amount) : Number(p.amount) // คืนเงินหักออกจากยอด
    byHour.set(h, (byHour.get(h) || 0) + signed)
  }
  for (const a of pending) {
    const h = new Date(a.decided_at).getHours()
    byHour.set(h, (byHour.get(h) || 0) - Number(a.amount))
  }
  // ช่วงเปิดร้านปกติ 10–21 น. + ชั่วโมงที่มียอดนอกช่วง
  const hours = [...new Set([...Array.from({ length: 12 }, (_, i) => i + 10), ...byHour.keys()])].sort((a, b) => a - b)
  return hours.map((h) => ({ key: String(h), label: `${String(h).padStart(2, '0')}:00`, value: Math.round((byHour.get(h) || 0) * 100) / 100 }))
}

async function dailySales(days, branchId) {
  const today = todayTh()
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, days - 1 - i))
  const rows = await mapLimit(dates, DAY_CONCURRENCY, (date) => getDailyReport({ date, branch_id: branchId }).catch(() => null))
  return dates.map((d, i) => ({ key: d, label: dayLabel(d), value: Number(rows[i]?.net_sales ?? 0) }))
}

/** กำไร/ขาดทุนรายวัน = ยอดขายสุทธิ (หักคืนเงินแล้ว) − รายจ่ายของวัน · branchId ว่าง = ทุกสาขา (owner) */
async function dailyProfit(days, branchId) {
  const today = todayTh()
  const dates = Array.from({ length: days }, (_, i) => shiftDate(today, days - 1 - i))
  const rows = await mapLimit(dates, DAY_CONCURRENCY, (date) => getDailyReport({ date, ...(branchId ? { branch_id: branchId } : {}) }).catch(() => null))
  return dates.map((d, i) => {
    const r = rows[i]
    const sales = Number(r?.net_sales ?? 0)
    const expenses = Number(r?.expenses?.total ?? 0)
    return { key: d, label: dayLabel(d), sales, expenses, value: Math.round((sales - expenses) * 100) / 100, missing: !r }
  })
}

function Delta({ now, before, unit = '%', suffix = 'จากเมื่อวาน' }) {
  if (before == null) return <span className="pos-kpi-sub">&nbsp;</span>
  if (unit === '%') {
    if (!before) return <span className="pos-kpi-sub">{now ? 'เมื่อวานไม่มียอด' : 'ยังไม่มียอด'}</span>
    const pct = Math.round(((now - before) / before) * 100)
    return (
      <span className="pos-kpi-delta">
        <b className={pct >= 0 ? 'is-ok' : 'is-danger'}>
          {pct >= 0 ? '▲' : '▼'}
          {Math.abs(pct)}%
        </b>
        <span>{suffix}</span>
      </span>
    )
  }
  const diff = now - before
  return (
    <span className="pos-kpi-delta">
      <b className={diff >= 0 ? 'is-ok' : 'is-danger'}>
        {diff >= 0 ? '▲' : '▼'}
        {Math.abs(diff)} {unit}
      </b>
      <span>{suffix}</span>
    </span>
  )
}

const num = (n) => Math.round(Number(n) || 0).toLocaleString('en-US')
const ROW = { alignItems: 'stretch', marginBottom: 16 }

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
            {branchId ? `สาขา${branchName(branchId)}` : 'ทุกสาขา'} · วันนี้ {longDate(todayTh())}
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

/**
 * คำขอรออนุมัติ (ส่วนลด/คืนเงิน) ของสาขาที่เห็น — อัปเดตทันทีเมื่อมีคำขอใหม่หรือถูกตัดสิน (SSE จาก pos)
 * SSE หลุด → poll ทุก 10 วินาที · null = ดึงจากระบบบิลไม่ได้
 * คืน [approvals, version] · version เพิ่มทุกครั้งที่มีเหตุการณ์ (เช่น อนุมัติคืนเงิน → ยอดขายต้องโหลดใหม่ทันที)
 */
function usePendingApprovals() {
  const [approvals, setApprovals] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const live = useApprovalFeed(reload)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listApprovals({ status: 'pending' })
        .then((rows) => !cancelled && setApprovals(rows || []))
        .catch(() => !cancelled && setApprovals((prev) => prev ?? null))
    load()
    const id = setInterval(load, live ? REFRESH_MS : APPROVAL_POLL_OFFLINE)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [reloadKey, live])

  return [approvals, reloadKey]
}

/**
 * ตัวนับที่เพิ่มทุกครั้งที่ตัวเลขแดชบอร์ดควรโหลดใหม่ทันที (realtime)
 * - payment: รับเงิน/คืนเงิน/รายจ่าย ของสาขาที่ดูอยู่ (branchId ว่าง = ทุกสาขา)
 * - pos: คำขออนุมัติเปลี่ยน (approvalVersion จาก usePendingApprovals) เช่น อนุมัติคืนเงิน → ยอดลด
 * คืน { version, live, at } · live = SSE ยอดขายต่ออยู่ · at = เวลาที่มีเหตุการณ์ล่าสุด
 */
function useLiveVersion(branchId, approvalVersion) {
  const [salesVersion, setSalesVersion] = useState(0)
  const [at, setAt] = useState(null)
  const timer = useRef(null)
  const live = useReportFeed((e) => {
    if (branchId && e.branch_id !== branchId) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      setSalesVersion((v) => v + 1)
      setAt(new Date())
    }, LIVE_DEBOUNCE_MS)
  })
  useEffect(() => () => clearTimeout(timer.current), [])
  return { version: salesVersion + approvalVersion, live, at }
}

/** จุดบอกสถานะ realtime */
function LiveBadge({ live }) {
  return (
    <span className={`pos-live ${live ? 'is-on' : ''}`} title={live ? 'อัปเดตทันทีเมื่อมีรับเงิน คืนเงิน หรือรายจ่ายใหม่' : 'กำลังต่อ realtime ใหม่ · ระหว่างนี้รีเฟรชทุก 15 วินาที'}>
      <i aria-hidden="true" />
      {live ? 'สด' : 'ออฟไลน์'}
    </span>
  )
}

/** รายการคำขอคืนเงินที่รออนุมัติ · กดแล้วไปหน้าคำขออนุมัติของคำขอนั้น */
function PendingRefunds({ approvals }) {
  if (!approvals) return null
  const refunds = approvals.filter((a) => a.type === 'refund').sort((a, b) => (b.requested_at || '').localeCompare(a.requested_at || ''))
  return (
    <section className="pos-panel" aria-label="คำขอคืนเงินรออนุมัติ">
      <div className="pos-panel-head">
        <h2 className="pos-panel-title" style={{ margin: 0 }}>
          คำขอคืนเงินรออนุมัติ ({refunds.length})
        </h2>
        <Link className="pos-btn" to="/approvals">
          ไปหน้าคำขออนุมัติ
        </Link>
      </div>
      {refunds.length === 0 ? (
        <p className="pos-dialog-sub">ไม่มีคำขอคืนเงินค้าง</p>
      ) : (
        refunds.map((a) => {
          const tables = (a.tables || []).map((t) => t.table_no).filter(Boolean).join(', ')
          const items = (a.refund_items || []).map((r) => `${r.menu_name || 'รายการ'} ×${r.quantity}`).join(', ')
          return (
            <Link key={a.id} to={`/approvals?id=${a.id}`} className="pos-approval" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span>
                <strong>
                  คืนเงิน {thb(a.amount)} · บิล {a.order_no || '-'}
                  {tables && ` · โต๊ะ ${tables}`}
                </strong>
                {items ? `คืนบางรายการ: ${items}` : 'คืนทั้งบิล'}
                {a.reason && ` · ${a.reason}`}
                {` · ขอโดย ${a.requested_by_name || '—'} · ${hhmm(a.requested_at)}`}
              </span>
              <span className="pos-pill is-occupied">รออนุมัติ</span>
            </Link>
          )
        })
      )}
    </section>
  )
}

/** ยอดขายรายชั่วโมง (วันนี้) หรือรายวัน 7/30 วัน · refreshKey เปลี่ยน → โหลดใหม่ */
function HourlySalesPanel({ branchId, refreshKey, live }) {
  const [range /* , setRange */] = useState('today') // today | 7 | 30 (7/30 ปิดไว้ก่อน)
  const [state, setState] = useState({ range: null, points: null, error: '', at: null })
  useEffect(() => {
    let cancelled = false
    const load = () =>
      (range === 'today' ? hourlySales(todayTh(), branchId) : dailySales(Number(range), branchId))
        .then((points) => !cancelled && setState({ range, points, error: '', at: new Date() }))
        .catch((err) => !cancelled && setState((s) => ({ ...s, range, error: errorText(err) })))
    load()
    const id = setInterval(load, live ? REFRESH_MS : REFRESH_OFFLINE_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [branchId, range, refreshKey, live])

  const loading = state.range !== range

  return (
    <section className="pos-panel" aria-label="ยอดขาย">
      <div className="pos-panel-head">
        <div>
          <h2 className="pos-panel-title" style={{ margin: 0 }}>
            {range === 'today' ? 'ยอดขายรายชั่วโมง' : `ยอดขายรายวัน · ${range} วัน`}
          </h2>
          <p className="pos-dialog-sub">
            เงินที่รับ รวม VAT{state.at ? ` · อัปเดต ${hhmm(state.at)}` : ''} <LiveBadge live={live} />
          </p>
        </div>
        {/* TODO: แท็บ 7 วัน / 30 วัน — ปิดไว้ก่อน รอสรุปวิธีรวมข้อมูลตามชั่วโมง (ดูช่วงเวลาที่คนเยอะ)
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
        */}
      </div>
      {loading ? (
        <div className="pos-skeleton" style={{ height: 240 }} />
      ) : state.error ? (
        <p className="pos-note is-warn">{state.error}</p>
      ) : (
        <BarChart points={state.points} dense={range === '30'} />
      )}
    </section>
  )
}

/** owner · ทุกสาขา: ตัวเลขรวม กราฟ 7 วันแยกสาขา และตารางเปรียบเทียบสาขาวันนี้ (1.36) */
function OwnerOverview({ branches }) {
  const today = todayTh()
  const [state, setState] = useState({ today: null, yesterday: null, tops: new Map(), error: '', at: null })
  const [week, setWeek] = useState(null) // [{ date, rows }]
  const [pending, approvalVersion] = usePendingApprovals()
  const { version, live } = useLiveVersion(null, approvalVersion)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      Promise.all([
        getBranchReport({ from: today, to: today }),
        getBranchReport({ from: shiftDate(today, 1), to: shiftDate(today, 1) }).catch(() => null),
        // เมนูขายดีอันดับ 1 ของแต่ละสาขา
        mapLimit(branches, DAY_CONCURRENCY, (b) => getDailyReport({ date: today, branch_id: b.id }).catch(() => null)),
      ])
        .then(([t, y, daily]) => {
          if (cancelled) return
          const tops = new Map(branches.map((b, i) => [b.id, daily[i]?.top_menus?.[0]?.menu_name || null]))
          setState({ today: t, yesterday: y, tops, error: '', at: new Date() })
        })
        .catch((err) => !cancelled && setState((s) => ({ ...s, error: errorText(err) })))
    load()
    const id = setInterval(load, live ? REFRESH_MS : REFRESH_OFFLINE_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // version: มีรับเงิน/คืนเงิน/รายจ่าย/อนุมัติ → โหลดใหม่ทันที
  }, [today, branches, version, live])

  useEffect(() => {
    let cancelled = false
    const dates = Array.from({ length: 7 }, (_, i) => shiftDate(today, 6 - i))
    mapLimit(dates, DAY_CONCURRENCY, (d) => getBranchReport({ from: d, to: d }).catch(() => null)).then(
      (rows) => !cancelled && setWeek(dates.map((date, i) => ({ date, rows: rows[i]?.branches || [] }))),
    )
    return () => {
      cancelled = true
    }
  }, [today, version])

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
          <span className="pos-kpi-sub is-ok">
            {pending ? `ส่วนลด ${pending.filter((a) => a.type === 'discount').length} · คืนเงิน ${pending.filter((a) => a.type === 'refund').length} · รวมทุกสาขา` : 'ดึงจากระบบบิลไม่ได้'}
          </span>
        </div>
      </div>

      <div className="pos-dash-layout" style={ROW}>
      <section className="pos-panel" aria-label="เปรียบเทียบสาขาวันนี้">
        <div className="pos-panel-head">
          <div>
            <h2 className="pos-panel-title" style={{ margin: 0 }}>
              เปรียบเทียบสาขา · วันนี้
            </h2>
            <p className="pos-dialog-sub">
              {state.at ? `อัปเดต ${hhmm(state.at)} ` : ''}
              <LiveBadge live={live} />
            </p>
          </div>
          <span className="pos-muted pos-small">หน่วย: บาท</span>
        </div>
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
                      <td className="is-num">{num(now?.net_sales || 0)}</td>
                      <td className="is-num">{now?.bill_count || 0}</td>
                      <td className="is-num">{num(now?.avg_per_bill || 0)}</td>
                      <td>{state.tops.get(b.id) || <span className="pos-muted">—</span>}</td>
                      <td>
                        {d == null ? (
                          <span className="pos-muted pos-small">{now?.net_sales ? 'เมื่อวานไม่มียอด' : '—'}</span>
                        ) : (
                          <span className={`pos-pill ${d >= 0 ? 'is-available' : 'is-waiting'}`}>
                            {d >= 0 ? '▲' : '▼'}
                            {Math.abs(d)}%
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
        <PendingRefunds approvals={pending} />
      </div>

      <div className="pos-dash-layout" style={ROW}>
      <section className="pos-panel" aria-label="ยอดขาย 7 วันแยกสาขา">
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
      <ProfitLossPanel title="กำไร / ขาดทุน รวมทุกสาขา" refreshKey={version} />
      </div>

      <HourlySalesPanel refreshKey={version} live={live} />

      <SalesHistoryPanel branches={branches} colorOf={colorOf} refreshKey={version} live={live} />
    </>
  )
}

const HISTORY_LIMIT = 15

/** owner · ทุกสาขา: เงินที่ลูกค้าจ่ายล่าสุดของทุกสาขา (7 วัน) · เลือกดูทีละสาขาได้ · กดแถวดูเมนูในบิล */
function SalesHistoryPanel({ branches, colorOf, refreshKey, live }) {
  const [branchId, setBranchId] = useState('')
  const [state, setState] = useState({ key: null, items: null, total: 0, error: '' })
  const [selected, setSelected] = useState(null)
  const nameOf = (id) => branches.find((b) => b.id === id)?.name || 'ไม่พบสาขา'

  useEffect(() => {
    let cancelled = false
    const today = todayTh()
    listPayments({ from: shiftDate(today, 6), to: today, branch_id: branchId, page: 1, limit: HISTORY_LIMIT })
      .then((res) => !cancelled && setState({ key: branchId, items: res.data || [], total: res.meta?.total || 0, error: '' }))
      .catch((err) => !cancelled && setState({ key: branchId, items: null, total: 0, error: errorText(err) }))
    return () => {
      cancelled = true
    }
  }, [branchId, refreshKey])

  const loading = state.key !== branchId

  return (
    <section className="pos-panel" aria-label="ประวัติการขายล่าสุด" style={{ marginTop: 16 }}>
      <div className="pos-panel-head">
        <div>
          <h2 className="pos-panel-title" style={{ margin: 0 }}>
            ประวัติการขายล่าสุด · {branchId ? nameOf(branchId) : `ทุกสาขา (${branches.length})`}
          </h2>
          <p className="pos-dialog-sub">
            เงินที่ลูกค้าจ่าย 7 วันล่าสุด{state.items ? ` · ${state.total.toLocaleString('th-TH')} รายการ` : ''} <LiveBadge live={live} />
          </p>
        </div>
        <Link className="pos-btn" to="/admin/payments">
          ดูทั้งหมด
        </Link>
      </div>

      <div className="pos-tabs" role="tablist" style={{ marginBottom: 12 }}>
        {[{ id: '', name: 'ทุกสาขา' }, ...branches].map((b) => (
          <button key={b.id || 'all'} type="button" role="tab" aria-selected={branchId === b.id} className={branchId === b.id ? 'is-active' : ''} onClick={() => setBranchId(b.id)}>
            {b.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="pos-skeleton" style={{ height: 200 }} />
      ) : state.error ? (
        <p className="pos-note is-warn">{state.error}</p>
      ) : state.items.length === 0 ? (
        <p className="pos-dialog-sub">ยังไม่มีการขายใน 7 วันนี้</p>
      ) : (
        <div className="pos-rtable-wrap">
          <table className="pos-rtable">
            <thead>
              <tr>
                <th>เวลา</th>
                <th>สาขา</th>
                <th>บิล</th>
                <th>โต๊ะ</th>
                <th>วิธีชำระ</th>
                <th className="is-num">จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {state.items.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p)} style={{ cursor: 'pointer' }} title="กดเพื่อดูรายการในบิล">
                  <td>{dateTime(p.paid_at)}</td>
                  <td>
                    <span className="pos-dot-label">
                      <i style={{ background: colorOf.get(p.branch_id) || OTHER_COLOR }} aria-hidden="true" />
                      {nameOf(p.branch_id)}
                    </span>
                  </td>
                  <td>{p.order?.order_no || <span className="pos-muted">{p.order_id.slice(0, 8)}</span>}</td>
                  <td>{p.order?.table_no || <span className="pos-muted">—</span>}</td>
                  <td>
                    {METHOD_LABEL[p.method] || p.method}
                    {p.type === 'refund' && <span className="pos-pill is-waiting" style={{ marginLeft: 6 }}>{TYPE_LABEL.refund}</span>}
                  </td>
                  <td className="is-num" style={p.type === 'refund' ? { color: 'var(--app-danger, #c0392b)' } : undefined}>
                    <strong>
                      {p.type === 'refund' ? '−' : ''}
                      {num(p.amount)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <SaleDetail payment={selected} branch={nameOf(selected.branch_id)} onClose={() => setSelected(null)} />}
    </section>
  )
}

function Overview({ branchId }) {
  const today = todayTh()
  const [state, setState] = useState({ today: null, yesterday: null, error: '', at: null })
  const [allPending, approvalVersion] = usePendingApprovals()
  // owner ที่เลือกสาขา → เฉพาะคำขอของสาขานั้น (manager ได้เฉพาะสาขาตัวเองจาก backend อยู่แล้ว)
  const pending = allPending && branchId ? allPending.filter((a) => !a.branch_id || a.branch_id === branchId) : allPending
  const [range, setRange] = useState('today') // today | 7 | 30
  const [chart, setChart] = useState({ key: null, points: [], error: '' })
  const [tick, setTick] = useState(0)
  const { version, live } = useLiveVersion(branchId, approvalVersion)

  // ตัวเลขหลัก · realtime + รีเฟรชสำรองทุกนาที (ออฟไลน์ทุก 15 วินาที)
  useEffect(() => {
    let cancelled = false
    const load = () =>
      Promise.all([
        getDailyReport({ date: today, branch_id: branchId }),
        getDailyReport({ date: shiftDate(today, 1), branch_id: branchId }).catch(() => null),
      ])
        .then(([t, y]) => !cancelled && setState({ today: t, yesterday: y, error: '', at: new Date() }))
        .catch((err) => !cancelled && setState((s) => ({ ...s, error: errorText(err) })))
    load()
    const id = setInterval(
      () => {
        load()
        setTick((n) => n + 1)
      },
      live ? REFRESH_MS : REFRESH_OFFLINE_MS,
    )
    return () => {
      cancelled = true
      clearInterval(id)
    }
    // version: มีรับเงิน/คืนเงิน/รายจ่าย/อนุมัติ → โหลดใหม่ทันที
  }, [today, branchId, version, live])

  // กราฟ (วันนี้รีเฟรชตามรอบ · 7/30 วันโหลดครั้งเดียว) · มีเหตุการณ์ realtime → โหลดใหม่
  const chartKey = `${range}|${branchId}|${range === 'today' ? tick : 0}|${version}`
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

      <div className="pos-dash-layout" style={ROW}>
        <section className="pos-panel" aria-label="ยอดขาย">
          <div className="pos-panel-head">
            <div>
              <h2 className="pos-panel-title" style={{ margin: 0 }}>
                {range === 'today' ? 'ยอดขายรายชั่วโมง' : `ยอดขายรายวัน · ${range} วัน`}
              </h2>
              <p className="pos-dialog-sub">
                เงินที่รับ รวม VAT{state.at ? ` · อัปเดต ${hhmm(state.at)}` : ''} <LiveBadge live={live} />
              </p>
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

        <PendingRefunds approvals={pending} />
      </div>

      <div className="pos-dash-layout" style={ROW}>
        <ProfitLossPanel branchId={branchId} refreshKey={version} />

        <section className="pos-panel" aria-label="เมนูขายดีวันนี้">
          <div className="pos-panel-head">
            <h2 className="pos-panel-title" style={{ margin: 0 }}>
              เมนูขายดีวันนี้
            </h2>
            <span className="pos-muted pos-small">หน่วย: บาท</span>
          </div>
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
                      <td className="is-num">{num(m.amount)}</td>
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

/** กำไร/ขาดทุนรายวัน 7/30 วัน (manager: สาขาตัวเอง · owner: สาขาที่เลือกหรือรวมทุกสาขา) · refreshKey เปลี่ยน → โหลดใหม่ */
function ProfitLossPanel({ branchId, title, refreshKey = 0 }) {
  const [days, setDays] = useState(7)
  const [state, setState] = useState({ key: null, points: [] })
  const key = `${days}|${branchId || 'all'}`

  useEffect(() => {
    let cancelled = false
    const load = () => dailyProfit(days, branchId).then((points) => !cancelled && setState({ key, points }))
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [key, days, branchId, refreshKey])

  const loading = state.key !== key
  const points = state.points
  const lossDays = points.filter((p) => p.value < 0)
  const net = points.reduce((s, p) => s + p.value, 0)
  const lossTotal = lossDays.reduce((s, p) => s + p.value, 0)

  return (
    <section className="pos-panel" aria-label="กำไร ขาดทุน รายวัน">
      <div className="pos-panel-head">
        <div>
          <h2 className="pos-panel-title" style={{ margin: 0 }}>
            {title || 'กำไร / ขาดทุน รายวัน'} · {days} วัน
          </h2>
          <p className="pos-dialog-sub">ยอดขายสุทธิ (หักคืนเงินที่อนุมัติแล้ว) − รายจ่ายของวัน · แท่งแดง = ขาดทุน</p>
        </div>
        <div className="pos-tabs" role="tablist" style={{ margin: 0 }}>
          {[7, 30].map((n) => (
            <button key={n} type="button" role="tab" aria-selected={days === n} className={days === n ? 'is-active' : ''} onClick={() => setDays(n)}>
              {n} วัน
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="pos-skeleton" style={{ height: 240 }} />
      ) : (
        <>
          <div className="pos-pl-summary">
            <span>
              {net >= 0 ? 'กำไรสุทธิ' : 'ขาดทุนสุทธิ'} <strong className={net >= 0 ? 'is-profit' : 'is-loss'}>{thb(Math.abs(net))}</strong>
            </span>
            <span>
              ขาดทุน <strong className={lossDays.length ? 'is-loss' : ''}>{lossDays.length} วัน</strong>
              {lossDays.length > 0 && ` · รวม ${thb(Math.abs(lossTotal))}`}
            </span>
          </div>
          <ProfitLossChart points={points} dense={days === 30} />
        </>
      )}
    </section>
  )
}

/** กราฟแท่งบวก/ลบรอบเส้นศูนย์ · กำไร = แท่งขึ้น · ขาดทุน = แท่งแดงลง */
function ProfitLossChart({ points, dense }) {
  const [active, setActive] = useState(null)
  const maxUp = Math.max(0, ...points.map((p) => p.value))
  const maxDown = Math.max(0, ...points.map((p) => -p.value))
  const step = niceMax(Math.max(maxUp, maxDown)) / 2
  const upTop = maxUp ? Math.ceil(maxUp / step) * step : 0
  const downTop = maxDown ? Math.ceil(maxDown / step) * step : 0
  const span = upTop + downTop || 1
  const upPct = (upTop / span) * 100 || (downTop ? 0 : 100)
  const ticks = []
  for (let v = -downTop; v <= upTop + 1e-9; v += step) ticks.push({ value: Math.round(v), pct: ((v + downTop) / span) * 100 })

  if (!points.some((p) => p.value !== 0 || p.sales || p.expenses)) return <div className="pos-cart-empty">ยังไม่มียอดขายหรือรายจ่ายในช่วงนี้</div>

  const labelEvery = dense ? 5 : 1
  const hovered = active != null ? points[active] : null

  return (
    <div className="pos-chart">
      <div className="pos-chart-tip" aria-hidden="true">
        {hovered ? (
          <span className="pos-chart-pill">
            <strong className={hovered.value < 0 ? 'is-loss' : 'is-profit'}>
              {hovered.value < 0 ? 'ขาดทุน ' : 'กำไร '}
              {thb(Math.abs(hovered.value))}
            </strong>
            <span>
              {hovered.label} · ขาย {thb(hovered.sales)} · รายจ่าย {thb(hovered.expenses)}
            </span>
          </span>
        ) : (
          <span className="pos-chart-pill is-muted">ชี้ที่แท่งเพื่อดูยอดขาย รายจ่าย และกำไร/ขาดทุนของวัน</span>
        )}
      </div>
      <div className="pos-chart-body">
        <div className="pos-chart-plotwrap">
          <YGrid ticks={ticks} />
          <div className="pos-chart-plot pos-pl-plot" role="img" aria-label="กราฟกำไรขาดทุนรายวัน" onMouseLeave={() => setActive(null)}>
            {points.map((p, i) => (
              <button
                key={p.key}
                type="button"
                className={`pos-chart-col pos-pl-col ${active === i ? 'is-active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
                aria-label={`${p.label} ${p.value < 0 ? 'ขาดทุน' : 'กำไร'} ${thb(Math.abs(p.value))}`}
              >
                <span className="pos-pl-up" style={{ height: `${upPct}%` }}>
                  {p.value > 0 && <span className="pos-chart-bar is-profit" style={{ height: `${(p.value / (upTop || 1)) * 100}%` }} />}
                </span>
                <span className="pos-pl-down" style={{ height: `${100 - upPct}%` }}>
                  {p.value < 0 && <span className="pos-chart-bar is-loss" style={{ height: `${(-p.value / (downTop || 1)) * 100}%` }} />}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div className="pos-chart-axis" aria-hidden="true">
          {points.map((p, i) => (
            <span key={p.key} className={active === i ? 'is-active' : ''}>{i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}</span>
          ))}
        </div>
      </div>
      <table className="pos-sr-only">
        <caption>กำไร/ขาดทุนรายวัน</caption>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <th scope="row">{p.label}</th>
              <td>
                {p.value < 0 ? 'ขาดทุน' : 'กำไร'} {thb(Math.abs(p.value))} (ขาย {thb(p.sales)} รายจ่าย {thb(p.expenses)})
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** กราฟแท่งชุดเดียว · ชี้/โฟกัสแท่งเพื่อดูยอด · มีตารางสำหรับโปรแกรมอ่านหน้าจอ */
function BarChart({ points, dense }) {
  const [active, setActive] = useState(null)
  const dataMax = useMemo(() => Math.max(1, ...points.map((p) => p.value)), [points])
  const max = useMemo(() => niceMax(dataMax), [dataMax])
  const total = points.reduce((s, p) => s + p.value, 0)

  if (!points.length || total === 0) return <div className="pos-cart-empty">ยังไม่มียอดขายในช่วงนี้</div>

  const labelEvery = dense ? 5 : 1
  const hovered = active != null ? points[active] : null

  return (
    <div className="pos-chart">
      <div className="pos-chart-tip" aria-hidden="true">
        {hovered ? (
          <span className="pos-chart-pill">
            <strong>{thb(hovered.value)}</strong> {hovered.label}
          </span>
        ) : (
          <span className="pos-chart-pill is-muted">รวม {thb(total)} · ชี้ที่แท่งเพื่อดูยอด</span>
        )}
      </div>
      <div className="pos-chart-body">
        <div className="pos-chart-plotwrap">
          <YGrid ticks={[max, max / 2, 0].map((v) => ({ value: v, pct: (v / max) * 100 }))} />
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
                <span className="pos-chart-bar" style={{ height: `${(Math.max(0, p.value) / max) * 100}%` }} />
              </button>
            ))}
          </div>
        </div>
        <div className="pos-chart-axis" aria-hidden="true">
          {points.map((p, i) => (
            <span key={p.key} className={active === i ? 'is-active' : ''}>
              {i % labelEvery === 0 || i === points.length - 1 ? p.label : ''}
            </span>
          ))}
        </div>
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
