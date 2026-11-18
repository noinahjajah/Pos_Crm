// จัดรูปแบบเงินบาท วันที่แบบไทย

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** 1234.5 → '1,234.50' */
export const baht = (n) => money.format(Number(n) || 0)

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
