import { useState } from 'react'
import { thb2 } from './checkoutUtils'

// บัตรเครดิต/เดบิต ผ่านเครื่อง EDC ของธนาคาร (แยกจากระบบ) — ใช้ได้ทุกสาขา
// 1) รูด/แตะบัตรที่เครื่อง EDC ตามยอด  2) EDC อนุมัติแล้ว กรอกเลขท้ายบัตร 4 หลัก + รหัสอนุมัติจากสลิป
// 3) กด "ยืนยันรับเงิน & ปิดโต๊ะ" → บันทึกลง Supabase (payment.payments) · ไม่รับ/ไม่เก็บเลขบัตรเต็ม

export default function CardForm({ total, paying, onPay }) {
  const [last4, setLast4] = useState('')
  const [approval, setApproval] = useState('')
  const validLast4 = /^\d{4}$/.test(last4)
  const validApproval = /^[A-Z0-9]{4,12}$/.test(approval)
  const ready = validLast4 && validApproval

  function submit(e) {
    e.preventDefault()
    if (ready && !paying) onPay({ card_last4: last4, card_approval_code: approval })
  }

  return (
    <form className="pos-pay-form" onSubmit={submit}>
      <p className="pos-note is-muted" style={{ marginTop: 0 }}>
        รูดหรือแตะบัตรที่เครื่อง EDC ยอด <strong>{thb2(total)}</strong> เมื่อเครื่องอนุมัติแล้ว กรอกข้อมูลจากสลิป EDC ด้านล่าง
      </p>

      <label className="pos-label" htmlFor="pos-card-last4">
        เลขท้ายบัตร 4 หลัก
      </label>
      <input
        id="pos-card-last4"
        className="pos-input pos-input-lg"
        inputMode="numeric"
        maxLength={4}
        value={last4}
        onChange={(e) => /^\d{0,4}$/.test(e.target.value) && setLast4(e.target.value)}
        placeholder="เช่น 1234"
        autoFocus
        disabled={paying}
        autoComplete="off"
      />

      <label className="pos-label" htmlFor="pos-card-approval" style={{ marginTop: 12 }}>
        รหัสอนุมัติ (Approval code)
      </label>
      <input
        id="pos-card-approval"
        className="pos-input pos-input-lg"
        maxLength={12}
        value={approval}
        onChange={(e) => {
          const v = e.target.value.toUpperCase().replace(/\s/g, '')
          if (/^[A-Z0-9]{0,12}$/.test(v)) setApproval(v)
        }}
        placeholder="เช่น 123456"
        disabled={paying}
        autoComplete="off"
      />
      {approval !== '' && !validApproval && <p className="pos-error" style={{ margin: '6px 0 0' }}>รหัสอนุมัติต้องมี 4–12 ตัว</p>}

      <button className="pos-btn pos-btn-primary pos-btn-block pos-pay-submit" disabled={!ready || paying}>
        {paying ? 'กำลังบันทึก…' : 'ยืนยันรับเงิน & ปิดโต๊ะ'}
      </button>
    </form>
  )
}
