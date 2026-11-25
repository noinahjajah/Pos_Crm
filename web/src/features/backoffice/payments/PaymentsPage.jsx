import { useEffect, useState } from 'react'
import { listPayments } from '../../../api/payment'
import { baht, errorText, todayTh, useBranchScope } from '../useBranchScope'
import { METHOD_LABEL, TYPE_LABEL, dateTime } from './paymentLabels'
import SaleDetail from './SaleDetail'
import '../menus/menus.css'
import '../backoffice.css'

// ประวัติการขาย (หลังร้าน) — เงินที่ลูกค้าแต่ละร้านจ่าย + คืนเงิน
// manager เห็นสาขาตัวเอง · owner ดูทุกสาขา (มีสรุปแยกสาขา) หรือเลือกทีละสาขา
// กดแถวเพื่อดูเมนูในบิลที่ลูกค้าจ่าย

const PAGE_SIZE = 20

/** วันที่ไทย n วันก่อน 'YYYY-MM-DD' */
const daysAgo = (n) => new Date(Date.now() + 7 * 3600e3 - n * 86400e3).toISOString().slice(0, 10)

function quickRanges() {
  const today = todayTh()
  return [
    { label: 'วันนี้', from: today, to: today },
    { label: 'เมื่อวาน', from: daysAgo(1), to: daysAgo(1) },
    { label: '7 วัน', from: daysAgo(6), to: today },
    { label: 'เดือนนี้', from: `${today.slice(0, 8)}01`, to: today },
  ]
}

