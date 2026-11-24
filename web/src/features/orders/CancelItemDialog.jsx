import { useState } from 'react'
import { cancelOrderItem, unitWithOptions } from '../../api/pos'
import { errorText } from '../../lib/format'
import { thb } from '../../lib/posUtils'
import { Dialog, Stepper } from '../../components/ui/posUi'

// ยกเลิกรายการที่ส่งครัวแล้ว (บิลยังไม่จ่าย) — staff/manager ยกเลิกเองได้ ไม่ต้องขออนุมัติ
// พนักงานเลือกว่าครัวทำไปแล้วหรือยัง: ยังไม่ทำ → คืนสต็อก · ทำแล้ว → ไม่คืนสต็อก (ของเสีย)

const REASONS = ['ลูกค้าเปลี่ยนใจ', 'สั่งผิด', 'อาหารออกช้า', 'อาหารมีปัญหา']

const COOKED = [
  [false, 'ยังไม่ได้ทำ', 'คืนสต็อกกลับ'],
  [true, 'ทำไปแล้ว', 'ไม่คืนสต็อก'],
]

export default function CancelItemDialog({ order, item, onClose, onDone }) {
  const [quantity, setQuantity] = useState(item.quantity)
  const [cooked, setCooked] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (cooked === null || busy) return
    setBusy(true)
    setError('')
    try {
      const updated = await cancelOrderItem(order.id, item.id, { quantity, cooked, reason: reason.trim() || null })
      onDone(updated, { quantity, cooked })
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog title="ยกเลิกรายการ" subtitle={`${item.menu_name} · เหลือ ${item.quantity} ที่`} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        {item.quantity > 1 && (
          <div className="pos-field-row">
            <span className="pos-label" style={{ margin: 0 }}>
              จำนวนที่ยกเลิก
            </span>
            <Stepper value={quantity} onChange={setQuantity} min={1} max={item.quantity} label="จำนวนที่ยกเลิก" />
          </div>
        )}

        <div className="pos-field-row">
          <span className="pos-label" style={{ margin: 0 }}>
            ครัวทำไปแล้วหรือยัง
          </span>
          <div className="pos-tabs" role="radiogroup" aria-label="ครัวทำไปแล้วหรือยัง" style={{ margin: 0 }}>
            {COOKED.map(([v, label]) => (
              <button key={label} type="button" role="radio" aria-checked={cooked === v} className={cooked === v ? 'is-active' : ''} onClick={() => setCooked(v)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {cooked !== null && (
          <p className={`pos-note ${cooked ? 'is-warn' : 'is-muted'}`}>
            {cooked ? 'ทำไปแล้ว: ไม่คืนสต็อก (นับเป็นของเสีย)' : `ยังไม่ได้ทำ: คืนสต็อก ${item.menu_name} ${quantity} ที่`}
          </p>
        )}

        <label className="pos-label" htmlFor="pos-cancel-reason">
          เหตุผล (ไม่บังคับ)
        </label>
        <input
          id="pos-cancel-reason"
          className="pos-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          placeholder="เช่น ลูกค้าเปลี่ยนใจ"
        />
        <div className="pos-chips" style={{ margin: '10px 0 14px' }}>
          {REASONS.map((r) => (
            <button key={r} type="button" className={`pos-chip ${reason === r ? 'is-active' : ''}`} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>

        <div className="pos-infobox" style={{ marginBottom: 14 }}>
          <div>
            <span>ยอดที่หักออกจากบิล (ก่อน VAT)</span>
            <strong>-{thb(unitWithOptions(item) * quantity)}</strong>
          </div>
        </div>

        {error && <p className="pos-error">{error}</p>}

        <div className="pos-dialog-actions">
          <button type="button" className="pos-btn" onClick={onClose} disabled={busy}>
            ปิด
          </button>
          <button type="submit" className="pos-btn pos-btn-danger" disabled={cooked === null || busy}>
            {busy ? 'กำลังยกเลิก…' : `ยกเลิก ${quantity} ที่`}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
