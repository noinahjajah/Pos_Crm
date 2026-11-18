// /stocks — สต็อกของแต่ละเมนู (1.19–1.22)
// เหลือ 0 → ปิดขายอัตโนมัติ · เติมจาก 0 → ไม่เปิดขายให้ (ของเข้าแล้วแต่อาจยังไม่ได้เตรียม)
import { Router } from 'express'
import { db, run } from './db.js'
import { allow, branchFilter, mustBeMyBranch, notFound, parse, send, uuid, z } from './helpers.js'

const adjustSchema = z
  .object({
    quantity: z.number().int('ต้องเป็นจำนวนเต็ม').min(0).max(100000).optional(), // ตั้งค่าตรง ๆ
    add: z.number().int('ต้องเป็นจำนวนเต็ม').min(1, 'เติมอย่างน้อย 1').max(100000).optional(), // เติมเพิ่ม
  })
  .refine((v) => (v.quantity === undefined) !== (v.add === undefined), 'ส่ง quantity (ตั้งค่า) หรือ add (เติมเพิ่ม) อย่างใดอย่างหนึ่ง')

const router = Router()

// GET /stocks — สต็อกของสาขาพร้อมชื่อเมนูและหมวด
router.get('/', allow('manager', 'owner'), async (req, res) => {
  let query = db
    .from('stocks')
    .select('*, menus!inner(name, category_id, is_deleted, categories(name))')
    .eq('menus.is_deleted', false)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)

  const rows = (await run(query))
    .map(({ menus, ...s }) => ({
      ...s,
      menu_name: menus.name,
      category_id: menus.category_id,
      category_name: menus.categories?.name ?? null,
    }))
    .sort((a, b) => a.menu_name.localeCompare(b.menu_name, 'th'))
  send(res, rows, { meta: { total: rows.length } })
})

// PATCH /stocks/:menuId { quantity } หรือ { add }
router.patch('/:menuId', allow('manager', 'owner'), async (req, res) => {
  const menuId = parse(uuid, req.params.menuId)
  const { quantity, add } = parse(adjustSchema, req.body)

  const menu = await run(db.from('menus').select('name, branch_id').eq('id', menuId).eq('is_deleted', false).maybeSingle())
  if (!menu) throw notFound('ไม่พบเมนู', 'MENU_NOT_FOUND')
  mustBeMyBranch(req, menu.branch_id)

  // ฟังก์ชันในฐานข้อมูลล็อกแถวก่อนแก้ กันชนกับการตัดสต็อกตอนสั่งอาหาร และบันทึกประวัติให้
  const stock = await run(
    db.rpc('adjust_stock', { p_menu_id: menuId, p_quantity: quantity ?? null, p_add: add ?? null, p_actor: req.user.id }),
  )
  send(res, { ...(Array.isArray(stock) ? stock[0] : stock), menu_name: menu.name })
})

export default router
