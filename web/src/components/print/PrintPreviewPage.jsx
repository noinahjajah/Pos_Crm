import { useState } from 'react'
import KitchenTicketPrint from './KitchenTicketPrint'
import ReceiptPrint from './ReceiptPrint'

// หน้าดูตัวอย่างใบพิมพ์ด้วยข้อมูลจำลอง (เปิดเฉพาะตอน dev: /dev/print)
// ใช้เช็ก layout ก่อน pos (Dev 3) ส่งข้อมูลจริง

const SAMPLE_TICKET = {
  round_no: 2,
  order_no: 'R01-20261118-0042',
  tables: [{ table_no: 'A3' }, { table_no: 'A4' }],
  guest_count: 5,
  created_at: '2026-11-18T12:34:00+07:00',
  created_by_name: 'สมชาย',
  items: [
    { menu_name: 'ผัดกะเพราหมูสับ', quantity: 2, note: 'ไม่ใส่ถั่วฝักยาว', options: [{ option_name: 'ไข่ดาว' }, { option_name: 'เผ็ดมาก' }] },
    { menu_name: 'ต้มยำกุ้งน้ำข้น', quantity: 1, options: [{ option_name: 'ถ้วยใหญ่' }] },
    { menu_name: 'ชาไทยเย็น', quantity: 3, options: [{ option_name: 'หวานน้อย' }] },
  ],
}

const SAMPLE_ORDER = {
  order_no: 'R01-20261118-0042',
  tables: [{ table_no: 'A3' }, { table_no: 'A4' }],
  items: [
    { menu_name: 'ผัดกะเพราหมูสับ', quantity: 2, unit_price: 60, options: [{ option_name: 'ไข่ดาว', extra_price: 10 }] },
    { menu_name: 'ต้มยำกุ้งน้ำข้น', quantity: 1, unit_price: 180, options: [{ option_name: 'ถ้วยใหญ่', extra_price: 40 }] },
    { menu_name: 'ชาไทยเย็น', quantity: 3, unit_price: 45 },
  ],
  subtotal: 495,
  discount_amount: 45,
  vat_amount: 31.5,
  total: 481.5,
}

const SAMPLE_PAYMENT = { method: 'cash', amount: 481.5, cash_received: 500, paid_at: '2026-11-18T13:20:00+07:00', cashier_name: 'สมชาย' }
const SAMPLE_BRANCH = { name: 'สาขาอาหาร (R01)', address: '123 ถ.สุขุมวิท กรุงเทพฯ', phone: '02-123-4567' }

export default function PrintPreviewPage() {
  const [printing, setPrinting] = useState(null) // 'kitchen' | 'receipt'

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ marginTop: 0 }}>ตัวอย่างใบพิมพ์ (ข้อมูลจำลอง)</h1>
      <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <section>
          <h2>ใบออร์เดอร์เข้าครัว</h2>
          <KitchenTicketPrint ticket={SAMPLE_TICKET} branchName={SAMPLE_BRANCH.name} preview />
          <p>
            <button onClick={() => setPrinting('kitchen')}>พิมพ์ใบครัว</button>
          </p>
        </section>
        <section>
          <h2>ใบเสร็จ</h2>
          <ReceiptPrint order={SAMPLE_ORDER} payment={SAMPLE_PAYMENT} branch={SAMPLE_BRANCH} preview />
          <p>
            <button onClick={() => setPrinting('receipt')}>พิมพ์ใบเสร็จ</button>
          </p>
        </section>
      </div>

      {/* ตอนพิมพ์ใช้ตัวที่ไม่ใช่ preview ตัวเดียว ซ่อนตัวอย่างไว้ไม่ให้ซ้อนกัน */}
      {printing && <style>{'@media print { .print-slip.is-preview { display: none !important; } }'}</style>}
      {printing === 'kitchen' && (
        <KitchenTicketPrint ticket={SAMPLE_TICKET} branchName={SAMPLE_BRANCH.name} autoPrint onAfterPrint={() => setPrinting(null)} />
      )}
      {printing === 'receipt' && (
        <ReceiptPrint order={SAMPLE_ORDER} payment={SAMPLE_PAYMENT} branch={SAMPLE_BRANCH} autoPrint onAfterPrint={() => setPrinting(null)} />
      )}
    </div>
  )
}
