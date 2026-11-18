import { VAT_RATE } from '../../lib/constants'
import { baht, thaiDateTime } from '../../lib/format'
import PrintSlip from './PrintSlip'

// ใบเสร็จรับเงิน (1.10, 1.23–1.24): รายการ · ยอดก่อน VAT · ส่วนลด · VAT 7% · ยอดสุทธิ · การชำระ
// order มาจาก GET /pos/orders/:id (Dev 3) · payment มาจาก POST /payment/payments (Dev 2)
//
// order:   { order_no, tables, guest_count?, items: [{ menu_name, quantity, unit_price, options?, line_total? }],
//            subtotal, discount_amount, vat_amount, total }
// payment: { method: 'cash'|'promptpay', amount, cash_received?, change_amount?, paid_at, cashier_name? }
// branch:  { name, address?, phone? } (ไม่บังคับ)

const METHOD = { cash: 'เงินสด', promptpay: 'PromptPay' }

function lineTotal(item) {
  if (item.line_total != null) return Number(item.line_total)
  const extra = (item.options || []).reduce((s, o) => s + Number(o.extra_price || 0), 0)
  return (Number(item.unit_price || 0) + extra) * Number(item.quantity || 0)
}

const tableText = (order) =>
  (order.tables || [])
    .map((t) => (typeof t === 'string' ? t : t.table_no))
    .filter(Boolean)
    .join(', ') ||
  order.table_no ||
  '-'

export default function ReceiptPrint({ order, payment, branch, ...slipProps }) {
  const items = order.items || []
  // ใช้ยอดจาก pos เป็นหลัก คำนวณเองเฉพาะเมื่อไม่มีส่ง (vat = (subtotal − discount) × 7%)
  const subtotal = Number(order.subtotal ?? items.reduce((s, it) => s + lineTotal(it), 0))
  const discount = Number(order.discount_amount || 0)
  const vat = Number(order.vat_amount ?? (subtotal - discount) * VAT_RATE)
  const total = Number(payment?.amount ?? order.total ?? subtotal - discount + vat)
  const change =
    payment?.change_amount ?? (payment?.method === 'cash' ? Number(payment.cash_received || 0) - total : 0)

  return (
    <PrintSlip label="ใบเสร็จรับเงิน" {...slipProps}>
      <div className="ps-center">
        <div className="ps-title">{branch?.name || 'ใบเสร็จรับเงิน'}</div>
        {branch?.address && <div className="ps-small">{branch.address}</div>}
        {branch?.phone && <div className="ps-small">โทร {branch.phone}</div>}
        {branch?.name && <div className="ps-subtitle">ใบเสร็จรับเงิน</div>}
      </div>

      <dl className="ps-meta">
        <div>
          <dt>เลขที่</dt>
          <dd>{order.order_no || order.id?.slice(0, 8)}</dd>
        </div>
        <div>
          <dt>โต๊ะ</dt>
          <dd>{tableText(order)}</dd>
        </div>
        <div>
          <dt>วันที่</dt>
          <dd>{thaiDateTime(payment?.paid_at || order.closed_at || new Date())}</dd>
        </div>
        {payment?.cashier_name && (
          <div>
            <dt>พนักงาน</dt>
            <dd>{payment.cashier_name}</dd>
          </div>
        )}
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
            {(it.options || []).length > 0 && (
              <div className="ps-options">
                {it.options
                  .map((o) => (Number(o.extra_price) > 0 ? `${o.option_name || o.name} +${baht(o.extra_price)}` : o.option_name || o.name))
                  .join(', ')}
              </div>
            )}
          </li>
        ))}
      </ul>

      <hr className="ps-rule" />

      <div className="ps-totals">
        <div className="ps-row">
          <span>ยอดก่อน VAT</span>
          <span className="ps-amount">{baht(subtotal)}</span>
        </div>
        {discount > 0 && (
          <>
            <div className="ps-row">
              <span>ส่วนลด</span>
              <span className="ps-amount">−{baht(discount)}</span>
            </div>
            <div className="ps-row">
              <span>ยอดหลังส่วนลด</span>
              <span className="ps-amount">{baht(subtotal - discount)}</span>
            </div>
          </>
        )}
        <div className="ps-row">
          <span>VAT {Math.round(VAT_RATE * 100)}%</span>
          <span className="ps-amount">{baht(vat)}</span>
        </div>
        <div className="ps-row ps-grand">
          <span>ยอดสุทธิ</span>
          <span className="ps-amount">{baht(total)}</span>
        </div>
      </div>

      {payment && (
        <>
          <hr className="ps-rule" />
          <div className="ps-totals">
            <div className="ps-row">
              <span>ชำระโดย</span>
              <span>{METHOD[payment.method] || payment.method}</span>
            </div>
            {payment.method === 'cash' && (
              <>
                <div className="ps-row">
                  <span>รับเงิน</span>
                  <span className="ps-amount">{baht(payment.cash_received)}</span>
                </div>
                <div className="ps-row">
                  <span>เงินทอน</span>
                  <span className="ps-amount">{baht(change)}</span>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <div className="ps-center ps-footer">ขอบคุณที่ใช้บริการ</div>
    </PrintSlip>
  )
}
