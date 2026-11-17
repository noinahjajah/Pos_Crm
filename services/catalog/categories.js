// /categories — หมวดหมู่ ใช้ร่วมกันทุกสาขา จัดการได้เฉพาะ owner (1.14)
import { Router } from 'express'
import { db, run } from './db.js'
import { allow, atLeastOne, idParam, name, notFound, parse, send, z } from './helpers.js'

const createSchema = z.object({
  name,
  sort_order: z.number().int().min(0).max(9999).optional(),
})
const updateSchema = createSchema
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

const router = Router()

// GET /categories — ทุก role · owner ส่ง ?include_inactive=true เพื่อดูที่ปิดใช้ด้วย
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  let query = db.from('categories').select('*').order('sort_order').order('name')
  const showAll = req.user.role === 'owner' && req.query.include_inactive === 'true'
  if (!showAll) query = query.eq('is_active', true)
  send(res, await run(query))
})

// POST /categories — owner
router.post('/', allow('owner'), async (req, res) => {
  const body = parse(createSchema, req.body)
  send(res, await run(db.from('categories').insert(body).select().single()), { status: 201 })
})

// PATCH /categories/:id — owner (ปิดใช้ด้วย is_active: false)
router.patch('/:id', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const row = await run(db.from('categories').update(body).eq('id', id).select().maybeSingle())
  if (!row) throw notFound('ไม่พบหมวดหมู่', 'CATEGORY_NOT_FOUND')
  send(res, row)
})

export default router
