import { useState } from 'react'
import { flushSync } from 'react-dom'
import { useAuth, useBranch } from '../app/providers.jsx'
import { Button, Card, PageHeader } from '../components/ui.jsx'

export const VAT_RATE = 0.07

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

export function lineTotal(item) {
  const extras = (item.options || []).reduce((sum, o) => sum + Number(o.extra_price || 0), 0)
  return round2((Number(item.unit_price) + extras) * Number(item.quantity))
}

export function calcBill(items, discountAmount = 0) {
  const subtotal = round2(items.reduce((sum, it) => sum + lineTotal(it), 0))
  const discount = round2(Math.min(discountAmount, subtotal))
  const beforeVat = round2(subtotal - discount)
  const vat = round2(beforeVat * VAT_RATE)
  return { subtotal, discount_amount: discount, before_vat: beforeVat, vat_amount: vat, total: round2(beforeVat + vat) }
}

export const baht = (n) =>
  Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const time = (iso) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

export function KitchenTicket({ ticket, printTarget = false }) {
  const totalQty = ticket.items.reduce((s, i) => s + i.quantity, 0)
  return (
    <div className={`slip ${printTarget ? 'print-target' : ''}`}>
      <div className="center title">*** ใบสั่งอาหารเข้าครัว ***</div>
      <div className="center big">โต๊ะ {ticket.table_names.join(' + ')}</div>
      <div className="center">
        รอบที่ {ticket.round} · {ticket.ticket_no}
      </div>
      <hr />
      <div className="row">
        <span>เวลา</span>
        <span>{time(ticket.created_at)}</span>
      </div>
      {ticket.staff_name && (
        <div className="row">
          <span>พนักงาน</span>
          <span>{ticket.staff_name}</span>
        </div>
      )}
      {ticket.guest_count != null && (
        <div className="row">
          <span>จำนวนลูกค้า</span>
          <span>{ticket.guest_count} ท่าน</span>
        </div>
      )}
      <hr />
      {ticket.items.map((item, i) => (
        <div key={i}>
          <div className="k-item">
            <span className="qty">{item.quantity} x</span>
            <span>{item.name}</span>
          </div>
          <div className="indent">
            {(item.options || []).map((o, j) => (
              <div key={j} className="k-opt">
                + {o.name}
              </div>
            ))}
            {item.note && <div className="k-note">** {item.note} **</div>}
          </div>
        </div>
      ))}
      <hr />
      <div className="center">
        รวม {ticket.items.length} รายการ / {totalQty} ที่
      </div>
    </div>
  )
}

const dateTime = (iso) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const METHOD_LABEL = { cash: 'เงินสด', promptpay: 'QR พร้อมเพย์' }

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

export function usePrintSlip() {
  const [target, setTarget] = useState(null)
  const print = (which) => {
    flushSync(() => setTarget(which))
    window.print()
    setTarget(null)
  }
  return [target, print]
}

const ITEMS = [
  { name: 'ข้าวผัดกะเพราหมูกรอบ', quantity: 2, unit_price: 80, options: [{ name: 'ไข่ดาว', extra_price: 10 }] },
  { name: 'ต้มยำกุ้งน้ำข้น', quantity: 1, unit_price: 180 },
  { name: 'ไข่เจียวหมูสับ', quantity: 1, unit_price: 60 },
  { name: 'ชาไทยเย็น', quantity: 2, unit_price: 45, options: [{ name: 'หวานน้อย', extra_price: 0 }] },
  { name: 'ข้าวสวย', quantity: 4, unit_price: 15 },
]
const DISCOUNT = 50

const SAMPLE_TICKET = {
  ticket_no: 'TK-0452',
  round: 2,
  created_at: new Date().toISOString(),
  table_names: ['T3'],
  staff_name: 'staff1',
  guest_count: 4,
  items: [
    { name: 'ชาไทยเย็น', quantity: 2, options: [{ name: 'หวานน้อย' }], note: 'แยกน้ำแข็ง' },
    { name: 'ข้าวสวย', quantity: 4 },
  ],
}

export function PrintPreviewPage() {
  const { user } = useAuth()
  const { branches, selectedBranchId } = useBranch()
  const [target, print] = usePrintSlip()

  const branch =
    branches.find((b) => b.id === (selectedBranchId || user.branch_id)) ??
    branches[0] ?? { name: 'สาขาตัวอย่าง', code: 'RES01', address: null, phone: null }

  const bill = calcBill(ITEMS, DISCOUNT)
  const cashReceived = Math.ceil(bill.total / 100) * 100
  const order = {
    receipt_no: 'RC-RES01-6911-00452',
    paid_at: new Date().toISOString(),
    table_names: ['T3'],
    cashier_name: 'staff1',
    items: ITEMS,
    ...bill,
  }
  const payment = { method: 'cash', cash_received: cashReceived, change_amount: cashReceived - bill.total }

  return (
    <>
      <PageHeader
        title="ตัวอย่างใบพิมพ์"
        subtitle="Layout ใบออร์เดอร์เข้าครัวและใบเสร็จ 80mm (1.10) · ข้อมูลตัวอย่าง รอเชื่อมกับ pos/payment"
        showBranchSwitch
      />
      <div className="content">
        <div className="print-stage">
          <div className="col">
            <b>ใบออร์เดอร์เข้าครัว</b>
            <KitchenTicket ticket={SAMPLE_TICKET} printTarget={target === 'kitchen'} />
            <Button variant="secondary" onClick={() => print('kitchen')}>
              พิมพ์ใบเข้าครัว
            </Button>
          </div>
          <div className="col">
            <b>ใบเสร็จรับเงิน</b>
            <Receipt branch={branch} order={order} payment={payment} printTarget={target === 'receipt'} />
            <Button variant="secondary" onClick={() => print('receipt')}>
              พิมพ์ใบเสร็จ
            </Button>
          </div>
          <Card title="สูตรคำนวณ (spec 1.24)" className="col" >
            <div style={{ fontSize: 13, lineHeight: 1.8, maxWidth: 360 }}>
              <div>ราคาเมนู <b>ยังไม่รวม VAT</b></div>
              <div>VAT = (subtotal − ส่วนลด) × 7%</div>
              <div>สุทธิ = subtotal − ส่วนลด + VAT</div>
              <hr style={{ border: 0, borderTop: '1px solid #e7e3dc' }} />
              <div>
                {baht(bill.subtotal)} − {baht(bill.discount_amount)} = {baht(bill.before_vat)}
              </div>
              <div>
                VAT {baht(bill.before_vat)} × 7% = {baht(bill.vat_amount)}
              </div>
              <div>
                สุทธิ = <b>{baht(bill.total)}</b>
              </div>
              <p className="muted" style={{ fontSize: 12 }}>
                ตัวเลขจริงมาจาก pos (GET /orders/:id) layout นี้แสดงตามที่ได้รับ ไม่คำนวณใหม่ · หัวใบเสร็จใช้ชื่อ ที่อยู่ เบอร์โทรจากข้อมูลสาขา
              </p>
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
