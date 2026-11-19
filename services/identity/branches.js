// /branches — สาขา (1.6) ทุก role ดูรายชื่อได้ · owner เพิ่ม/แก้/ลบ
// ลบ = soft delete (is_active = false) เพื่อไม่ให้ id ที่ service อื่นอ้างหาย
// สาขาปิดแล้ว พนักงานของสาขานั้น login/refresh ไม่ได้ (hook ปฏิเสธ)
import { Router } from 'express'
import { db, run } from './db.js'
import { allow, atLeastOne, idParam, notFound, parse, send, z } from './helpers.js'

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))

const createSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9_-]{2,20}$/, 'รหัสสาขา 2–20 ตัว ใช้ A-Z 0-9 เช่น BAR01'),
  name: z.string().trim().min(1, 'กรุณากรอกชื่อสาขา').max(100),
  branch_type: z.enum(['restaurant', 'drinks', 'bar'], { message: 'ประเภทต้องเป็น restaurant, drinks หรือ bar' }),
  address: optionalText(300),
  phone: optionalText(20),
})
const updateSchema = createSchema
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

const COLUMNS = 'id, code, name, branch_type, address, phone, is_active, created_at, updated_at'
const router = Router()

// GET /branches — S M O · owner ส่ง ?include_inactive=true เพื่อดูสาขาที่ปิดแล้วด้วย
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  let query = db.from('branches').select(COLUMNS).order('code')
  const showAll = req.user.role === 'owner' && req.query.include_inactive === 'true'
  if (!showAll) query = query.eq('is_active', true)
  send(res, await run(query))
})

// POST /branches — O
router.post('/', allow('owner'), async (req, res) => {
  const body = parse(createSchema, req.body)
  send(res, await run(db.from('branches').insert(body).select(COLUMNS).single()), { status: 201 })
})

// PATCH /branches/:id — O (แก้ไข หรือเปิด/ปิดด้วย is_active)
router.patch('/:id', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const row = await run(db.from('branches').update(body).eq('id', id).select(COLUMNS).maybeSingle())
  if (!row) throw notFound('ไม่พบสาขา', 'BRANCH_NOT_FOUND')
  send(res, row)
})

// DELETE /branches/:id — O (soft delete)
router.delete('/:id', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const row = await run(db.from('branches').update({ is_active: false }).eq('id', id).select(COLUMNS).maybeSingle())
  if (!row) throw notFound('ไม่พบสาขา', 'BRANCH_NOT_FOUND')
  send(res, row)
})

export default router