export default function PaymentsPage() {
  const scope = useBranchScope({ allowAll: true })
  const { branchId, branches, isOwner, ready, branchName } = scope
  const today = todayTh()
  const [filters, setFilters] = useState({ from: today, to: today, type: '', method: '' })
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], total: 0, summary: null })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    listPayments({ ...filters, branch_id: branchId, page, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        setResult({ items: res.data, total: res.meta?.total || 0, summary: res.meta?.summary || null })
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [ready, branchId, filters, page, reloadKey])

  function changeFilters(patch) {
    setLoading(true)
    setPage(1)
    setFilters((f) => ({ ...f, ...patch }))
  }

  function changeBranch(id) {
    setLoading(true)
    setPage(1)
    scope.setBranchId(id)
  }

  function goTo(next) {
    setLoading(true)
    setPage(next)
  }

  const { items, total, summary } = result
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showBranch = isOwner && !branchId
  const avg = summary?.bills ? summary.sales / summary.bills : 0

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">ประวัติการขาย</h1>
          <p className="mm-subtitle">
            {isOwner ? 'ยอดที่ลูกค้าจ่ายของทุกสาขา หรือเลือกทีละสาขา' : `ยอดที่ลูกค้าจ่าย สาขา ${branchName(branchId)}`}
          </p>
        </div>
      </header>

      <div className="bo-tabs" style={{ marginBottom: 12 }}>
        {quickRanges().map((r) => (
          <button
            key={r.label}
            className={`bo-tab ${filters.from === r.from && filters.to === r.to ? 'is-active' : ''}`}
            onClick={() => changeFilters({ from: r.from, to: r.to })}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="bo-filters">
        {isOwner && (
          <label className="mm-field">
            <span>สาขา</span>
            <select className="mm-select" value={branchId} onChange={(e) => changeBranch(e.target.value)}>
              <option value="">ทุกสาขา</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="mm-field">
          <span>ตั้งแต่</span>
          <input className="mm-input" type="date" value={filters.from} max={filters.to} onChange={(e) => changeFilters({ from: e.target.value })} />
        </label>
        <label className="mm-field">
          <span>ถึง</span>
          <input className="mm-input" type="date" value={filters.to} min={filters.from} max={today} onChange={(e) => changeFilters({ to: e.target.value })} />
        </label>
        <label className="mm-field">
          <span>ประเภท</span>
          <select className="mm-select" value={filters.type} onChange={(e) => changeFilters({ type: e.target.value })}>
            <option value="">ทั้งหมด</option>
            <option value="charge">รับเงิน</option>
            <option value="refund">คืนเงิน</option>
          </select>
        </label>
        <label className="mm-field">
          <span>วิธีชำระ</span>
          <select className="mm-select" value={filters.method} onChange={(e) => changeFilters({ method: e.target.value })}>
            <option value="">ทั้งหมด</option>
            <option value="cash">เงินสด</option>
            <option value="promptpay">PromptPay</option>
            <option value="credit_card">บัตรเครดิต/เดบิต</option>
          </select>
        </label>
      </div>

      {(error || scope.error) && (
        <div className="mm-alert">
          {error || scope.error}
          <button
            className="mm-link"
            onClick={() => {
              setLoading(true)
              setReloadKey((k) => k + 1)
            }}
          >
            ลองใหม่
          </button>
        </div>
      )}

      {summary && (
        <div className="bo-kpis">
          <div className="bo-kpi is-main">
            <div className="bo-kpi-label">ยอดขายสุทธิ</div>
            <div className="bo-kpi-value">{baht(summary.net)}</div>
            <div className="bo-kpi-sub">ยอดขาย − คืนเงิน (บาท)</div>
          </div>
          <div className="bo-kpi">
            <div className="bo-kpi-label">ยอดขาย</div>
            <div className="bo-kpi-value">{baht(summary.sales)}</div>
            <div className="bo-kpi-sub">{summary.bills.toLocaleString('th-TH')} บิล</div>
          </div>
          <div className="bo-kpi">
            <div className="bo-kpi-label">คืนเงิน</div>
            <div className="bo-kpi-value">{baht(summary.refunds)}</div>
            <div className="bo-kpi-sub">{summary.refund_count.toLocaleString('th-TH')} รายการ</div>
          </div>
          <div className="bo-kpi">
            <div className="bo-kpi-label">เฉลี่ยต่อบิล</div>
            <div className="bo-kpi-value">{baht(avg)}</div>
            <div className="bo-kpi-sub">บาท</div>
          </div>
        </div>
      )}

      {showBranch && summary?.branches?.length > 0 && (
        <div className="bo-panel" style={{ marginBottom: 20 }}>
          <h2 className="bo-panel-title">แยกตามสาขา</h2>
          <div className="bo-table-wrap">
            <table className="bo-table">
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th className="bo-num">บิล</th>
                  <th className="bo-num">ยอดขาย</th>
                  <th className="bo-num">คืนเงิน</th>
                  <th className="bo-num">สุทธิ (บาท)</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {summary.branches.map((b) => (
                  <tr key={b.branch_id}>
                    <td>
                      <strong>{branchName(b.branch_id) || 'ไม่พบสาขา'}</strong>
                    </td>
                    <td className="bo-num">{b.bills.toLocaleString('th-TH')}</td>
                    <td className="bo-num">{baht(b.sales)}</td>
                    <td className={`bo-num ${b.refunds ? 'bo-neg' : 'bo-muted'}`}>{b.refunds ? `−${baht(b.refunds)}` : '-'}</td>
                    <td className="bo-num">
                      <strong>{baht(b.net)}</strong>
                    </td>
                    <td className="bo-num">
                      <button className="mm-link" onClick={() => changeBranch(b.branch_id)}>
                        ดูรายการ
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : items.length === 0 ? (
        <div className="mm-empty">ไม่มีรายการในช่วงนี้</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>เวลา</th>
                {showBranch && <th>สาขา</th>}
                <th>บิล</th>
                <th>โต๊ะ</th>
                <th>ประเภท</th>
                <th>วิธีชำระ</th>
                <th className="bo-num">จำนวนเงิน (บาท)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} onClick={() => setSelected(p)} style={{ cursor: 'pointer' }}>
                  <td>{dateTime(p.paid_at)}</td>
                  {showBranch && <td className="bo-muted">{branchName(p.branch_id) || 'ไม่พบสาขา'}</td>}
                  <td>{p.order?.order_no || <span className="bo-muted">{p.order_id.slice(0, 8)}</span>}</td>
                  <td className="bo-muted">{p.order?.table_no || '-'}</td>
                  <td>
                    <span className={`bo-status ${p.type === 'charge' ? 'is-on' : 'is-empty'}`}>{TYPE_LABEL[p.type] || p.type}</span>
                  </td>
                  <td>{METHOD_LABEL[p.method] || p.method}</td>
                  <td className={`bo-num ${p.type === 'refund' ? 'bo-neg' : ''}`}>
                    <strong>
                      {p.type === 'refund' ? '−' : ''}
                      {baht(p.amount)}
                    </strong>
                  </td>
                  <td className="bo-num">
                    <button className="mm-link">ดูบิล</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <div className="mm-dialog-actions">
          <button className="mm-btn" disabled={page <= 1} onClick={() => goTo(page - 1)}>
            ก่อนหน้า
          </button>
          <span className="bo-muted" style={{ alignSelf: 'center' }}>
            หน้า {page} / {pages} · ทั้งหมด {total.toLocaleString('th-TH')} รายการ
          </span>
          <button className="mm-btn" disabled={page >= pages} onClick={() => goTo(page + 1)}>
            ถัดไป
          </button>
        </div>
      )}

      {selected && <SaleDetail payment={selected} branch={branchName(selected.branch_id)} onClose={() => setSelected(null)} />}
    </div>
  )
}
