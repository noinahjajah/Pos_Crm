// ใบเสร็จ 80 มม. สำหรับพิมพ์ (Dev 1) · หน้าจอหลังรับเงินใช้ Receipt.jsx ของ Dev 2

import { lineTotal } from './bill.js'
import { baht } from '../../lib/format.js'

// วันเวลาบนใบเสร็จ (ปี 4 หลัก)
const dateTime = (iso) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const METHOD_LABEL = { cash: 'เงินสด', promptpay: 'QR พร้อมเพย์' }

// ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ
export function Receipt({ branch, order, payment, printTarget = false }) {
  const beforeVat = order.subtotal - order.discount_amount
  const qty = order.items.reduce((s, i) => s + i.quantity, 0)
  return (
    <div className={`slip ${printTarget ? 'print-target' : ''}`}>
      <div className="center shop">POS CRM</div>
      <div className="center">
        {branch.name} ({branch.code})
      </div>
      {branch.address && <div className="center small">{branch.address}</div>}
      {branch.phone && <div className="center small">โทร {branch.phone}</div>}
      <hr />
      <div className="center title">ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ</div>
      <div className="row">
        <span>เลขที่</span>
        <span>{order.receipt_no}</span>
      </div>
      <div className="row">
        <span>วันที่</span>
        <span>{dateTime(order.paid_at)}</span>
      </div>
      <div className="row">
        <span>โต๊ะ / แคชเชียร์</span>
        <span>
          {order.table_names.join(' + ')} / {order.cashier_name || '-'}
        </span>
      </div>
      <hr />
      {order.items.map((item, i) => (
        <div key={i}>
          <div className="row">
            <span>
              {item.quantity} x {item.name}
            </span>
            <span>{baht(lineTotal(item))}</span>
          </div>
          {(item.options || []).map((o, j) => (
            <div key={j} className="indent small">
              + {o.name} {o.extra_price ? `(+${baht(o.extra_price)})` : ''}
            </div>
          ))}
        </div>
      ))}
      <hr />
      <div className="row">
        <span>รวม {qty} รายการ</span>
        <span>{baht(order.subtotal)}</span>
      </div>
      {order.discount_amount > 0 && (
        <div className="row">
          <span>ส่วนลด (อนุมัติแล้ว)</span>
          <span>-{baht(order.discount_amount)}</span>
        </div>
      )}
      <div className="row">
        <span>มูลค่าก่อน VAT</span>
        <span>{baht(beforeVat)}</span>
      </div>
      <div className="row">
        <span>VAT 7%</span>
        <span>{baht(order.vat_amount)}</span>
      </div>
      <div className="row total">
        <span>ยอดสุทธิ</span>
        <span>{baht(order.total)}</span>
      </div>
      {payment && (
        <>
          <hr />
          <div className="row">
            <span>ชำระโดย</span>
            <span>{METHOD_LABEL[payment.method] || payment.method}</span>
          </div>
          {payment.method === 'cash' && (
            <>
              <div className="row">
                <span>รับเงิน</span>
                <span>{baht(payment.cash_received)}</span>
              </div>
              <div className="row">
                <span>เงินทอน</span>
                <span>{baht(payment.change_amount)}</span>
              </div>
            </>
          )}
        </>
      )}
      <hr />
      <div className="center title">ขอบคุณที่ใช้บริการ</div>
    </div>
  )
}
