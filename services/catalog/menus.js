// /menus — เมนูของแต่ละสาขา (1.14, 1.15, 1.18)
import { Router } from 'express'
import { db, run, uploadImage } from './db.js'
import { branchForWrite, mustBeActiveBranch } from './identity.js'
import {
  allow,
  atLeastOne,
  badRequest,
  branchFilter,
  conflict,
  idParam,
  price,
  mustBeMyBranch,
  name,
  notFound,
  parse,
  send,
  uuid,
  z,
} from './helpers.js'

// ===================== รูปแบบข้อมูลที่รับ =====================
const image = z.object({
  data: z.string().min(1).max(3_000_000, 'รูปใหญ่เกิน 2MB'),
  content_type: z.enum(['image/jpeg', 'image/png', 'image/webp'], { message: 'รองรับเฉพาะ jpeg, png, webp' }),
})
const description = z.string().trim().max(500).nullish().transform((v) => v || null)
const imageUrl = z.string().trim().url('image_url ต้องเป็น URL').max(1000).nullish()

const createSchema = z.object({
  branch_id: uuid.optional(), // owner เท่านั้นที่ต้องส่ง
  category_id: uuid,
  name,
  description,
  price,
  image_url: imageUrl,
  image: image.optional(),
})
const updateSchema = z
  .object({
    category_id: uuid.optional(),
    name: name.optional(),
    description: description.optional(),
    price: price.optional(),
    image_url: imageUrl,
    image: image.optional(),
  })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

// ===================== อ่านข้อมูลเมนู =====================
// stocks กับ categories ดึงมาพร้อมกันในครั้งเดียว
const MENU_COLUMNS = '*, categories(name), stocks(quantity, is_available)'
const MENU_WITH_OPTIONS = `${MENU_COLUMNS},
  menu_option_groups(sort_order, option_groups(*, options(*)))`

const one = (v) => (Array.isArray(v) ? v[0] : v)

/** จัดรูปเมนูให้อ่านง่าย: รวมชื่อหมวด จำนวนคงเหลือ สถานะขาย */
export function toMenu(row, { withOptions = false, includeInactive = false } = {}) {
  if (!row) return null
  const { categories, stocks, menu_option_groups, ...menu } = row
  const stock = one(stocks)
  const out = {
    ...menu,
    price: Number(menu.price),
    category_name: one(categories)?.name ?? null,
    quantity: stock?.quantity ?? 0,
    is_available: stock?.is_available ?? false,
  }
  if (withOptions) {
    out.option_groups = (menu_option_groups ?? [])
      .filter((link) => link.option_groups && (includeInactive || link.option_groups.is_active))
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(({ sort_order, option_groups: g }) => ({
        ...g,
        sort_order,
        options: (g.options ?? [])
          .filter((o) => includeInactive || o.is_active)
          .map((o) => ({ ...o, extra_price: Number(o.extra_price) }))
          .sort((a, b) => a.sort_order - b.sort_order),
      }))
  }
  return out
}

/** เมนู 1 รายการพร้อมกลุ่มตัวเลือก · ไม่มี/ลบแล้ว → 404 · สาขาอื่น → 403 */
async function loadMenu(req, id, { includeInactive = false } = {}) {
  const row = await run(db.from('menus').select(MENU_WITH_OPTIONS).eq('id', id).eq('is_deleted', false).maybeSingle())
  if (!row) throw notFound('ไม่พบเมนู', 'MENU_NOT_FOUND')
  mustBeMyBranch(req, row.branch_id)
  return toMenu(row, { withOptions: true, includeInactive })
}

async function mustBeActiveCategory(categoryId) {
  const cat = await run(db.from('categories').select('is_active').eq('id', categoryId).maybeSingle())
  if (!cat?.is_active) throw badRequest('หมวดหมู่ไม่ถูกต้องหรือถูกปิดใช้', [{ field: 'category_id', message: 'หมวดหมู่ไม่ถูกต้อง' }])
}

const router = Router()

// GET /menus?category_id=&available=true&q= — เมนูของสาขา (owner ไม่ส่ง branch_id = ทุกสาขา)
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  let query = db.from('menus').select(MENU_COLUMNS).eq('is_deleted', false).order('name')
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (req.query.category_id) query = query.eq('category_id', parse(uuid, req.query.category_id))
  if (req.query.q) query = query.ilike('name', `%${String(req.query.q).replace(/[%_,()]/g, '')}%`)

  let menus = (await run(query)).map((row) => toMenu(row))
  if (req.query.available === 'true') menus = menus.filter((m) => m.is_available)
  send(res, menus, { meta: { total: menus.length } })
})

