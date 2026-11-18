import { useEffect, useState } from 'react'
import { EXPENSE_CATEGORIES, getBranchReport, getDailyReport, getProfitReport } from '../../../api/payment'
import { useBranchScope } from '../useBranchScope'
import { baht, errorText, thaiDate, todayTh } from '../../../lib/format.js'
import '../menus/menus.css'
import '../backoffice.css'

// แดชบอร์ด (หลังร้าน) — 1.34–1.37
// manager: รายวันของสาขาตัวเอง · owner: รายวัน + เปรียบเทียบสาขา + กำไรรายเดือน
// ยอดขาย = เงินที่รับ (รวม VAT) · รายรับ = ยอดขาย − เงินที่คืน · กำไร = รายรับ − รายจ่าย

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']

export default function ReportsPage() {
  const scope = useBranchScope({ allowAll: true })
  const { isOwner, canManage, branches, branchId, ready } = scope
  const [tab, setTab] = useState('daily')

  if (scope.me && !canManage) {
    return (
      <div className="mm-page">
        <div className="mm-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">แดชบอร์ด</h1>
          <p className="mm-subtitle">{isOwner ? 'ภาพรวมทุกสาขา หรือเลือกดูทีละสาขา' : `สาขา ${scope.branchName(branchId)}`}</p>
        </div>
        {isOwner && tab !== 'branches' && (
          <select className="mm-select" value={branchId} onChange={(e) => scope.setBranchId(e.target.value)}>
            <option value="">ทุกสาขา</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {isOwner && (
        <div className="bo-tabs">
          {[
            ['daily', 'รายวัน'],
            ['branches', 'เปรียบเทียบสาขา'],
            ['profit', 'กำไรรายเดือน'],
          ].map(([key, label]) => (
            <button key={key} className={`bo-tab ${tab === key ? 'is-active' : ''}`} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {scope.error && <div className="mm-alert">{scope.error}</div>}

      {ready && tab === 'daily' && <DailyReport branchId={branchId} />}
      {ready && isOwner && tab === 'branches' && <BranchReport branchName={scope.branchName} />}
      {ready && isOwner && tab === 'profit' && <ProfitReport branchId={branchId} branchName={scope.branchName} />}
    </div>
  )
}

/** โหลดรายงานใหม่เมื่อพารามิเตอร์เปลี่ยน (key = ค่าที่ใช้เทียบ) */
function useReport(load, key) {
  const [state, setState] = useState({ data: null, error: '', key: null })
  useEffect(() => {
    let cancelled = false
    load()
      .then((data) => !cancelled && setState({ data, error: '', key }))
      .catch((err) => !cancelled && setState({ data: null, error: errorText(err), key }))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return { ...state, loading: state.key !== key }
}

// ---------- 1.34, 1.35 รายวัน ----------
function DailyReport({ branchId }) {
  const [date, setDate] = useState(todayTh())
  const { data, error, loading } = useReport(() => getDailyReport({ date, branch_id: branchId }), `${date}|${branchId}`)

  const expenseMax = Math.max(1, ...Object.values(data?.expenses?.by_category ?? {}))

  return (
    <>
      <div className="bo-filters">
        <label className="mm-field">
          <span>วันที่</span>
          <input className="mm-input" type="date" value={date} max={todayTh()} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>

      {error && <div className="mm-alert">{error}</div>}
      {data?.warnings?.map((w) => (
        <div key={w.code} className="bo-warning">
          {w.message}
        </div>
      ))}

      {loading || !data ? (
        !error && <div className="mm-card mm-skeleton" />
      ) : (
        <>
          <div className="bo-kpis">
            <div className="bo-kpi is-main">
              <div className="bo-kpi-label">ยอดขายสุทธิ</div>
              <div className="bo-kpi-value">฿{baht(data.net_sales)}</div>
              <div className="bo-kpi-sub">{thaiDate(data.date)}</div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">จำนวนบิล</div>
              <div className="bo-kpi-value">{data.bill_count}</div>
              <div className="bo-kpi-sub">บิลที่รับเงินแล้ว</div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">เฉลี่ยต่อบิล</div>
              <div className="bo-kpi-value">฿{baht(data.avg_per_bill)}</div>
              <div className="bo-kpi-sub">ยอดขาย ÷ จำนวนบิล</div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">คืนเงิน</div>
              <div className={`bo-kpi-value ${data.refunds > 0 ? 'bo-neg' : ''}`}>฿{baht(data.refunds)}</div>
              <div className="bo-kpi-sub">ยอดขายก่อนหักคืน ฿{baht(data.sales)}</div>
            </div>
          </div>

          <div className="bo-panels">
            <section className="bo-panel">
              <h3 className="bo-panel-title">เมนูขายดี</h3>
              {!data.top_menus ? (
                <p className="bo-muted">ยังดึงข้อมูลไม่ได้</p>
              ) : data.top_menus.length === 0 ? (
                <p className="bo-muted">ยังไม่มีรายการขายวันนี้</p>
              ) : (
                <ol className="bo-rank">
                  {data.top_menus.map((m, i) => (
                    <li key={m.menu_id}>
                      <span className="bo-rank-no">{i + 1}</span>
                      <span>
                        <strong>{m.menu_name}</strong>
                        <div className="bo-muted" style={{ fontSize: 12 }}>
                          ฿{baht(m.amount)}
                        </div>
                      </span>
                      <strong>{m.quantity} จาน</strong>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="bo-panel">
              <h3 className="bo-panel-title">รายจ่ายวันนี้ · ฿{baht(data.expenses.total)}</h3>
              <div className="bo-bars">
                {EXPENSE_CATEGORIES.map((c) => {
                  const value = data.expenses.by_category[c.value] ?? 0
                  return (
                    <div key={c.value}>
                      <div className="bo-bar-head">
                        <span>{c.label}</span>
                        <strong>฿{baht(value)}</strong>
                      </div>
                      <div className="bo-bar-track">
                        <div className="bo-bar-fill" style={{ width: `${(value / expenseMax) * 100}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </>
      )}
    </>
  )
}

// ---------- 1.36 เปรียบเทียบสาขา ----------
function BranchReport({ branchName }) {
  const today = todayTh()
  const [range, setRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today })
  const { data, error, loading } = useReport(() => getBranchReport(range), `${range.from}|${range.to}`)
  const max = Math.max(1, ...(data?.branches ?? []).map((b) => b.net_sales))

  return (
    <>
      <div className="bo-filters">
        <label className="mm-field">
          <span>ตั้งแต่</span>
          <input className="mm-input" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </label>
        <label className="mm-field">
          <span>ถึง</span>
          <input className="mm-input" type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </label>
      </div>

      {error && <div className="mm-alert">{error}</div>}

      {loading || !data ? (
        !error && <div className="mm-card mm-skeleton" />
      ) : (
        <>
          <div className="bo-kpis">
            <div className="bo-kpi is-main">
              <div className="bo-kpi-label">ยอดขายสุทธิรวม</div>
              <div className="bo-kpi-value">฿{baht(data.total.net_sales)}</div>
              <div className="bo-kpi-sub">
                {thaiDate(data.from)} – {thaiDate(data.to)}
              </div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">จำนวนบิลรวม</div>
              <div className="bo-kpi-value">{data.total.bill_count}</div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">เฉลี่ยต่อบิล</div>
              <div className="bo-kpi-value">฿{baht(data.total.avg_per_bill)}</div>
            </div>
          </div>

          {data.branches.length === 0 ? (
            <div className="mm-empty">ยังไม่มียอดขายในช่วงนี้</div>
          ) : (
            <div className="bo-panels">
              <section className="bo-panel">
                <h3 className="bo-panel-title">ยอดขายสุทธิแต่ละสาขา</h3>
                <div className="bo-bars">
                  {data.branches.map((b) => (
                    <div key={b.branch_id}>
                      <div className="bo-bar-head">
                        <span>{branchName(b.branch_id) || 'สาขาที่ปิดไปแล้ว'}</span>
                        <strong>฿{baht(b.net_sales)}</strong>
                      </div>
                      <div className="bo-bar-track">
                        <div className="bo-bar-fill" style={{ width: `${(b.net_sales / max) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
              <section className="bo-table-wrap">
                <table className="bo-table">
                  <thead>
                    <tr>
                      <th>สาขา</th>
                      <th className="bo-num">บิล</th>
                      <th className="bo-num">เฉลี่ย/บิล</th>
                      <th className="bo-num">คืนเงิน</th>
                      <th className="bo-num">สุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.branches.map((b) => (
                      <tr key={b.branch_id}>
                        <td>{branchName(b.branch_id) || 'สาขาที่ปิดไปแล้ว'}</td>
                        <td className="bo-num">{b.bill_count}</td>
                        <td className="bo-num">{baht(b.avg_per_bill)}</td>
                        <td className="bo-num bo-neg">{b.refunds ? baht(b.refunds) : '—'}</td>
                        <td className="bo-num">
                          <strong>{baht(b.net_sales)}</strong>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          )}
        </>
      )}
    </>
  )
}

// ---------- 1.37 กำไรรายเดือน ----------
function ProfitReport({ branchId, branchName }) {
  const thisYear = Number(todayTh().slice(0, 4))
  const [year, setYear] = useState(thisYear)
  const { data, error, loading } = useReport(() => getProfitReport({ year, branch_id: branchId }), `${year}|${branchId}`)

  // ทุกสาขา = ใช้ totals_by_month · สาขาเดียว = แถวของสาขานั้น
  const months = data ? (branchId ? data.branches[0]?.months ?? emptyMonths(year) : data.totals_by_month) : []
  const total = data ? (branchId ? data.branches[0]?.total ?? { revenue: 0, expenses: 0, profit: 0 } : data.total) : null
  const maxAbs = Math.max(1, ...months.map((m) => Math.abs(m.profit)))

  return (
    <>
      <div className="bo-filters">
        <label className="mm-field">
          <span>ปี</span>
          <select className="mm-select" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
              <option key={y} value={y}>
                {y + 543}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <div className="mm-alert">{error}</div>}

      {loading || !data ? (
        !error && <div className="mm-card mm-skeleton" />
      ) : (
        <>
          <div className="bo-kpis">
            <div className={`bo-kpi ${total.profit >= 0 ? 'is-main' : ''}`}>
              <div className="bo-kpi-label">กำไรทั้งปี</div>
              <div className={`bo-kpi-value ${total.profit < 0 ? 'bo-neg' : ''}`}>
                {total.profit < 0 ? '−' : ''}฿{baht(Math.abs(total.profit))}
              </div>
              <div className="bo-kpi-sub">{branchName(branchId)}</div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">รายรับ</div>
              <div className="bo-kpi-value">฿{baht(total.revenue)}</div>
            </div>
            <div className="bo-kpi">
              <div className="bo-kpi-label">รายจ่าย</div>
              <div className="bo-kpi-value">฿{baht(total.expenses)}</div>
            </div>
          </div>

          <section className="bo-panel" style={{ marginBottom: 16 }}>
            <h3 className="bo-panel-title">กำไรรายเดือน (เขียว = กำไร, แดง = ขาดทุน)</h3>
            <div className="bo-columns">
              {months.map((m) => {
                const h = `${(Math.abs(m.profit) / maxAbs) * 100}%`
                return (
                  <div key={m.month} className="bo-col" title={`${m.month}: ฿${baht(m.profit)}`}>
                    <div className="bo-col-half is-top">
                      {m.profit > 0 && <div className="bo-col-bar is-pos" style={{ height: h }} />}
                    </div>
                    <div className="bo-col-half is-bottom">
                      {m.profit < 0 && <div className="bo-col-bar is-neg" style={{ height: h }} />}
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="bo-col-labels">
              {MONTHS.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
          </section>

          <div className="bo-table-wrap">
            <table className="bo-table">
              <thead>
                <tr>
                  <th>เดือน</th>
                  <th className="bo-num">รายรับ</th>
                  <th className="bo-num">รายจ่าย</th>
                  <th className="bo-num">กำไร</th>
                </tr>
              </thead>
              <tbody>
                {months.map((m, i) => (
                  <tr key={m.month}>
                    <td>
                      {MONTHS[i]} {year + 543}
                    </td>
                    <td className="bo-num">{baht(m.revenue)}</td>
                    <td className="bo-num">{baht(m.expenses)}</td>
                    <td className={`bo-num ${m.profit < 0 ? 'bo-neg' : m.profit > 0 ? 'bo-pos' : ''}`}>
                      <strong>{baht(m.profit)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>รวมทั้งปี</td>
                  <td className="bo-num">{baht(total.revenue)}</td>
                  <td className="bo-num">{baht(total.expenses)}</td>
                  <td className={`bo-num ${total.profit < 0 ? 'bo-neg' : ''}`}>{baht(total.profit)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </>
  )
}

function emptyMonths(year) {
  return MONTHS.map((_, i) => ({ month: `${year}-${String(i + 1).padStart(2, '0')}`, revenue: 0, expenses: 0, profit: 0 }))
}
