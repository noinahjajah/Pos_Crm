// /option-groups และ /options — กลุ่มตัวเลือกของแต่ละสาขา (1.16, 1.17)
// เช่น "ระดับความเผ็ด" (เลือกได้ 1) หรือ "ท็อปปิ้ง" (เลือกได้หลายอย่าง) · ปิดใช้แทนการลบ
import { Router } from 'express'
import { db, run } from './db.js'
import {
  allow,
  atLeastOne,
  branchFilter,
  branchForCreate,
  dbError,
  idParam,
  money,
  mustBeMyBranch,
  name,
  notFound,
  parse,
  send,
  uuid,
  z,
} from './helpers.js'

const optionSchema = z.object({
  name,
  extra_price: money.default(0),
  sort_order: z.number().int().min(0).max(999).optional(),
})
const maxSelect = z.number().int().min(1, 'max_select อย่างน้อย 1').max(20)

const createGroupSchema = z.object({
  branch_id: uuid.optional(),
  name,
  is_required: z.boolean().default(false),
  max_select: maxSelect,
  options: z.array(optionSchema).max(30).default([]),
})
const updateGroupSchema = z
  .object({ name: name.optional(), is_required: z.boolean().optional(), max_select: maxSelect.optional(), is_active: z.boolean().optional() })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')
const updateOptionSchema = z
  .object({ name: name.optional(), extra_price: money.optional(), sort_order: z.number().int().min(0).max(999).optional(), is_active: z.boolean().optional() })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

/** จัดรูปกลุ่ม: เรียงตัวเลือก + แปลงราคาเป็นตัวเลข */
function toGroup(g, includeInactive = true) {
  return {
    ...g,
    options: (g.options ?? [])
      .filter((o) => includeInactive || o.is_active)
      .map((o) => ({ ...o, extra_price: Number(o.extra_price) }))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  }
}

async function loadGroup(req, id) {
  const g = await run(db.from('option_groups').select('*, options(*)').eq('id', id).maybeSingle())
  if (!g) throw notFound('ไม่พบกลุ่มตัวเลือก', 'OPTION_GROUP_NOT_FOUND')
  mustBeMyBranch(req, g.branch_id)
  return toGroup(g)
}

// ===================== /option-groups =====================
export const optionGroupRouter = Router()

// GET /option-groups — พร้อมตัวเลือก · manager/owner ส่ง ?include_inactive=true ดูที่ปิดใช้ด้วย
optionGroupRouter.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  const showAll = req.user.role !== 'staff' && req.query.include_inactive === 'true'
  let query = db.from('option_groups').select('*, options(*)').order('name')
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (!showAll) query = query.eq('is_active', true)
  send(res, (await run(query)).map((g) => toGroup(g, showAll)))
})

// POST /option-groups — สร้างกลุ่ม (ส่ง options มาพร้อมกันได้)
optionGroupRouter.post('/', allow('manager', 'owner'), async (req, res) => {
  const { options, branch_id, ...data } = parse(createGroupSchema, req.body)
  const group = await run(db.from('option_groups').insert({ ...data, branch_id: branchForCreate(req, branch_id) }).select('id').single())
  if (options.length) {
    const rows = options.map((o, i) => ({ sort_order: i + 1, ...o, option_group_id: group.id }))
    const { error } = await db.from('options').insert(rows)
    if (error) {
      await db.from('option_groups').delete().eq('id', group.id) // ใส่ตัวเลือกไม่ผ่าน → ลบกลุ่มทิ้ง ไม่ให้ค้างครึ่ง ๆ
      throw dbError(error)
    }
  }
  send(res, await loadGroup(req, group.id), { status: 201 })
})

// PATCH /option-groups/:id
optionGroupRouter.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateGroupSchema, req.body)
  await loadGroup(req, id)
  await run(db.from('option_groups').update(body).eq('id', id))
  send(res, await loadGroup(req, id))
})

// POST /option-groups/:id/options — เพิ่มตัวเลือกพร้อมราคาบวกเพิ่ม
optionGroupRouter.post('/:id/options', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(optionSchema, req.body)
  const group = await loadGroup(req, id)
  const row = await run(
    db.from('options').insert({ sort_order: group.options.length + 1, ...body, option_group_id: id }).select().single(),
  )
  send(res, { ...row, extra_price: Number(row.extra_price) }, { status: 201 })
})

// ===================== /options =====================
export const optionRouter = Router()

// PATCH /options/:id — แก้ชื่อ ราคาบวกเพิ่ม หรือปิดใช้ (is_active: false)
optionRouter.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateOptionSchema, req.body)
  const option = await run(db.from('options').select('id, option_groups(branch_id)').eq('id', id).maybeSingle())
  if (!option) throw notFound('ไม่พบตัวเลือก', 'OPTION_NOT_FOUND')
  mustBeMyBranch(req, option.option_groups.branch_id)
  const row = await run(db.from('options').update(body).eq('id', id).select().single())
  send(res, { ...row, extra_price: Number(row.extra_price) })
})
