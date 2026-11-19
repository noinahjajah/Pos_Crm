import { useEffect, useId } from 'react'

// component เล็ก ๆ ที่หน้าร้าน Dev 3 ใช้ร่วมกัน

/** หน้าต่างยืนยัน (แทน window.confirm) — children = รายละเอียดที่อยากให้เห็นก่อนกดยืนยัน */
export function ConfirmDialog({ title, subtitle, children, confirmLabel = 'ยืนยัน', cancelLabel = 'ยกเลิก', danger = false, busy = false, onConfirm, onCancel }) {
  return (
    <Dialog title={title} subtitle={subtitle} onClose={onCancel} busy={busy}>
      {children}
      <div className="pos-dialog-actions">
        <button type="button" className="pos-btn" onClick={onCancel} disabled={busy} autoFocus>
          {cancelLabel}
        </button>
        <button type="button" className={`pos-btn ${danger ? 'pos-btn-danger-solid' : 'pos-btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  )
}

/** หน้าต่างกลางจอ · กด Esc หรือคลิกพื้นหลังเพื่อปิด (ยกเว้นตอน busy) */
export function Dialog({ title, subtitle, onClose, busy = false, size, children }) {
  const titleId = useId()

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !busy && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  return (
    <div className="pos-overlay" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className={`pos-dialog ${size === 'md' ? 'pos-dialog-md' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="pos-dialog-head">
          <div>
            <h2 className="pos-dialog-title" id={titleId}>
              {title}
            </h2>
            {subtitle && <p className="pos-dialog-sub">{subtitle}</p>}
          </div>
          <button type="button" className="pos-close" onClick={onClose} disabled={busy} aria-label="ปิด">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** ปุ่ม − จำนวน + */
export function Stepper({ value, onChange, min = 1, max = 99, size, label = 'จำนวน' }) {
  return (
    <div className={`pos-stepper ${size ? `is-${size}` : ''}`} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label={`ลด${label}`}>
        −
      </button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label={`เพิ่ม${label}`}>
        +
      </button>
    </div>
  )
}

export function Toast({ toast }) {
  if (!toast) return null
  return (
    <div className={`pos-toast ${toast.type === 'error' ? 'is-error' : ''}`} role="status">
      {toast.message}
    </div>
  )
}

export function MockBanner({ show }) {
  if (!show) return null
  return <div className="pos-mock-banner">โหมดทดสอบ (VITE_POS_MODE=mock) — โต๊ะและออร์เดอร์เป็นข้อมูลจำลอง ยังไม่บันทึกลงระบบจริง</div>
}
