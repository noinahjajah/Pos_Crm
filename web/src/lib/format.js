// จัดรูปแบบ: เงินบาท วันที่แบบไทย

/** วันเวลาแบบสั้น · ไม่มีค่า = — */
export const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

/** เงินบาท 2 ตำแหน่ง เช่น 1,234.50 */
export const baht = (n) =>
  Number(n ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** วันเวลาบนใบพิมพ์ เช่น 18/11/69 14:05 */
export const time = (iso) =>
  new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' })
