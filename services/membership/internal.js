// /internal — ให้ service อื่นเรียก (ไม่ผ่าน gateway) เช่น pos/payment ให้แต้มเมื่อปิดบิล
//   GET  /internal/customers/lookup?phone=        หาสมาชิกด้วยเบอร์
//   POST /internal/visits { customer_id | phone, order_id, branch_id, amount }  ได้แต้ม 1 ครั้งต่อบิล

import { Router } from 'express'
import { db, run } from './db.js'
import { badRequest, money, notFound, parse, send, uuid, z } from './helpers.js'

const phone = z.string().trim().regex(/^0[0-9]{8,9}$/)
const visitSchema = z
  .object({ customer_id: uuid.optional(), phone: phone.optional(), order_id: uuid, branch_id: uuid, amount: money })
  .refine((v) => v.customer_id || v.phone, 'ต้องส่ง customer_id หรือ phone')

const router = Router()

router.get('/customers/lookup', async (req, res) => {
  const p = parse(z.object({ phone }), req.query).phone
  const row = await run(db.from('customers').select('id, phone, full_name, points_balance, tier_id').eq('phone', p).eq('is_active', true).maybeSingle())
  if (!row) throw notFound('ยังไม่เป็นสมาชิก', 'MEMBER_NOT_FOUND')
  send(res, row)
})

router.post('/visits', async (req, res) => {
  const body = parse(visitSchema, req.body)
  let customerId = body.customer_id
  if (!customerId) {
    const row = await run(db.from('customers').select('id').eq('phone', body.phone).eq('is_active', true).maybeSingle())
    if (!row) throw notFound('ยังไม่เป็นสมาชิก', 'MEMBER_NOT_FOUND')
    customerId = row.id
  }
  if (body.amount <= 0) throw badRequest('ยอดต้องมากกว่า 0')
  const result = await run(db.rpc('record_visit', { p_customer: customerId, p_amount: body.amount, p_order: body.order_id, p_branch: body.branch_id }))
  send(res, result, { status: result.duplicate ? 200 : 201 })
})

export default router