// GET /menus/:id — พร้อมกลุ่มตัวเลือก (staff เห็นเฉพาะตัวเลือกที่เปิดใช้)
router.get('/:id', allow('staff', 'manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  send(res, await loadMenu(req, id, { includeInactive: req.user.role !== 'staff' }))
})

// POST /menus — เพิ่มเมนู · ฐานข้อมูลสร้างสต็อก 0 ปิดขายให้อัตโนมัติ
router.post('/', allow('manager', 'owner'), async (req, res) => {
  const { image: img, branch_id, ...data } = parse(createSchema, req.body)
  const branchId = await branchForWrite(req, branch_id)
  await mustBeActiveCategory(data.category_id)
  if (img) data.image_url = await uploadImage(branchId, img)

  const created = await run(
    db.from('menus').insert({ ...data, image_url: data.image_url ?? null, branch_id: branchId }).select('id').single(),
  )
  send(res, await loadMenu(req, created.id, { includeInactive: true }), { status: 201 })
})

// PATCH /menus/:id — แก้ชื่อ หมวด ราคา รายละเอียด รูป (บิลเก่าไม่เปลี่ยนเพราะ pos เก็บราคาตอนสั่งไว้แล้ว)
router.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const menu = await loadMenu(req, id)
  const { image: img, ...patch } = parse(updateSchema, req.body)
  if (patch.category_id) await mustBeActiveCategory(patch.category_id)
  if (img) patch.image_url = await uploadImage(menu.branch_id, img)

  if (Object.keys(patch).length) await run(db.from('menus').update(patch).eq('id', id))
  send(res, await loadMenu(req, id, { includeInactive: true }))
})

// DELETE /menus/:id — ลบแบบซ่อน (บิลเก่ายังอ้างถึงได้) และปิดขาย
router.delete('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  await loadMenu(req, id)
  await run(db.from('menus').update({ is_deleted: true }).eq('id', id))
  await run(db.from('stocks').update({ is_available: false, updated_at: new Date().toISOString() }).eq('menu_id', id))
  send(res, { id, is_deleted: true })
})

// POST /menus/:id/copy { to_branch_id } — owner คัดลอกเมนูพร้อมกลุ่มตัวเลือกไปสาขาอื่น
router.post('/:id/copy', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { to_branch_id } = parse(z.object({ to_branch_id: uuid }), req.body)
  await mustBeActiveBranch(to_branch_id, 'to_branch_id')
  const newId = await run(db.rpc('copy_menu', { p_menu_id: id, p_to_branch: to_branch_id }))
  send(res, await loadMenu(req, newId, { includeInactive: true }), { status: 201 })
})

// PATCH /menus/:id/availability { is_available } — staff, manager, owner (1.15)
// เปิดขายไม่ได้ถ้าสต็อก = 0
router.patch('/:id/availability', allow('staff', 'manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { is_available } = parse(z.object({ is_available: z.boolean() }), req.body)
  await loadMenu(req, id)

  let query = db.from('stocks').update({ is_available, updated_at: new Date().toISOString() }).eq('menu_id', id)
  if (is_available) query = query.gt('quantity', 0) // เช็กกับอัปเดตในคำสั่งเดียว กันชนกับการตัดสต็อก
  const stock = await run(query.select('menu_id, quantity, is_available').maybeSingle())
  if (!stock) throw conflict('STOCK_EMPTY', 'สต็อกเป็น 0 เปิดขายไม่ได้ กรุณาเติมสต็อกก่อน')
  send(res, stock)
})

// PUT /menus/:id/option-groups { option_groups: [{ option_group_id, sort_order? }] } — แทนที่ทั้งชุด (1.18)
const linkSchema = z.object({
  option_groups: z
    .array(z.object({ option_group_id: uuid, sort_order: z.number().int().min(0).max(999).optional() }))
    .max(20)
    .refine((list) => new Set(list.map((g) => g.option_group_id)).size === list.length, 'มีกลุ่มตัวเลือกซ้ำ'),
})

router.put('/:id/option-groups', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { option_groups } = parse(linkSchema, req.body)
  await loadMenu(req, id)
  // ฟังก์ชันในฐานข้อมูลตรวจว่ากลุ่มอยู่สาขาเดียวกับเมนู แล้วลบของเดิม + ใส่ของใหม่ในครั้งเดียว
  await run(db.rpc('set_menu_option_groups', { p_menu_id: id, p_links: option_groups }))
  send(res, (await loadMenu(req, id, { includeInactive: true })).option_groups)
})

export default router
