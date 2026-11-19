import { VAT_RATE } from '../../lib/constants'
import { billNumbers, thb2 } from './checkoutUtils'

// สรุปยอดบิลตามสูตร spec 1.24 — ราคาเมนูยังไม่รวม VAT

export default function BillSummary({ order, title = 'สรุปยอด' }) {
  const n = billNumbers(order)
  return (
    <div className="pos-panel">
      <h2 className="pos-panel-title">{title}</h2>
      <div className="pos-sum">
        <span>ยอดรวมรายการ</span>
        <span>{thb2(n.subtotal)}</span>
      </div>
      {n.discount > 0 && (
        <div className="pos-sum">
          <span>ส่วนลด (อนุมัติแล้ว)</span>
          <span>-{thb2(n.discount)}</span>
        </div>
      )}
      <div className="pos-sum">
        <span>ยอดก่อน VAT</span>
        <span>{thb2(n.beforeVat)}</span>
      </div>
      <div className="pos-sum">
        <span>VAT {Math.round(VAT_RATE * 100)}%</span>
        <span>{thb2(n.vat)}</span>
      </div>
      <div className="pos-sum is-total is-grand">
        <span>ยอดสุทธิ</span>
        <strong>{thb2(n.total)}</strong>
      </div>
      <p className="pos-muted pos-small" style={{ margin: 0 }}>
        ราคาเมนูยังไม่รวม VAT · คิด VAT 7% จากยอดหลังหักส่วนลด
      </p>
    </div>
  )
}
