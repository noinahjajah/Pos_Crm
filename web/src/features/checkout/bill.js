// คำนวณบิล: ราคาเมนูยังไม่รวม VAT · VAT = (ยอดรวม − ส่วนลด) × 7%

export const VAT_RATE = 0.07

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100

export function lineTotal(item) {
  const extras = (item.options || []).reduce((sum, o) => sum + Number(o.extra_price || 0), 0)
  return round2((Number(item.unit_price) + extras) * Number(item.quantity))
}

export function calcBill(items, discountAmount = 0) {
  const subtotal = round2(items.reduce((sum, it) => sum + lineTotal(it), 0))
  const discount = round2(Math.min(discountAmount, subtotal))
  const beforeVat = round2(subtotal - discount)
  const vat = round2(beforeVat * VAT_RATE)
  return { subtotal, discount_amount: discount, before_vat: beforeVat, vat_amount: vat, total: round2(beforeVat + vat) }
}
