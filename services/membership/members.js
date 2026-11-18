// /customers — สมาชิกลูกค้า (ใช้ร่วมทุกสาขา) · /tiers — ระดับสมาชิก

import { Router } from 'express'
import { db, run } from './db.js'
import { allow, atLeastOne, branchForCreate, dbError, idParam, money, notFound, parse, send, uuid, z } from './helpers.js'

const ALL = ['staff', 'manager', 'owner']
const CUSTOMER_COLS = 'id, phone, full_name, birth_date, points_balance, total_earned, registered_branch_id, is_active, created_at, tier:membership_tiers(id, name, min_points, point_rate)'

const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .pipe(z.string().regex(/^0[0-9]{8,9}$/, 'เบอร์โทร 9–10 หลัก ขึ้นต้นด้วย 0'))
const fullName = z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100)
const birthDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบ YYYY-MM-DD').nullish()

const createSchema = z.object({ phone, full_name: fullName, birth_date: birthDate, branch_id: uuid.optional() })
const updateSchema = z
  .object({ phone: phone.optional(), full_name: fullName.optional(), birth_date: birthDate, is_active: z.boolean().optional() })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')
const listQuery = z.object({
  q: z.string().trim().max(50).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  include_inactive: z.enum(['true', 'false']).optional(),
})
const visitSchema = z.object({ amount: money.refine((v) => v > 0, 'ยอดต้องมากกว่า 0'), order_id: uuid.optional(), branch_id: uuid.optional() })
const redeemSchema = z.object({ points: z.number().int().min(1, 'อย่างน้อย 1 แต้ม').max(1_000_000), note: z.string().trim().max(200).optional(), branch_id: uuid.optional() })
const adjustSchema = z.object({
  points: z.number().int().min(-1_000_000).max(1_000_000).refine((v) => v !== 0, 'ต้องไม่เป็น 0'),
  note: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(200),
  branch_id: uuid.optional(),
})
const tierSchema = z
  .object({
    name: z.string().trim().min(1).max(50).optional(),
    min_points: z.number().int().min(0).max(10_000_000).optional(),
    point_rate: z.number().min(0).max(1).optional(),
  })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

async function getCustomer(id) {
  const row = await run(db.from('customers').select(CUSTOMER_COLS).eq('id', id).maybeSingle())
  if (!row) throw notFound('ไม่พบสมาชิก', 'MEMBER_NOT_FOUND')
  return row
}

export const customers = Router()

// GET /customers?q= — ค้นหาด้วยเบอร์หรือชื่อ
customers.get('/', allow(...ALL), async (req, res) => {
  const { q, page, limit, include_inactive } = parse(listQuery, req.query)
  let query = db.from('customers').select(CUSTOMER_COLS, { count: 'exact' }).order('created_at', { ascending: false })
  if (include_inactive !== 'true' || req.user.role === 'staff') query = query.eq('is_active', true)
  if (q) {
    const digits = q.replace(/[\s-]/g, '')
    const safe = q.replace(/[%,()]/g, '')
    query = /^[0-9]+$/.test(digits) ? query.like('phone', `%${digits}%`) : query.ilike('full_name', `%${safe}%`)
  }
  const from = (page - 1) * limit
  const { data, error, count } = await query.range(from, from + limit - 1)
  if (error) throw dbError(error)
  send(res, data, { meta: { page, limit, total: count ?? 0 } })
})

// GET /customers/lookup?phone= — หาด้วยเบอร์ตรงตัว (ตอนคิดเงิน)
customers.get('/lookup', allow(...ALL), async (req, res) => {
  const p = parse(z.object({ phone }), req.query).phone
  const row = await run(db.from('customers').select(CUSTOMER_COLS).eq('phone', p).eq('is_active', true).maybeSingle())
  if (!row) throw notFound('ยังไม่เป็นสมาชิก', 'MEMBER_NOT_FOUND')
  send(res, row)
})

// GET /customers/:id — ข้อมูลสมาชิก + ประวัติแต้มและการมาใช้บริการล่าสุด
customers.get('/:id', allow(...ALL), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const [customer, transactions, visits] = await Promise.all([
    getCustomer(id),
    run(db.from('point_transactions').select('*').eq('customer_id', id).order('created_at', { ascending: false }).limit(30)),
    run(db.from('visits').select('*').eq('customer_id', id).order('visited_at', { ascending: false }).limit(30)),
  ])
  send(res, { ...customer, transactions, visits })
})

// POST /customers — สมัครสมาชิก (สาขาที่สมัคร = สาขาของพนักงาน · owner เลือกได้)
customers.post('/', allow(...ALL), async (req, res) => {
  const { branch_id, ...body } = parse(createSchema, req.body)
  const registered = req.user.role === 'owner' ? branch_id ?? null : req.user.branchId
  const row = await run(db.from('customers').insert({ ...body, registered_branch_id: registered }).select(CUSTOMER_COLS).single())
  send(res, row, { status: 201 })
})

// PATCH /customers/:id — แก้ข้อมูล / ปิดสมาชิก (manager, owner)
customers.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const row = await run(db.from('customers').update(body).eq('id', id).select(CUSTOMER_COLS).maybeSingle())
  if (!row) throw notFound('ไม่พบสมาชิก', 'MEMBER_NOT_FOUND')
  send(res, row)
})

// POST /customers/:id/visits { amount, order_id? } — บันทึกยอดซื้อ ได้แต้มตามระดับ
customers.post('/:id/visits', allow(...ALL), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { amount, order_id, branch_id } = parse(visitSchema, req.body)
  const result = await run(
    db.rpc('record_visit', { p_customer: id, p_amount: amount, p_order: order_id ?? null, p_branch: branchForCreate(req, branch_id), p_by: req.user.id }),
  )
  send(res, { ...result, customer: await getCustomer(id) }, { status: result.duplicate ? 200 : 201 })
})

// POST /customers/:id/redeem { points } — แลกแต้ม
customers.post('/:id/redeem', allow(...ALL), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { points, note, branch_id } = parse(redeemSchema, req.body)
  await run(db.rpc('apply_points', { p_customer: id, p_points: -points, p_type: 'redeem', p_branch: branchForCreate(req, branch_id), p_note: note ?? null, p_by: req.user.id }))
  send(res, await getCustomer(id))
})

// POST /customers/:id/adjust { points (+/-), note } — ปรับแต้ม (manager, owner) ไม่นับขึ้นระดับ
customers.post('/:id/adjust', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { points, note, branch_id } = parse(adjustSchema, req.body)
  const branch = req.user.role === 'owner' ? branch_id ?? null : req.user.branchId
  await run(db.rpc('apply_points', { p_customer: id, p_points: points, p_type: 'adjust', p_branch: branch, p_note: note, p_by: req.user.id }))
  send(res, await getCustomer(id))
})

export const tiers = Router()

// GET /tiers — ระดับสมาชิก
tiers.get('/', allow(...ALL), async (req, res) => {
  send(res, await run(db.from('membership_tiers').select('*').order('min_points')))
})

// PATCH /tiers/:id — owner ปรับชื่อ เกณฑ์แต้ม อัตราแต้ม
tiers.patch('/:id', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(tierSchema, req.body)
  const row = await run(db.from('membership_tiers').update(body).eq('id', id).select().maybeSingle())
  if (!row) throw notFound('ไม่พบระดับสมาชิก', 'TIER_NOT_FOUND')
  send(res, row)
})
