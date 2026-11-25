import { baht } from '../useBranchScope'
import { METHOD_LABEL, TYPE_LABEL, dateTime } from './paymentLabels'
import '../menus/menus.css'
import '../backoffice.css'

// หน้าต่างรายละเอียดบิลที่ลูกค้าจ่าย (ใช้ในประวัติการขายและแดชบอร์ด owner)
// payment มาจาก GET /payment/payments (มี order = เมนูในบิล หรือ null ถ้าระบบบิลไม่ตอบ)

export default function SaleDetail({ payment: p, branch, onClose }) {
  const o = p.order
  const row = (label, value, cls = '') => (
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

        {o ? (
          <table className="bo-table" style={{ marginTop: 12 }}>
            <thead>
              <tr>
                <th>รายการ</th>
                <th className="bo-num">จำนวน</th>
                <th className="bo-num">รวม</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i, idx) => (
                <tr key={idx}>
                  <td>
                    {i.menu_name}
                    {i.options.length > 0 && <div className="bo-muted" style={{ fontSize: 12 }}>{i.options.join(', ')}</div>}
                  </td>
                  <td className="bo-num">{i.quantity}</td>
                  <td className="bo-num">{baht(i.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="mm-empty" style={{ marginTop: 12 }}>
            ดึงรายการอาหารของบิลนี้ไม่ได้ (ระบบบิลไม่ตอบ)
          </div>
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
