import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import './print.css'

// กรอบใบพิมพ์ขนาดกระดาษความร้อน 80 มม. (Dev 1 · 1.10)
// - ปกติซ่อนบนจอ เห็นเฉพาะตอนพิมพ์ (preview = true → แสดงบนจอด้วย)
// - autoPrint = true → เปิด dialog พิมพ์ทันทีที่แสดง แล้วเรียก onAfterPrint
//
// ใช้: {slip && <KitchenTicketPrint ticket={slip} autoPrint onAfterPrint={() => setSlip(null)} />}

export default function PrintSlip({ children, preview = false, autoPrint = false, onAfterPrint, label }) {
  useEffect(() => {
    if (!autoPrint) return
    const done = () => onAfterPrint?.()
    window.addEventListener('afterprint', done, { once: true })
    // รอ 1 frame ให้ DOM ของใบพิมพ์วาดเสร็จก่อน
    const id = requestAnimationFrame(() => window.print())
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
    }
  }, [autoPrint, onAfterPrint])

  const slip = (
    <div className={`print-slip ${preview ? 'is-preview' : ''}`} aria-label={label}>
      {children}
    </div>
  )
  // แสดงตัวอย่างอยู่ในหน้าได้เลย · พิมพ์อย่างเดียวให้แปะที่ body กันโดน layout ของหน้าบีบ
  return preview ? slip : createPortal(slip, document.body)
}
