import { useMemo, useState } from 'react'
import { thb2 } from './checkoutUtils'

// PromptPay แบบจำลอง (1.25): แสดง QR ตัวอย่าง → กด "จำลอง: ลูกค้าโอนสำเร็จ" → กด "ปิดโต๊ะ" เพื่อบันทึกรับเงิน
// ไม่ได้ตรวจกับธนาคารจริง และ QR นี้สแกนจ่ายจริงไม่ได้

const SIZE = 25

/** สร้างลาย QR ปลอมจาก reference (ลายเดิมทุกครั้งสำหรับบิลเดียวกัน) */
function fakeQr(seed) {
  let h = 2166136261
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  const rand = () => {
    h ^= h << 13
    h ^= h >>> 17
    h ^= h << 5
    return (h >>> 0) / 4294967296
  }
  const cells = []
  const finder = (x, y) => {
    const inBox = (ox, oy) => x >= ox && x < ox + 7 && y >= oy && y < oy + 7
    for (const [ox, oy] of [[0, 0], [SIZE - 7, 0], [0, SIZE - 7]]) {
      if (inBox(ox, oy)) {
        const dx = x - ox
        const dy = y - oy
        const ring = dx === 0 || dy === 0 || dx === 6 || dy === 6
        const core = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4
        return ring || core ? 1 : 0
      }
    }
    return null
  }
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const f = finder(x, y)
      if (f === 1 || (f === null && rand() > 0.52)) cells.push([x, y])
    }
  }
  return cells
}

export default function PromptPayQR({ total, reference, branchName, paying, onConfirm }) {
  const cells = useMemo(() => fakeQr(`${reference}|${total}`), [reference, total])
  const [received, setReceived] = useState(false)

  return (
    <div className="pos-pay-form">
      <div className="pos-qr">
        <svg viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`} className="pos-qr-code" role="img" aria-label="QR PromptPay (จำลอง)">
          <rect x="-2" y="-2" width={SIZE + 4} height={SIZE + 4} fill="#fff" />
          {cells.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#1f1d1a" />
          ))}
        </svg>
      </div>
      <p className="pos-muted pos-small" style={{ textAlign: 'center', margin: '8px 0 2px' }}>
        PromptPay{branchName ? ` · ${branchName}` : ''} · อ้างอิง {reference}
      </p>
      <div className="pos-qr-amount">{thb2(total)}</div>
      <div style={{ textAlign: 'center' }}>
        <span className={`pos-pill ${received ? 'is-available' : 'is-occupied'}`} aria-live="polite">
          {received ? 'ได้รับเงินแล้ว' : 'รอการชำระเงิน…'}
        </span>
      </div>

      <p className="pos-note is-muted" style={{ marginTop: 14 }}>
        QR นี้เป็นแบบจำลอง ยังไม่เชื่อมธนาคาร · ยอดเงินฝังอยู่ใน QR อัตโนมัติ
      </p>

      <div className="pos-side-actions pos-pay-submit">
        <button type="button" className="pos-btn pos-grow" onClick={() => setReceived(true)} disabled={received || paying}>
          จำลอง: ลูกค้าโอนสำเร็จ
        </button>
        <button type="button" className="pos-btn pos-btn-primary pos-grow" onClick={onConfirm} disabled={!received || paying}>
          {paying ? 'กำลังบันทึก…' : 'ปิดโต๊ะ'}
        </button>
      </div>
    </div>
  )
}
