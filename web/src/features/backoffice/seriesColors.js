// สีของชุดข้อมูลในกราฟ — ค่าจริงอยู่ที่ --app-series-* ใน styles/index.css (ผ่านตัวตรวจ dataviz ทั้งโหมดสว่าง/มืด)
// กำหนดตามลำดับคงที่ ห้ามวนสี · ชุดที่ 5 ขึ้นไปรวมเป็น "อื่น ๆ"

export const SERIES_COLORS = ['var(--app-series-1)', 'var(--app-series-2)', 'var(--app-series-3)', 'var(--app-series-4)']
export const OTHER_COLOR = 'var(--app-series-other)'

/** สีของสาขาตามลำดับในรายชื่อสาขา (สีติดสาขา ไม่ใช่ติดอันดับยอดขาย) */
export function branchColors(branches) {
  const map = new Map()
  branches.forEach((b, i) => map.set(b.id, SERIES_COLORS[i] || OTHER_COLOR))
  return map
}
