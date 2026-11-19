// /internal — ให้ payment (Dev 2) เรียกตรง ไม่ผ่าน gateway (gateway บล็อก /internal ไว้แล้ว) · ต้องมี X-Internal-Key
//   GET  /internal/orders/:id/summary        ยอดที่ต้องจ่าย + สถานะบิล
//   POST /internal/orders/:id/mark-paid      ปิดบิล คืนโต๊ะเป็นว่าง (เรียกซ้ำได้)
//   POST /internal/orders/:id/mark-refunded  อัปเดตบิลหลังคืนเงิน (ไม่คืนสต็อก)
//   GET  /internal/approvals/:id             ข้อมูลคำขอคืนเงิน
//   GET  /internal/reports/top-menus         เมนูขายดี
import { Router } from 'express'
import { db, run } from './db.js'
import { publish } from './events.js'
import { dateRange, idParam, parse, round2, send, uuid, z } from './helpers.js'

const summary = (o) => ({
  id: o.id,
  order_no: o.order_no,
  branch_id: o.branch_id,
  status: o.status,
  subtotal: Number(o.subtotal),
  discount_amount: Number(o.discount_amount),
  vat_amount: Number(o.vat_amount),
  total: Number(o.total),
})

const router = Router()

router.get('/orders/:id/summary', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const row = await run(db.from('orders').select('*').eq('id', id).maybeSingle())
  if (!row) return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'ไม่พบบิล', details: [] } })
  send(res, summary(row))
})

router.post('/orders/:id/mark-paid', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { paid_by } = parse(z.object({ paid_by: uuid.optional() }).passthrough(), req.body)
  const row = await run(db.rpc('mark_paid', { p_order: id, p_by: paid_by ?? null }))
  publish('table', { branch_id: row.branch_id })
  send(res, summary(row))
})

router.post('/orders/:id/mark-refunded', async (req, res) => {
  const { id } = parse(idParam, req.params)
  // ยอดที่อนุมัติคืนแล้วทั้งหมดของบิล · คืนครบยอดบิล → refunded
  const approved = await run(db.from('approvals').select('amount').eq('order_id', id).eq('type', 'refund').eq('status', 'approved'))
  const refunded = round2(approved.reduce((s, a) => s + Number(a.amount), 0))
  const row = await run(db.rpc('mark_refunded', { p_order: id, p_refunded_total: refunded }))
  send(res, { ...summary(row), refunded_total: refunded })
})

router.get('/approvals/:id', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const row = await run(db.from('approvals').select('*').eq('id', id).maybeSingle())
  if (!row) return res.status(404).json({ error: { code: 'APPROVAL_NOT_FOUND', message: 'ไม่พบคำขอ', details: [] } })
  send(res, { ...row, value: Number(row.value), amount: Number(row.amount) })
})

router.get('/reports/top-menus', async (req, res) => {
  const { from, to } = dateRange(req.query, { defaultToday: true })
  const q = parse(z.object({ branch_id: uuid.optional(), limit: z.coerce.number().int().min(1).max(50).default(10) }), req.query)
  const rows = await run(db.rpc('report_top_menus', { p_from: from, p_to: to, p_branch: q.branch_id ?? null, p_limit: q.limit }))
  send(res, rows.map((r) => ({ menu_id: r.menu_id, menu_name: r.menu_name, quantity: Number(r.quantity), amount: Number(r.amount) })))
})

export default router
