import PrintSlip from '../../components/print/PrintSlip'
import { baht, thaiDateTime } from '../../lib/format'
import { billNumbers, lineTotal, tableLabel } from './checkoutUtils'

// ใบแจ้งยอด (ก่อนชำระเงิน) ให้ลูกค้าตรวจรายการ — ใช้กรอบพิมพ์ 58 มม. ของ Dev 1
// ไม่ใช่ใบเสร็จ ใบเสร็จพิมพ์หลังรับเงินด้วย ReceiptPrint

export default function BillPrint({ order, branchName, ...slipProps }) {
  const n = billNumbers(order)
  const items = order.items || []
  return (
    <PrintSlip label="ใบแจ้งยอด" {...slipProps}>
      <div className="ps-center">
        {branchName && <div className="ps-small">{branchName}</div>}
        <div className="ps-title">ใบแจ้งยอด</div>
        <div className="ps-small">(ไม่ใช่ใบเสร็จรับเงิน)</div>
      </div>
      <dl className="ps-meta">
        <div>
          <dt>บิล</dt>
          <dd>{order.order_no || order.id?.slice(0, 8)}</dd>
        </div>
        <div>
          <dt>โต๊ะ</dt>
          <dd>{tableLabel(order)}</dd>
        </div>
        <div>
          <dt>เวลา</dt>
          <dd>{thaiDateTime(new Date())}</dd>
        </div>
      </dl>
      <hr className="ps-rule" />
      <ul className="ps-items">
        {items.map((it, i) => (
          <li key={it.id || i}>
            <div className="ps-row">
              <span>
                {it.quantity} × {it.menu_name}
              </span>
              <span className="ps-amount">{baht(lineTotal(it))}</span>
            </div>
          </li>
        ))}
      </ul>
      <hr className="ps-rule" />
      <div className="ps-totals">
        <div className="ps-row">
          <span>จำนวนรายการ</span>
          <span className="ps-amount">{items.length} รายการ</span>
        </div>
        <div className="ps-row">
          <span>ยอดรวมรายการ</span>
          <span className="ps-amount">{baht(n.subtotal)}</span>
        </div>
        {n.discount > 0 && (
          <div className="ps-row">
            <span>ส่วนลด</span>
            <span className="ps-amount">−{baht(n.discount)}</span>
          </div>
        )}
        <div className="ps-row">
          <span>ยอดก่อน VAT</span>
          <span className="ps-amount">{baht(n.beforeVat)}</span>
        </div>
        <div className="ps-row">
          <span>VAT 7%</span>
          <span className="ps-amount">{baht(n.vat)}</span>
        </div>
        <div className="ps-row ps-grand">
          <span>ยอดสุทธิ</span>
          <span className="ps-amount">{baht(n.total)}</span>
        </div>
      </div>
    </PrintSlip>
  )
}
