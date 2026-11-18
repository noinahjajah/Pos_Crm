// ตัวช่วยของหน้าคิดเงิน (Dev 2)

export function errorText(err) {
  if (!err) return ''
  const fields = (err.details || [])
    .map((d) => d.message && (d.field ? `${d.field}: ${d.message}` : d.message))
    .filter(Boolean)
  return fields.length ? `${err.message} — ${fields.join(', ')}` : err.message || 'เกิดข้อผิดพลาด'
}

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const fmt = (n) => money.format(Number(n) || 0)

/** ยอดของรายการ 1 แถว (ราคาเมนู + ตัวเลือก) × จำนวน */
export function lineTotal(item) {
  if (item.line_total !== undefined) return Number(item.line_total)
  const extra = (item.options || []).reduce((s, o) => s + Number(o.extra_price || 0), 0)
  return (Number(item.unit_price || 0) + extra) * Number(item.quantity || 0)
}

export const tableLabel = (order) =>
  (order.tables || []).map((t) => t.table_no ?? t).join(', ') || order.table_no || '-'
