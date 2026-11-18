import { useEffect, useState } from 'react'
import { listPayments } from '../../../api/payment'
import { baht, errorText, todayTh, useBranchScope } from '../useBranchScope'
import '../menus/menus.css'
import '../backoffice.css'

// หน้ารายการรับ/คืนเงิน (หลังร้าน)
// manager เห็นสาขาตัวเอง · owner ดูทุกสาขาหรือเลือกทีละสาขา

const PAGE_SIZE = 20
const TYPE_LABEL = { charge: 'รับเงิน', refund: 'คืนเงิน' }
const METHOD_LABEL = { cash: 'เงินสด', promptpay: 'PromptPay' }

const dateTime = (value) => new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

export default function PaymentsPage() {
  const scope = useBranchScope({ allowAll: true })
  const { branchId, branches, isOwner, ready, branchName } = scope
  const today = todayTh()
  const [filters, setFilters] = useState({ from: today, to: today, type: '', method: '' })
  const [page, setPage] = useState(1)
  const [result, setResult] = useState({ items: [], total: 0 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    if (!ready) return
    let cancelled = false
    listPayments({ ...filters, branch_id: branchId, page, limit: PAGE_SIZE })
      .then((res) => {
        if (cancelled) return
        setResult({ items: res.data, total: res.meta?.total || 0 })
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [ready, branchId, filters, page, reloadKey])

  function changeFilter(key, value) {
    setLoading(true)
    setPage(1)
    setFilters((f) => ({ ...f, [key]: value }))
  }

  function goTo(next) {
    setLoading(true)
    setPage(next)
  }

  const { items, total } = result
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const showBranch = isOwner && !branchId

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">รายการรับเงิน</h1>
          <p className="mm-subtitle">{isOwner ? 'ดูได้ทุกสาขา หรือเลือกทีละสาขา' : `สาขา ${branchName(branchId)}`}</p>
        </div>
      </header>

      <div className="bo-filters">
        {isOwner && (
          <label className="mm-field">
            <span>สาขา</span>
            <select
              className="mm-select"
              value={branchId}
              onChange={(e) => {
                setLoading(true)
                setPage(1)
                scope.setBranchId(e.target.value)
              }}
            >
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
          <input className="mm-input" type="date" value={filters.from} max={filters.to} onChange={(e) => changeFilter('from', e.target.value)} />
        </label>
        <label className="mm-field">
          <span>ถึง</span>
          <input className="mm-input" type="date" value={filters.to} min={filters.from} onChange={(e) => changeFilter('to', e.target.value)} />
        </label>
        <label className="mm-field">
          <span>ประเภท</span>
          <select className="mm-select" value={filters.type} onChange={(e) => changeFilter('type', e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="charge">รับเงิน</option>
            <option value="refund">คืนเงิน</option>
          </select>
        </label>
        <label className="mm-field">
          <span>วิธีชำระ</span>
          <select className="mm-select" value={filters.method} onChange={(e) => changeFilter('method', e.target.value)}>
            <option value="">ทั้งหมด</option>
            <option value="cash">เงินสด</option>
            <option value="promptpay">PromptPay</option>
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
                <th>ประเภท</th>
                <th>บิล</th>
                <th>วิธีชำระ</th>
                <th className="bo-num">จำนวนเงิน (บาท)</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>{dateTime(p.paid_at)}</td>
                  {showBranch && <td className="bo-muted">{branchName(p.branch_id) || 'ไม่พบสาขา'}</td>}
                  <td>
                    <span className={`bo-status ${p.type === 'charge' ? 'is-on' : 'is-empty'}`}>{TYPE_LABEL[p.type] || p.type}</span>
                  </td>
                  <td className="bo-muted">{p.order_id.slice(0, 8)}</td>
                  <td>{METHOD_LABEL[p.method] || p.method}</td>
                  <td className={`bo-num ${p.type === 'refund' ? 'bo-neg' : ''}`}>
                    <strong>
                      {p.type === 'refund' ? '−' : ''}
                      {baht(p.amount)}
                    </strong>
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
            หน้า {page} / {pages}
          </span>
          <button className="mm-btn" disabled={page >= pages} onClick={() => goTo(page + 1)}>
            ถัดไป
          </button>
        </div>
      )}
    </div>
  )
}
