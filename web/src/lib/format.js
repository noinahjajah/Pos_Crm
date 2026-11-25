// จัดรูปแบบเงินบาท วันที่แบบไทย

/**
 * เงินที่แสดงบนจอ: ไม่มีทศนิยม · มีเศษสตางค์ → ปัดขึ้นเป็นบาทเต็ม (ติดลบปัดออกจากศูนย์ เช่น −12.3 → −13)
 * ใช้แค่ตอนแสดงผล ตัวเลขจริงในระบบไม่เปลี่ยน · ปัดสตางค์ก่อนกันเศษ float เช่น 12.000000001
 */
export function roundUpBaht(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100
  return v < 0 ? -Math.ceil(-v) : Math.ceil(v) || 0
}

const money = new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 })
/** จำนวนเงินแบบมีคั่นหลักพัน ไม่มีทศนิยม: 1234.2 → '1,235' */
export const formatBaht = (n) => money.format(roundUpBaht(n))

/** 1234 → '1,234' · มีสตางค์ (บิลเก่า) ปัดขึ้น → 1234.01 → '1,235' */
export const baht = formatBaht

/** → '18 พ.ย. 2569 14:05' */
export function thaiDateTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' })
}

/** → '14:05' */
export function thaiTime(value) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

/** แปลง error จาก API เป็นข้อความอ่านง่าย (รวมรายละเอียดรายช่องถ้ามี) */
export function errorText(err) {
  if (!err) return ''
  const fields = (err.details || [])
    .map((d) => d.message && (d.field ? `${d.field}: ${d.message}` : d.message))
    .filter(Boolean)
  return fields.length ? `${err.message} — ${fields.join(', ')}` : err.message || 'เกิดข้อผิดพลาด'
}
