import { useState } from 'react'
import { requestApproval } from '../../../api/pos'
import { VAT_RATE } from '../../../lib/constants'
import { errorText } from '../../../lib/format'
import { tablesText, thb } from '../posUtils'
import { Dialog } from '../posUi'

// staff ขอส่วนลด (บาท/เปอร์เซ็นต์) พร้อมเหตุผล → แจ้ง manager/owner (1.27, 1.29)
// ส่วนลดมีผลกับบิลเมื่ออนุมัติแล้วเท่านั้น (1.30)
// ใช้ได้ทั้งหน้ารับออร์เดอร์ (Dev 3) และหน้าคิดเงิน (Dev 2): <DiscountRequestDialog order={order} ... />

const REASONS = ['ลูกค้าประจำ', 'อาหารออกช้า', 'อาหารมีปัญหา', 'อื่นๆ']

export default function DiscountRequestDialog({ order, onClose, onSent }) {
  const base = Number(order.subtotal ?? 0) // ส่วนลดคิดจากยอดรวมรายการ
  const [valueType, setValueType] = useState('amount')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const num = Number(value)
  const discount = valueType === 'percent' ? Math.round(base * num) / 100 : num
  const invalid =
    !value || !Number.isFinite(num) || num <= 0 ? 'กรอกจำนวนส่วนลด' : valueType === 'percent' && num > 100 ? 'เปอร์เซ็นต์ต้องไม่เกิน 100' : discount > base ? 'ส่วนลดมากกว่ายอดบิล' : ''
  const canSend = !invalid && reason.trim() && !busy
  // VAT ตาม spec 1.24: vat = (subtotal − discount) × 7%
  const after = base - (invalid ? 0 : discount)
  const net = Math.round(after * (1 + VAT_RATE) * 100) / 100

  function pickReason(r) {
    // "อื่นๆ" ให้พิมพ์เอง
    setReason(r === 'อื่นๆ' ? '' : r)
    if (r === 'อื่นๆ') document.getElementById('pos-discount-reason')?.focus()
  }

  async function submit(e) {
    e.preventDefault()
    if (!canSend) return
    setBusy(true)
    setError('')
    try {
      const approval = await requestApproval(order.id, { type: 'discount', value_type: valueType, value: num, reason: reason.trim() })
      onSent(approval)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog title="ขอส่วนลด" subtitle={`บิลโต๊ะ ${tablesText(order)} · ยอดรวมรายการ ${thb(base)} (ก่อน VAT)`} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <div className="pos-field-row">
          <span className="pos-label" style={{ margin: 0 }}>
            ประเภทส่วนลด
          </span>
          <div className="pos-tabs" role="radiogroup" aria-label="ประเภทส่วนลด" style={{ margin: 0 }}>
            {[
              ['amount', 'เป็นบาท'],
              ['percent', 'เป็น %'],
            ].map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={valueType === v} className={valueType === v ? 'is-active' : ''} onClick={() => setValueType(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="pos-label" htmlFor="pos-discount-value">
          จำนวนส่วนลด ({valueType === 'percent' ? '%' : 'บาท'})
        </label>
        <input
          id="pos-discount-value"
          className="pos-input"
          type="number"
          inputMode="decimal"
          min="0"
          step={valueType === 'percent' ? '1' : '0.01'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoFocus
        />

        {invalid && value ? (
          <p className="pos-danger-text" style={{ margin: '10px 0 14px' }}>
            {invalid}
          </p>
        ) : (
          <div className="pos-infobox" style={{ margin: '12px 0 14px' }}>
            <div>
              <span>{valueType === 'percent' && !invalid ? `ส่วนลด ${thb(discount)} · ` : ''}ยอดหลังหักส่วนลด (ก่อน VAT)</span>
              <strong>{thb(after)}</strong>
            </div>
            <div>
              <span>ยอดสุทธิใหม่ (รวม VAT 7%)</span>
              <strong className="pos-brand-text">{thb(net)}</strong>
            </div>
          </div>
        )}

        <label className="pos-label" htmlFor="pos-discount-reason">
          เหตุผล (บังคับ)
        </label>
        <input
          id="pos-discount-reason"
          className="pos-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="เช่น ลูกค้าประจำ"
        />
        <div className="pos-chips" style={{ margin: '10px 0 14px' }}>
          {REASONS.map((r) => (
            <button key={r} type="button" className={`pos-chip ${reason === r ? 'is-active' : ''}`} onClick={() => pickReason(r)}>
              {r}
            </button>
          ))}
        </div>

        <p className="pos-note is-muted">คำขอจะแจ้งเตือนที่เครื่องผู้จัดการและเจ้าของ · ส่วนลดจะใช้กับบิลได้หลังอนุมัติแล้วเท่านั้น (1.29–1.30)</p>

        {error && <p className="pos-error">{error}</p>}

        <div className="pos-dialog-actions">
          <button type="button" className="pos-btn" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="submit" className="pos-btn pos-btn-primary" disabled={!canSend}>
            {busy ? 'กำลังส่ง…' : 'ส่งคำขออนุมัติ'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
