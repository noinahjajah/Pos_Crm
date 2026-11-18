import { fmt, lineTotal, tableLabel } from './checkoutUtils'

// ใบเสร็จหลังรับเงินสำเร็จ (1.23): ยอดก่อน VAT / VAT / ยอดสุทธิ + เงินทอน
// ปุ่มพิมพ์ใช้ window.print() พิมพ์เฉพาะกล่องใบเสร็จ (ดู @media print ใน checkout.css)

const METHOD = { cash: 'เงินสด', promptpay: 'PromptPay' }

export default function Receipt({ order, payment, changeAmount, onDone }) {
  const paidAt = new Date(payment.paid_at).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })

  return (
    <div className="co-receipt-wrap">
      <div className="co-success">
        <div className="co-success-icon" aria-hidden="true">
          ✓
        </div>
        <div>
          <strong>รับเงินเรียบร้อย</strong>
          {payment.method === 'cash' && (
            <div className="co-success-change">
              เงินทอน <b>฿{fmt(changeAmount)}</b>
            </div>
          )}
          {!payment.order_status_synced && (
            <div className="co-hint">บันทึกเงินแล้ว ระบบกำลังอัปเดตสถานะโต๊ะ (ลองใหม่อัตโนมัติ)</div>
          )}
        </div>
      </div>

      <article className="co-receipt" id="co-receipt">
        <header>
          <h2>ใบเสร็จรับเงิน</h2>
          <p>
            บิล {order.order_no || order.id.slice(0, 8)} · โต๊ะ {tableLabel(order)}
          </p>
          <p>{paidAt}</p>
        </header>

        <ul className="co-receipt-items">
          {(order.items || []).map((it, i) => (
            <li key={it.id || i}>
              <span>
                {it.quantity} × {it.menu_name}
                {(it.options || []).length > 0 && <small>{it.options.map((o) => o.option_name || o.name).join(', ')}</small>}
              </span>
              <span>{fmt(lineTotal(it))}</span>
            </li>
          ))}
        </ul>

        <dl className="co-receipt-totals">
          <div>
            <dt>ยอดก่อน VAT</dt>
            <dd>{fmt(order.subtotal)}</dd>
          </div>
          {Number(order.discount_amount) > 0 && (
            <div>
              <dt>ส่วนลด</dt>
              <dd>−{fmt(order.discount_amount)}</dd>
            </div>
          )}
          <div>
            <dt>VAT 7%</dt>
            <dd>{fmt(order.vat_amount)}</dd>
          </div>
          <div className="co-receipt-grand">
            <dt>ยอดสุทธิ</dt>
            <dd>{fmt(payment.amount)}</dd>
          </div>
          <div>
            <dt>ชำระโดย</dt>
            <dd>{METHOD[payment.method] || payment.method}</dd>
          </div>
          {payment.method === 'cash' && (
            <>
              <div>
                <dt>รับเงิน</dt>
                <dd>{fmt(payment.cash_received)}</dd>
              </div>
              <div>
                <dt>เงินทอน</dt>
                <dd>{fmt(changeAmount)}</dd>
              </div>
            </>
          )}
        </dl>
        <footer>ขอบคุณที่ใช้บริการ</footer>
      </article>

      <div className="co-receipt-actions">
        <button className="co-btn" onClick={() => window.print()}>
          🖨️ พิมพ์ใบเสร็จ
        </button>
        {onDone && (
          <button className="co-btn co-btn-primary" onClick={onDone}>
            เสร็จสิ้น กลับไปหน้าคิดเงิน
          </button>
        )}
      </div>
    </div>
  )
}
