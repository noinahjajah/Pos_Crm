// คำขอส่วนลด/คืนเงิน (1.27–1.31)
//   POST /orders/:id/approvals  staff ขอ
//   GET  /approvals             staff เห็นของตัวเอง · manager สาขาตัวเอง · owner ทุกสาขา
//   POST /approvals/:id/approve|reject  manager/owner ตัดสิน (บันทึกผู้อนุมัติและเวลา ลบไม่ได้)
import { Router } from 'express'
import { db, run } from './db.js'
import { openStream, publish } from './events.js'
import { loadOrder } from './orders.js'
import { allow, branchFilter, conflict, idParam, mustBeMyBranch, notFound, parse, send, uuid, z } from './helpers.js'

const SELECT = '*, orders(order_no, status, total, order_tables(left_at, dining_tables(table_no))), refund_items(order_item_id, quantity, amount, order_items(menu_name))'

function toApproval(row) {
  const links = row.orders?.order_tables ?? []
  const active = links.filter((l) => !l.left_at)
  return {
    id: row.id,
    order_id: row.order_id,
    branch_id: row.branch_id,
    order_no: row.orders?.order_no,
    order_status: row.orders?.status,
    order_total: row.orders ? Number(row.orders.total) : null,
    table_names: [...new Set((active.length ? active : links).map((l) => l.dining_tables?.table_no).filter(Boolean))],
    type: row.type,
    value_type: row.value_type,
    value: Number(row.value),
    amount: Number(row.amount),
    reason: row.reason,
    status: row.status,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    approved_by: row.approved_by,
    decided_at: row.decided_at,
    refund_items: (row.refund_items ?? []).map((r) => ({
      order_item_id: r.order_item_id,
      menu_name: r.order_items?.menu_name,
      quantity: r.quantity,
      amount: Number(r.amount),
    })),
  }
}

const requestSchema = z
  .object({
    type: z.enum(['discount', 'refund'], { message: 'type ต้องเป็น discount หรือ refund' }),
    value_type: z.enum(['amount', 'percent']).default('amount'),
    value: z.number({ error: 'ใส่จำนวน' }).positive('ต้องมากกว่า 0').max(1_000_000).optional(),
    reason: z.string().trim().min(1, 'กรุณาใส่เหตุผล').max(300),
    refund_items: z.array(z.object({ order_item_id: uuid, quantity: z.number().int().min(1) })).max(50).default([]),
  })
  .refine((v) => v.value_type !== 'percent' || (v.value ?? 0) <= 100, { message: 'เปอร์เซ็นต์ต้องไม่เกิน 100', path: ['value'] })
  .refine((v) => v.value != null || (v.type === 'refund' && v.refund_items.length), { message: 'ใส่จำนวน หรือเลือกรายการที่คืน', path: ['value'] })
  .refine((v) => v.type === 'refund' || !v.refund_items.length, { message: 'ส่วนลดไม่ต้องเลือกรายการ', path: ['refund_items'] })

export const requestRouter = Router()

// staff ขอส่วนลด (บิลยังไม่จ่าย) หรือคืนเงิน (บิลจ่ายแล้ว)
requestRouter.post('/:id/approvals', allow('staff'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const order = await loadOrder(id)
  mustBeMyBranch(req, order.branch_id)
  const body = parse(requestSchema, req.body)
  const created = await run(
    db.rpc('create_approval', {
      p_order: order.id,
      p_by: req.user.id,
      p_type: body.type,
      p_value_type: body.value_type,
      p_value: body.value ?? 1,
      p_reason: body.reason,
      p_refund_items: body.refund_items,
    }),
  )
  const row = await run(db.from('approvals').select(SELECT).eq('id', created.id).single())
  publish('approval', { branch_id: row.branch_id, id: row.id, status: 'pending', requested_by: row.requested_by })
  send(res, toApproval(row), { status: 201 })
})

export const approvalRouter = Router()

approvalRouter.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  const q = parse(
    z.object({
      status: z.enum(['pending', 'approved', 'rejected']).optional(),
      order_id: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    req.query,
  )
  let query = db.from('approvals').select(SELECT).order('requested_at', { ascending: false }).limit(q.limit)
  if (req.user.role === 'staff') query = query.eq('requested_by', req.user.id)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (q.status) query = query.eq('status', q.status)
  if (q.order_id) query = query.eq('order_id', q.order_id)
  send(res, (await run(query)).map(toApproval))
})

async function decide(req, res, status) {
  const { id } = parse(idParam, req.params)
  const current = await run(db.from('approvals').select(SELECT).eq('id', id).maybeSingle())
  if (!current) throw notFound('ไม่พบคำขอ', 'APPROVAL_NOT_FOUND')
  mustBeMyBranch(req, current.branch_id)
  if (current.status !== 'pending') throw conflict('APPROVAL_DECIDED', 'คำขอนี้ตัดสินไปแล้ว')
  if (status === 'approved' && current.type === 'discount' && !['open', 'waiting_payment'].includes(current.orders?.status)) {
    throw conflict('ORDER_ALREADY_PAID', 'บิลจ่ายเงินแล้ว ให้ส่วนลดไม่ได้')
  }
  const row = await run(db.from('approvals').update({ status, approved_by: req.user.id }).eq('id', id).select(SELECT).single())
  publish('approval', { branch_id: row.branch_id, id: row.id, status, requested_by: row.requested_by })
  if (row.type === 'discount') publish('table', { branch_id: row.branch_id })
  send(res, toApproval(row))
}

approvalRouter.post('/:id/approve', allow('manager', 'owner'), (req, res) => decide(req, res, 'approved'))
approvalRouter.post('/:id/reject', allow('manager', 'owner'), (req, res) => decide(req, res, 'rejected'))

// SSE: แจ้งคำขอใหม่/ผลการตัดสิน · staff ได้รับเฉพาะคำขอของตัวเอง
approvalRouter.get('/stream', allow('staff', 'manager', 'owner'), (req, res) => {
  const branchId = branchFilter(req)
  const mine = req.user.role === 'staff' ? req.user.id : null
  openStream(req, res, (e) => e.type === 'approval' && (!branchId || e.branch_id === branchId) && (!mine || e.requested_by === mine))
})
