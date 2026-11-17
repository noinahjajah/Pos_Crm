// หน้าตัวอย่างใบพิมพ์ (ข้อมูลตัวอย่าง)

import { useBranch } from '../../app/providers.jsx'
import { PageHeader } from '../../components/layout/Topbar.jsx'
import { Button, Card } from '../../components/ui/index.jsx'
import { useAuth } from '../auth/AuthContext.jsx'
import { Receipt } from './Receipt.jsx'
import { calcBill } from './bill.js'
import { KitchenTicket } from '../kitchen/KitchenTicket.jsx'
import { usePrintSlip } from '../../hooks/usePrintSlip.js'
import { baht } from '../../lib/format.js'

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

// หน้าตัวอย่างใบพิมพ์ (ข้อมูลตัวอย่าง)
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
