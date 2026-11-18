import { useMemo } from 'react'
import { baht } from '../../lib/format.js'

// PromptPay แบบจำลอง (1.25): แสดง QR ตัวอย่างให้ลูกค้าดู แล้วพนักงานกดยืนยันว่าได้รับเงิน
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

export default function PromptPayQR({ total, reference, paying, onConfirm }) {
  const cells = useMemo(() => fakeQr(`${reference}|${total}`), [reference, total])

  return (
    <div className="co-qr">
      <div className="co-qr-card">
        <div className="co-qr-brand">PromptPay</div>
        <svg viewBox={`-2 -2 ${SIZE + 4} ${SIZE + 4}`} className="co-qr-code" role="img" aria-label="QR PromptPay (จำลอง)">
          <rect x="-2" y="-2" width={SIZE + 4} height={SIZE + 4} fill="#fff" />
          {cells.map(([x, y]) => (
            <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="#0f2b46" />
          ))}
        </svg>
        <div className="co-qr-amount">฿{baht(total)}</div>
        <div className="co-qr-ref">อ้างอิง {reference}</div>
      </div>

      <p className="co-hint">ให้ลูกค้าสแกนแล้วตรวจยอดในแอปธนาคารของลูกค้า · ระบบนี้เป็นแบบจำลอง กดยืนยันแล้วถือว่ารับเงินสำเร็จทันที</p>

      <button className="co-btn co-btn-primary co-btn-block" onClick={onConfirm} disabled={paying}>
        {paying ? 'กำลังบันทึก…' : `ยืนยันได้รับเงิน ฿${baht(total)}`}
      </button>
    </div>
  )
}
