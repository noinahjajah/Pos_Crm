// จัดรูปแบบ: เงินบาท วันที่แบบไทย

/** วันเวลาแบบสั้น · ไม่มีค่า = — */
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/** เงินบาท 2 ตำแหน่ง เช่น 1,234.50 */
export const baht = (n) =>
  Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** วันเวลาบนใบพิมพ์ เช่น 18/11/69 14:05 */
export const time = (iso) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function todayTh() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** '2026-11-17' → '17 พ.ย. 2569' */
export function thaiDate(value) {
  if (!value) return ''
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** error จาก API เป็นข้อความอ่านง่าย (รวมรายละเอียดรายช่องถ้ามี) */
export function errorText(err) {
  if (!err) return ''
  const fields = (err.details || [])
    .map((d) => d.message && (d.field ? `${d.field}: ${d.message}` : d.message))
    .filter(Boolean)
  return fields.length ? `${err.message} — ${fields.join(', ')}` : err.message || 'เกิดข้อผิดพลาด'
}
