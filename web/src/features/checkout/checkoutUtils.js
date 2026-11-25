// ตัวช่วยของหน้าคิดเงิน (Dev 2)
import { VAT_RATE } from '../../lib/constants'
import { formatBaht } from '../../lib/format'

export function errorText(err) {
  if (!err) return ''
  const fields = (err.details || [])
    .map((d) => d.message && (d.field ? `${d.field}: ${d.message}` : d.message))
    .filter(Boolean)
  return fields.length ? `${err.message} — ${fields.join(', ')}` : err.message || 'เกิดข้อผิดพลาด'
}

export const fmt = formatBaht
/** 1660 → '1,660 ฿' */
export const thb2 = (n) => `${fmt(n)} ฿`
/** 1700 → '1,700 ฿' */
export const thb = (n) => `${formatBaht(n)} ฿`

/**
 * ยอดบิลตามสูตร spec 1.24 — ราคาเมนูยังไม่รวม VAT
 *   ยอดก่อน VAT = ยอดรวมรายการ − ส่วนลด · VAT = ยอดก่อน VAT × 7% · ยอดสุทธิ = ยอดก่อน VAT + VAT
 * ใช้ยอดจาก backend เป็นหลัก คำนวณเองเฉพาะช่องที่ไม่ได้ส่งมา
 */
export function billNumbers(order) {
  const subtotal = Number(order?.subtotal || 0)
  const discount = Number(order?.discount_amount || 0)
  const beforeVat = subtotal - discount
  const vat = Number(order?.vat_amount ?? Math.round(beforeVat * VAT_RATE)) // VAT ปัดเป็นบาทเต็ม
  const total = Number(order?.total ?? beforeVat + vat)
  return { subtotal, discount, beforeVat, vat, total }
}

/** รายการอาหารของบิล: บิลจาก payment ส่ง items มาแบน · บิลจาก pos แยกตามรอบ (tickets) · ไม่รวมรายการที่ยกเลิกหมดแล้ว */
export const billItems = (order) =>
  (order?.items || (order?.tickets || []).flatMap((t) => t.items || [])).filter((it) => Number(it.quantity) > 0)

/** ยอดของรายการ 1 แถว (ราคาเมนู + ตัวเลือก) × จำนวน */
export function lineTotal(item) {
  if (item.line_total !== undefined) return Number(item.line_total)
  const extra = (item.options || []).reduce((s, o) => s + Number(o.extra_price || 0), 0)
  return (Number(item.unit_price || 0) + extra) * Number(item.quantity || 0)
}

export const tableLabel = (order) =>
  (order.tables || []).map((t) => t.table_no ?? t).join(', ') || order.table_no || '-'
