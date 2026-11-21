// /internal — ให้ payment (Dev 2) เรียกตรง ไม่ผ่าน gateway (gateway บล็อก /internal ไว้แล้ว)
// ต้องมี X-Internal-Key แต่ไม่มี X-User-* · ตรงกับ services/payment/pos.js
//   GET  /internal/orders/:id/summary         ยอดที่ต้องจ่าย + รายการ + สถานะบิล
//   GET  /internal/orders?status=&branch_id=  บิลรอชำระของสาขา
//   POST /internal/orders/:id/mark-paid       ปิดบิล คืนโต๊ะเป็นว่าง (1.26)
//   POST /internal/orders/:id/mark-refunded   บันทึกการคืนเงินตามคำขอที่อนุมัติ
//   GET  /internal/approvals/:id              ข้อมูลคำขอคืนเงิน
//   GET  /internal/approvals?type=&status=&branch_id=  คำขอคืนเงินที่อนุมัติแล้วและยังไม่ได้คืน
//   GET  /internal/reports/top-menus?from=&to=&branch_id=&limit=  เมนูขายดี (1.35)
//   GET  /internal/reports/approved-refunds?from=&to=&branch_id=  คืนเงินที่อนุมัติในช่วงวันนั้นแต่ยังไม่ได้คืน (หักรายได้ตั้งแต่อนุมัติ)
import { Router } from 'express'
import { db, rpc, run } from './db.js'
import { publishApproval } from './events.js'
import { dateString, dayRangeIso, idParam, money, notFound, parse, send, todayTh, uuid, z } from './helpers.js'
import { APPROVAL_FULL, ORDER_FULL, loadApproval, toApprovals, toOrder, toPaymentSummary } from './views.js'

const markPaidSchema = z.object({
  payment_id: uuid,
  method: z.enum(['cash', 'promptpay', 'credit_card']),
  amount: money,
  paid_by: uuid,
  paid_at: z.string().datetime({ offset: true }).optional(),
})
const markRefundedSchema = z.object({
  payment_id: uuid,
  approval_id: uuid,
  amount: money,
  refunded_at: z.string().datetime({ offset: true }).optional(),
})
const ordersSchema = z.object({
  status: z.enum(['open', 'waiting_payment', 'paid', 'refunded']).default('waiting_payment'),
  branch_id: uuid,
})
const approvalsSchema = z.object({
  type: z.enum(['discount', 'refund']).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional(),
  branch_id: uuid,
})
const topSchema = z.object({
  from: dateString.default(() => todayTh()),
  to: dateString.optional(),
  branch_id: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(5),
})
const approvedRefundsSchema = z.object({
  from: dateString.default(() => todayTh()),
  to: dateString.optional(),
  branch_id: uuid.optional(),
})

/** บิลเต็มในรูปที่ payment ใช้ · ไม่มี → 404 (payment แปลงเป็น null) */
async function summary(id) {
  const row = await run(db.from('orders').select(ORDER_FULL).eq('id', id).maybeSingle())
  if (!row) throw notFound('ไม่พบบิล', 'ORDER_NOT_FOUND')
  return toPaymentSummary(await toOrder(row))
}

const router = Router()

router.get('/orders/:id/summary', async (req, res) => {
  const { id } = parse(idParam, req.params)
  send(res, await summary(id))
})

router.get('/orders', async (req, res) => {
  const { status, branch_id } = parse(ordersSchema, req.query)
  const rows = await run(db.from('orders').select(ORDER_FULL).eq('branch_id', branch_id).eq('status', status).order('opened_at'))
  send(res, await Promise.all(rows.map(async (r) => toPaymentSummary(await toOrder(r)))))
})

router.post('/orders/:id/mark-paid', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const b = parse(markPaidSchema, req.body)
  await rpc('mark_paid', {
    p_order_id: id,
    p_payment_id: b.payment_id,
    p_method: b.method,
    p_amount: b.amount,
    p_paid_by: b.paid_by,
    p_paid_at: b.paid_at ?? new Date().toISOString(),
  })
  send(res, await summary(id))
})

router.post('/orders/:id/mark-refunded', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const b = parse(markRefundedSchema, req.body)
  await rpc('mark_refunded', {
    p_order_id: id,
    p_approval_id: b.approval_id,
    p_payment_id: b.payment_id,
    p_amount: b.amount,
    p_refunded_at: b.refunded_at ?? new Date().toISOString(),
  })
  publishApproval(await loadApproval(b.approval_id))
  send(res, await summary(id))
})

router.get('/approvals/:id', async (req, res) => {
  const { id } = parse(idParam, req.params)
  send(res, await loadApproval(id))
})

router.get('/approvals', async (req, res) => {
  const q = parse(approvalsSchema, req.query)
  let query = db.from('approvals').select(APPROVAL_FULL).eq('branch_id', q.branch_id).order('requested_at')
  if (q.type) query = query.eq('type', q.type)
  if (q.status) query = query.eq('status', q.status)
  // คืนเงินที่อนุมัติแล้ว: เอาเฉพาะที่ยังไม่ได้คืน
  if (q.type === 'refund' && q.status === 'approved') query = query.is('refunded_at', null)
  send(res, await toApprovals(await run(query)))
})

// วันที่ = วันที่อนุมัติ (เวลาไทย) · ไม่รวมที่คืนเงินแล้ว (refunded_at) เพราะ payment นับจากรายการคืนเงินเอง
router.get('/reports/approved-refunds', async (req, res) => {
  const q = parse(approvedRefundsSchema, req.query)
  const [start, end] = dayRangeIso(q.from, q.to ?? q.from)
  let query = db
    .from('approvals')
    .select('id, order_id, branch_id, amount, decided_at')
    .eq('type', 'refund')
    .eq('status', 'approved')
    .is('refunded_at', null)
    .gte('decided_at', start)
    .lt('decided_at', end)
    .order('decided_at')
  if (q.branch_id) query = query.eq('branch_id', q.branch_id)
  const rows = await run(query)
  send(res, rows.map((a) => ({ id: a.id, order_id: a.order_id, branch_id: a.branch_id, amount: Number(a.amount), decided_at: a.decided_at })))
})

router.get('/reports/top-menus', async (req, res) => {
  const q = parse(topSchema, req.query)
  const rows = await rpc('top_menus', { p_from: q.from, p_to: q.to ?? q.from, p_branch: q.branch_id ?? null, p_limit: q.limit })
  send(
    res,
    rows.map((r) => ({ menu_id: r.menu_id, menu_name: r.menu_name, quantity: Number(r.quantity), amount: Number(r.amount) })),
  )
})

export default router
