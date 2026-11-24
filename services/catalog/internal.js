// /internal — ให้ pos (Dev 3) เรียกตรง ไม่ผ่าน gateway (gateway บล็อก /internal ไว้แล้ว)
// ต้องมี X-Internal-Key แต่ไม่ต้องมี X-User-*
//   POST /internal/menus/lookup   ตรวจเมนู/ตัวเลือก ได้ชื่อและราคาไปเก็บตอนสั่ง
//   POST /internal/stocks/deduct  ตัดสต็อกตอนสั่ง (ตัดหมดหรือไม่ตัดเลย)
//   POST /internal/stocks/restore คืนสต็อกตอนสั่งไม่สำเร็จ (reference) / ยกเลิกรายการที่ยังไม่ได้ทำ (items + reference กันคืนซ้ำ)
import { Router } from 'express'
import { db, run } from './db.js'
import { AppError, conflict, parse, send, uuid, z } from './helpers.js'
import { toMenu } from './menus.js'

const quantity = z.number().int('ต้องเป็นจำนวนเต็ม').min(1, 'อย่างน้อย 1').max(999)
const reference = z.string().trim().min(1).max(100).optional() // แนะนำ ticket id ทำให้เรียกซ้ำได้ปลอดภัย

const lookupSchema = z.object({
  branch_id: uuid,
  items: z
    .array(z.object({ menu_id: uuid, quantity: quantity.optional(), option_ids: z.array(uuid).max(30).default([]) }))
    .min(1, 'ต้องมีอย่างน้อย 1 รายการ')
    .max(100),
})
const stockItems = z.array(z.object({ menu_id: uuid, quantity })).min(1, 'ต้องมีอย่างน้อย 1 รายการ').max(100)
const deductSchema = z.object({ branch_id: uuid, reference, items: stockItems })
const restoreSchema = z
  .object({ branch_id: uuid, reference, items: stockItems.optional() })
  .refine((v) => v.reference || v.items, 'ส่ง reference หรือ items อย่างใดอย่างหนึ่ง')

/** ตรวจรายการที่สั่งกับเมนูของสาขา → { problems, items } */
function checkItems(branchId, items, menus) {
  const byId = new Map(menus.map((m) => [m.id, m]))
  const problems = []

  const result = items.map((item, index) => {
    const menu = byId.get(item.menu_id)
    const fail = (code, message, extra = {}) => problems.push({ index, menu_id: item.menu_id, code, message, ...extra })

    if (!menu || menu.is_deleted || menu.branch_id !== branchId) {
      fail('MENU_NOT_FOUND', 'ไม่พบเมนูในสาขานี้')
      return null
    }
    if (!menu.is_available) fail('MENU_UNAVAILABLE', `${menu.name} ปิดขายอยู่`)
    if (item.quantity && item.quantity > menu.quantity) {
      fail('STOCK_NOT_ENOUGH', `${menu.name} เหลือ ${menu.quantity}`, { available: menu.quantity })
    }

    // ตัวเลือกต้องอยู่ในกลุ่มที่ผูกกับเมนูนี้ และยังเปิดใช้อยู่
    const optionMap = new Map()
    for (const g of menu.option_groups) for (const o of g.options) optionMap.set(o.id, { group: g, option: o })

    const picked = []
    const countByGroup = new Map()
    for (const optionId of new Set(item.option_ids)) {
      const hit = optionMap.get(optionId)
      if (!hit) {
        fail('INVALID_OPTION', 'ตัวเลือกนี้ใช้กับเมนูนี้ไม่ได้', { option_id: optionId })
        continue
      }
      countByGroup.set(hit.group.id, (countByGroup.get(hit.group.id) ?? 0) + 1)
      picked.push({
        option_id: hit.option.id,
        option_group_id: hit.group.id,
        group_name: hit.group.name,
        name: hit.option.name,
        extra_price: hit.option.extra_price,
      })
    }
    for (const g of menu.option_groups) {
      const n = countByGroup.get(g.id) ?? 0
      if (n > g.max_select) fail('OPTION_LIMIT_EXCEEDED', `${g.name} เลือกได้ไม่เกิน ${g.max_select}`, { option_group_id: g.id })
      if (g.is_required && n === 0) fail('OPTION_REQUIRED', `ต้องเลือก ${g.name}`, { option_group_id: g.id })
    }

    const extra = picked.reduce((sum, o) => sum + o.extra_price, 0)
    return {
      menu_id: menu.id,
      name: menu.name,
      category_id: menu.category_id,
      price: menu.price,
      options: picked,
      unit_price: Math.round((menu.price + extra) * 100) / 100, // ราคาเมนู + ราคาบวกเพิ่มของตัวเลือก
      quantity_available: menu.quantity,
    }
  })
  return { problems, items: result }
}

const router = Router()

// ตรวจเมนูและตัวเลือก แล้วคืนชื่อ/ราคาให้ pos เก็บเป็น snapshot (1.9)
router.post('/menus/lookup', async (req, res) => {
  const { branch_id, items } = parse(lookupSchema, req.body)
  const ids = [...new Set(items.map((i) => i.menu_id))]
  const rows = await run(
    db.from('menus').select('*, categories(name), stocks(quantity, is_available), menu_option_groups(sort_order, option_groups(*, options(*)))').in('id', ids),
  )
  const menus = rows.map((row) => toMenu(row, { withOptions: true }))
  const { problems, items: result } = checkItems(branch_id, items, menus)
  if (problems.length) throw new AppError(409, 'MENU_LOOKUP_FAILED', 'รายการสั่งบางรายการใช้ไม่ได้', problems)
  send(res, { branch_id, items: result })
})

// ตัดสต็อกตอนสั่ง: ตัดทุกรายการพร้อมกันหรือไม่ตัดเลย (1.20) · เหลือ 0 ปิดขายเอง (1.21)
router.post('/stocks/deduct', async (req, res) => {
  const { branch_id, items, reference: ref } = parse(deductSchema, req.body)
  const out = await run(db.rpc('deduct_stocks', { p_branch_id: branch_id, p_items: items, p_reference: ref ?? null }))
  if (!out.ok) throw conflict('STOCK_NOT_ENOUGH', 'เมนูบางรายการหมดหรือปิดขาย', out.items)
  send(res, { replayed: Boolean(out.replayed), items: out.items })
})

// คืนสต็อก: สั่งไม่สำเร็จ / ยกเลิกรายการที่ยังไม่ได้ทำ (ไม่ใช้ตอนคืนเงิน) · ไม่เปิดขายให้
// ส่ง items → คืนตาม items (reference ใช้กันคืนซ้ำ) · ไม่ส่ง items → คืนทั้งหมดที่ตัดด้วย reference
router.post('/stocks/restore', async (req, res) => {
  const { branch_id, items, reference: ref } = parse(restoreSchema, req.body)
  const out = await run(
    db.rpc('restore_stocks', { p_branch_id: branch_id, p_items: items ?? [], p_reference: ref ?? null }),
  )
  send(res, { replayed: Boolean(out.replayed), items: out.items })
})

export default router
