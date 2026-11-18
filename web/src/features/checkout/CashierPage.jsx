import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { createRefund, listApprovedRefunds, listWaitingOrders } from '../../api/payment'
import { baht, errorText, useToast } from '../backoffice/useBranchScope'
import { tableLabel } from './checkoutUtils'
import '../backoffice/menus/menus.css'
import '../backoffice/backoffice.css'

// หน้าคิดเงินของพนักงาน — บิลรอชำระ และคำขอคืนเงินที่อนุมัติแล้ว (1.23, 1.25, 1.30)

export default function CashierPage() {
  const [orders, setOrders] = useState([])
  const [refunds, setRefunds] = useState([])
  const [methods, setMethods] = useState({}) // approval id → วิธีคืนเงิน
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  useEffect(() => {
    let cancelled = false
    Promise.all([listWaitingOrders(), listApprovedRefunds()])
      .then(([orderRows, refundRows]) => {
        if (cancelled) return
        setOrders(orderRows)
        setRefunds(refundRows)
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  async function refund(row) {
    const method = methods[row.id] || 'cash'
    const label = method === 'cash' ? 'เงินสด' : 'PromptPay'
    if (!window.confirm(`คืนเงิน ${baht(row.amount)} บาท ให้บิล ${row.order_no || row.order_id.slice(0, 8)} ด้วย${label} ?`)) return
    setBusyId(row.id)
    try {
      // key ผูกกับคำขอ กดซ้ำหรือเน็ตหลุดแล้วกดใหม่ก็ไม่คืนเงินซ้ำ
      await createRefund({ approval_id: row.id, method }, `refund-${row.id}`)
      notify(`คืนเงิน ${baht(row.amount)} บาทแล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">คิดเงิน</h1>
          <p className="mm-subtitle">เลือกบิลที่รอชำระ หรือคืนเงินตามคำขอที่อนุมัติแล้ว</p>
        </div>
        <div className="mm-header-actions">
          <button className="mm-btn" onClick={reload} disabled={loading}>
            รีเฟรช
          </button>
        </div>
      </header>

      {error && (
        <div className="mm-alert">
          {error}
          <button className="mm-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <h2 className="bo-panel-title">บิลรอชำระ</h2>
      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : orders.length === 0 ? (
        <div className="mm-empty">ไม่มีบิลรอชำระ</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>บิล</th>
                <th>โต๊ะ</th>
                <th className="bo-num">ยอดสุทธิ (บาท)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id}>
                  <td>
                    <strong>{o.order_no || o.id.slice(0, 8)}</strong>
                  </td>
                  <td className="bo-muted">{tableLabel(o)}</td>
                  <td className="bo-num">
                    <strong>{baht(o.total)}</strong>
                  </td>
                  <td>
                    <div className="bo-row-actions">
                      <Link className="mm-btn mm-btn-primary" style={{ textDecoration: 'none' }} to={`/checkout/${o.id}`}>
                        คิดเงิน
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="bo-panel-title" style={{ marginTop: 28 }}>
        คำขอคืนเงินที่อนุมัติแล้ว
      </h2>
      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : refunds.length === 0 ? (
        <div className="mm-empty">ไม่มีรายการที่ต้องคืนเงิน</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th>บิล</th>
                <th>เหตุผล</th>
                <th className="bo-num">ยอดคืน (บาท)</th>
                <th>คืนด้วย</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {refunds.map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.order_no || r.order_id.slice(0, 8)}</strong>
                  </td>
                  <td className="bo-wrap bo-muted">{r.reason || '—'}</td>
                  <td className="bo-num">
                    <strong>{baht(r.amount)}</strong>
                  </td>
                  <td>
                    <select
                      className="mm-select"
                      aria-label="วิธีคืนเงิน"
                      value={methods[r.id] || 'cash'}
                      onChange={(e) => setMethods((m) => ({ ...m, [r.id]: e.target.value }))}
                      disabled={busyId === r.id}
                    >
                      <option value="cash">เงินสด</option>
                      <option value="promptpay">PromptPay</option>
                    </select>
                  </td>
                  <td>
                    <div className="bo-row-actions">
                      <button className="mm-btn mm-btn-danger" onClick={() => refund(r)} disabled={busyId === r.id}>
                        {busyId === r.id ? 'กำลังคืนเงิน…' : 'คืนเงิน'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {toast && <div className={`mm-toast ${toast.type === 'error' ? 'is-error' : ''}`}>{toast.message}</div>}
    </div>
  )
}
