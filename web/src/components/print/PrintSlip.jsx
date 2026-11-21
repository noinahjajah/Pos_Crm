import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import './print.css'

// กรอบใบพิมพ์ขนาดกระดาษความร้อน 58 มม. แนวยาว (Dev 1 · 1.10)
// - ปกติซ่อนบนจอ เห็นเฉพาะตอนพิมพ์ (preview = true → แสดงบนจอด้วย)
// - autoPrint = true → เปิด dialog พิมพ์ทันทีที่แสดง แล้วเรียก onAfterPrint
// - ก่อนพิมพ์จะวัดความสูงใบพิมพ์ แล้วตั้ง @page เป็น 58 มม. × ความยาวจริง
//   ให้ออกมาเป็นแผ่นยาวแผ่นเดียว ไม่ตัดเป็นหลายหน้า
//
// ใช้: {slip && <KitchenTicketPrint ticket={slip} autoPrint onAfterPrint={() => setSlip(null)} />}

const PAPER_WIDTH_MM = 58
const PX_PER_MM = 96 / 25.4

// วัดความสูงของใบพิมพ์ (ซึ่งซ่อนอยู่บนจอ) โดยแสดงนอกจอชั่วคราว
function measureHeightMm(el) {
  const prev = el.style.cssText
  el.style.cssText = `${prev};display:block;position:absolute;left:-10000px;top:0;visibility:hidden`
  const px = el.getBoundingClientRect().height
  el.style.cssText = prev
  return Math.ceil(px / PX_PER_MM) + 2 // เผื่อท้ายกระดาษ 2 มม.
}

export default function PrintSlip({ children, preview = false, autoPrint = false, onAfterPrint, label }) {
  const ref = useRef(null)

  useEffect(() => {
    if (!autoPrint) return
    let pageStyle = null
    const cleanup = () => {
      pageStyle?.remove()
      pageStyle = null
    }
    const done = () => {
      cleanup()
      onAfterPrint?.()
    }
    window.addEventListener('afterprint', done, { once: true })
    // รอ 1 frame ให้ DOM ของใบพิมพ์วาดเสร็จก่อน
    const id = requestAnimationFrame(() => {
      if (ref.current) {
        const heightMm = measureHeightMm(ref.current)
        pageStyle = document.createElement('style')
        pageStyle.textContent = `@page { size: ${PAPER_WIDTH_MM}mm ${heightMm}mm; margin: 0; }`
        document.head.appendChild(pageStyle)
      }
      window.print()
    })
    return () => {
      cancelAnimationFrame(id)
      window.removeEventListener('afterprint', done)
      cleanup()
    }
  }, [autoPrint, onAfterPrint])

  const slip = (
    <div ref={ref} className={`print-slip ${preview ? 'is-preview' : ''}`} aria-label={label}>
      {children}
    </div>
  )
  // แสดงตัวอย่างอยู่ในหน้าได้เลย · พิมพ์อย่างเดียวให้แปะที่ body กันโดน layout ของหน้าบีบ
  return preview ? slip : createPortal(slip, document.body)
}
