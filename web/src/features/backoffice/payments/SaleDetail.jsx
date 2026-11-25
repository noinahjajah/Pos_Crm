import { baht } from '../useBranchScope'
import { METHOD_LABEL, TYPE_LABEL, dateTime } from './paymentLabels'
import '../menus/menus.css'
import '../backoffice.css'

// หน้าต่างรายละเอียดบิลที่ลูกค้าจ่าย (ใช้ในประวัติการขายและแดชบอร์ด owner)
// payment มาจาก GET /payment/payments (มี order = เมนูในบิล หรือ null ถ้าระบบบิลไม่ตอบ)

/** จับคู่เมนูที่คืนกับรายการในบิล (ด้วย order_item_id · ไม่มี id ใช้ชื่อเมนูแทน) → Map index → { quantity, amount } */
function refundByItem(order, refund) {
  const map = new Map()
  if (!order || !refund?.items.length) return map
  for (const r of refund.items) {
    const idx = order.items.findIndex((i, k) =>
      !map.has(k) && (r.order_item_id && i.id ? i.id === r.order_item_id : i.menu_name === r.menu_name),
    )
    if (idx >= 0) map.set(idx, r)
  }
  return map
}

export default function SaleDetail({ payment: p, branch, onClose }) {
  const o = p.order
  const isRefund = p.type === 'refund'
  const refund = isRefund ? p.refund : null
  // คืนทั้งบิล = คำขอไม่ได้ระบุเมนู (คืนยอดที่เหลือทั้งหมด)
  const wholeBill = Boolean(refund) && refund.items.length === 0
  const refunded = refundByItem(o, refund)
  // เมนูที่คืนแต่หาในบิลไม่เจอ (เช่นระบบบิลไม่ตอบ) → แสดงเป็นรายการแยก
  const unmatched = refund ? refund.items.filter((r) => ![...refunded.values()].includes(r)) : []
  const showRefundCol = isRefund && refunded.size > 0
  const row =(label, value, cls = '') => (
    <tr>
      <td className="bo-muted">{label}</td>
      <td className={`bo-num ${cls}`}>{value}</td>
    </tr>
  )

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mm-dialog mm-dialog-sm" role="dialog" aria-modal="true">
        <h2 className="mm-dialog-title">
          {TYPE_LABEL[p.type]} · บิล {o?.order_no || p.order_id.slice(0, 8)}
        </h2>
        <p className="mm-subtitle" style={{ marginTop: 0 }}>
          {dateTime(p.paid_at)}
          {branch ? ` · สาขา ${branch}` : ''}
          {o?.table_no ? ` · โต๊ะ ${o.table_no}` : ''}
          {o?.guest_count ? ` · ${o.guest_count} ท่าน` : ''}
        </p>

        {isRefund && (
          <div className={`bo-refund-note ${wholeBill ? 'is-whole' : ''}`}>
            <strong>
              {!refund
                ? 'ดึงรายการที่คืนไม่ได้ (ระบบบิลไม่ตอบ)'
                : wholeBill
                  ? 'คืนเงินทั้งบิล'
                  : `คืนเงิน ${refund.items.length} รายการ — แถวที่ไฮไลต์คือเมนูที่คืน`}
            </strong>
            {refund?.reason && <span>เหตุผล: {refund.reason}</span>}
          </div>
        )}

        {o ? (
          <table className="bo-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>รายการ</th>
                <th className="bo-num">จำนวน</th>
                <th className="bo-num">รวม</th>
                {showRefundCol && <th className="bo-num">คืน</th>}
              </tr>
            </thead>
            <tbody>
              {o.items.map((i, idx) => {
                const r = refunded.get(idx)
                const rowCls = showRefundCol ? (r ? 'bo-refunded-row' : 'bo-kept-row') : ''
                return (
                  <tr key={idx} className={rowCls}>
                    <td>
                      {i.menu_name}
                      {r && <span className="bo-refund-tag">คืน</span>}
                      {i.options.length > 0 && <div className="bo-muted" style={{ fontSize: 12 }}>{i.options.join(', ')}</div>}
                    </td>
                    <td className="bo-num">{i.quantity}</td>
                    <td className="bo-num">{baht(i.line_total)}</td>
                    {showRefundCol && (
                      <td className="bo-num">
                        {r ? (
                          <span className="bo-neg">
                            {r.quantity < i.quantity ? `${r.quantity} × ` : ''}−{baht(r.amount)}
                          </span>
                        ) : (
                          <span className="bo-muted">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div className="mm-empty" style={{ marginTop: 12 }}>
            ดึงรายการอาหารของบิลนี้ไม่ได้ (ระบบบิลไม่ตอบ)
          </div>
        )}

        {unmatched.length > 0 && (
          <table className="bo-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>เมนูที่คืน</th>
                <th className="bo-num">จำนวน</th>
                <th className="bo-num">คืน</th>
              </tr>
            </thead>
            <tbody>
              {unmatched.map((r, idx) => (
                <tr key={idx} className="bo-refunded-row">
                  <td>{r.menu_name || '—'}</td>
                  <td className="bo-num">{r.quantity}</td>
                  <td className="bo-num bo-neg">−{baht(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <table className="bo-table" style={{ marginTop: 12 }}>
          <tbody>
            {o && row('ยอดอาหาร', baht(o.subtotal))}
            {o && o.discount_amount > 0 && row('ส่วนลด', `−${baht(o.discount_amount)}`, 'bo-neg')}
            {o && row('VAT 7%', baht(o.vat_amount))}
            {o && row('ยอดบิล', <strong>{baht(o.total)}</strong>)}
            {row('วิธีชำระ', METHOD_LABEL[p.method] || p.method)}
            {p.cash_received != null && row('รับเงินมา', baht(p.cash_received))}
            {p.change_amount != null && row('เงินทอน', baht(p.change_amount))}
            {p.card_last4 && row('บัตรลงท้าย', p.card_last4)}
            {row(
              p.type === 'refund' ? 'คืนเงิน' : 'ลูกค้าจ่าย',
              <strong>
                {p.type === 'refund' ? '−' : ''}
                {baht(p.amount)}
              </strong>,
              p.type === 'refund' ? 'bo-neg' : '',
            )}
          </tbody>
        </table>

        <div className="mm-dialog-actions">
          <button className="mm-btn" onClick={onClose}>
            ปิด
          </button>
        </div>
      </div>
    </div>
  )
}
