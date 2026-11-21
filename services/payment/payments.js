// /payments และ /refunds — รับเงินและคืนเงิน (1.23, 1.25, 1.28, 1.30)
import { Router } from 'express'
import { db, run } from './db.js'
import { pos } from './pos.js'
import {
  AppError,
  allow,
  branchFilter,
  conflict,
  dateRange,
  dateString,
  dayRangeIso,
  dbError,
  forbidden,
  notFound,
  parse,
  round2,
  send,
  uuid,
  z,
} from './helpers.js'

const method = z.enum(['cash', 'promptpay', 'credit_card'], { message: 'method ต้องเป็น cash, promptpay หรือ credit_card' })

// บัตรเครดิต/เดบิต: รูดที่เครื่อง EDC แล้วกรอกเลขท้ายบัตร 4 หลัก + รหัสอนุมัติจากสลิป EDC (ไม่รับเลขบัตรเต็ม)
const paySchema = z
  .object({
    order_id: uuid,
    method,
    cash_received: z.number().min(0).max(10_000_000).optional(),
    card_last4: z.string().regex(/^\d{4}$/, 'เลขท้ายบัตรต้องเป็นตัวเลข 4 หลัก').optional(),
    card_approval_code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9]{4,12}$/, 'รหัสอนุมัติต้องเป็นตัวอักษร/ตัวเลข 4–12 ตัว')
      .optional(),
  })
  .refine((v) => v.method !== 'cash' || v.cash_received !== undefined, {
    path: ['cash_received'],
    message: 'เงินสดต้องระบุจำนวนเงินที่รับ',
  })
  .refine((v) => v.method !== 'credit_card' || v.card_last4 !== undefined, {
    path: ['card_last4'],
    message: 'บัตรต้องระบุเลขท้ายบัตร 4 หลัก',
  })
  .refine((v) => v.method !== 'credit_card' || v.card_approval_code !== undefined, {
    path: ['card_approval_code'],
    message: 'บัตรต้องระบุรหัสอนุมัติจากสลิป EDC',
  })
const refundSchema = z.object({ approval_id: uuid, method })

/** บิล/คำขอของสาขาอื่น → 403 */
function mustBeMyBranch(req, branchId) {
  if (req.user.role !== 'owner' && req.user.branchId !== branchId) throw forbidden('เป็นของสาขาอื่น', 'FORBIDDEN_BRANCH')
}

/** ไม่ส่ง key ภายในออกไปให้หน้าเว็บ */
function present(p) {
  const { idempotency_key, pos_synced_at, ...rest } = p
  return {
    ...rest,
    amount: Number(rest.amount),
    cash_received: rest.cash_received === null ? null : Number(rest.cash_received),
    change_amount: rest.change_amount === null ? null : Number(rest.change_amount),
    order_status_synced: Boolean(pos_synced_at),
  }
}

/**
 * แจ้ง pos ให้อัปเดตบิล (ลอง 3 ครั้ง) · ไม่สำเร็จก็ไม่เป็นไร เงินบันทึกแล้ว
 * server.js จะลองใหม่ทุก 30 วินาทีด้วย syncPending()
 */
async function tellPos(payment, tries = 3) {
  for (let i = 1; i <= tries; i += 1) {
    try {
      const result =
        payment.type === 'charge'
          ? await pos.markPaid(payment.order_id, { payment_id: payment.id, method: payment.method, amount: Number(payment.amount), paid_by: payment.received_by, paid_at: payment.paid_at })
          : await pos.markRefunded(payment.order_id, { payment_id: payment.id, approval_id: payment.approval_id, amount: Number(payment.amount), refunded_at: payment.paid_at })
      if (result === null) return false
      const pos_synced_at = new Date().toISOString()
      await run(db.from('payments').update({ pos_synced_at }).eq('id', payment.id))
      payment.pos_synced_at = pos_synced_at
      return true
    } catch (err) {
      if (err instanceof AppError && err.status < 500) return false // pos ปฏิเสธ ลองซ้ำก็ไม่ผ่าน
      if (i < tries) await new Promise((r) => setTimeout(r, 300 * i))
    }
  }
  return false
}

/** ลองแจ้ง pos ใหม่สำหรับรายการที่ค้าง */
export async function syncPending() {
  const pending = await run(db.from('payments').select('*').is('pos_synced_at', null).order('paid_at').limit(20))
  let done = 0
  for (const p of pending) if (await tellPos(p, 1)) done += 1
  return { pending: pending.length, done }
}

// ===================== /payments =====================
export const paymentRouter = Router()

// POST /payments — รับเงิน · ต้องส่ง header Idempotency-Key (กดซ้ำด้วย key เดิม = ไม่รับเงินซ้ำ)
paymentRouter.post('/', allow('staff', 'manager'), async (req, res) => {
  const key = req.get('idempotency-key')
  if (!key || !/^[A-Za-z0-9_.:-]{8,100}$/.test(key)) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'ต้องส่ง header Idempotency-Key (8–100 ตัว เช่น uuid)')
  }
  const { order_id, method: payMethod, cash_received, card_last4, card_approval_code } = parse(paySchema, req.body)
  const isCard = payMethod === 'credit_card'

  // เคยรับเงินด้วย key นี้แล้ว → ส่งผลเดิมกลับ
  const replay = async () => {
    const old = await run(db.from('payments').select('*').eq('idempotency_key', key).maybeSingle())
    if (!old) return null
    if (old.type !== 'charge' || old.order_id !== order_id) throw conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key นี้ใช้กับรายการอื่นไปแล้ว')
    if (!old.pos_synced_at) await tellPos(old, 1)
    return old
  }
  const previous = await replay()
  if (previous) return send(res, { payment: present(previous), replayed: true })

  const order = await pos.getOrder(order_id)
  if (!order) throw notFound('ไม่พบบิล', 'ORDER_NOT_FOUND')
  mustBeMyBranch(req, order.branch_id)
  if (order.status === 'paid' || order.status === 'refunded') {
    const p = await replay() // อาจเป็น request ซ้ำที่อีกอันเพิ่งบันทึกไปเสี้ยววินาที
    if (p) return send(res, { payment: present(p), replayed: true })
    throw conflict('ORDER_ALREADY_PAID', 'บิลนี้ชำระเงินแล้ว')
  }
  if (order.status !== 'waiting_payment') throw conflict('ORDER_NOT_WAITING_PAYMENT', 'บิลยังไม่ได้กดเรียกเก็บเงิน')

  const total = round2(order.total)
  let cash = null
  let change = null
  if (payMethod === 'cash') {
    cash = round2(cash_received)
    if (cash < total) {
      throw new AppError(400, 'CASH_NOT_ENOUGH', `รับเงินไม่พอ ยอดที่ต้องชำระ ${total.toFixed(2)} บาท`, [
        { field: 'cash_received', message: `ต้องไม่น้อยกว่า ${total}` },
      ])
    }
    change = round2(cash - total)
  }

  let payment
  try {
    payment = await run(
      db
        .from('payments')
        .insert({
          order_id,
          branch_id: order.branch_id,
          type: 'charge',
          method: payMethod,
          amount: total,
          cash_received: cash,
          change_amount: change,
          card_last4: isCard ? card_last4 : null,
          card_approval_code: isCard ? card_approval_code : null,
          received_by: req.user.id,
          idempotency_key: key,
        })
        .select()
        .single(),
    )
  } catch (err) {
    // กดพร้อมกันด้วย key เดียวกัน → อีกอันบันทึกไปก่อนแล้ว ส่งผลนั้นกลับ
    if (err.code === 'IDEMPOTENCY_KEY_REUSED') {
      const p = await replay()
      if (p) return send(res, { payment: present(p), replayed: true })
    }
    throw err
  }

  await tellPos(payment)
  send(
    res,
    {
      payment: present(payment),
      order: { id: order.id, order_no: order.order_no, subtotal: order.subtotal, discount_amount: order.discount_amount, vat_amount: order.vat_amount, total },
      change_amount: change,
      replayed: false,
    },
    { status: 201 },
  )
})

// GET /payments?date= หรือ ?from=&to=, type, method, page, limit — รายการรับ/คืนเงิน (ค่าเริ่มต้น = วันนี้)
paymentRouter.get('/', allow('manager', 'owner'), async (req, res) => {
  const q = parse(
    z.object({
      date: dateString.optional(),
      type: z.enum(['charge', 'refund']).optional(),
      method: method.optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
    { date: req.query.date, type: req.query.type, method: req.query.method, page: req.query.page, limit: req.query.limit },
  )
  const { from, to } = q.date ? { from: q.date, to: q.date } : dateRange(req.query, { defaultToday: true })
  const [start, end] = dayRangeIso(from, to)

  let query = db
    .from('payments')
    .select('*', { count: 'exact' })
    .gte('paid_at', start)
    .lt('paid_at', end)
    .order('paid_at', { ascending: false })
    .range((q.page - 1) * q.limit, q.page * q.limit - 1)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (q.type) query = query.eq('type', q.type)
  if (q.method) query = query.eq('method', q.method)

  const { data, error, count } = await query
  if (error) throw dbError(error)
  send(res, data.map(present), { meta: { page: q.page, limit: q.limit, total: count ?? data.length, from, to } })
})

// ===================== /refunds =====================
export const refundRouter = Router()

// GET /refunds/approved — คำขอที่อนุมัติแล้ว บิลจ่ายแล้ว และยังไม่ได้คืนเงิน (ของสาขาตัวเอง)
refundRouter.get('/approved', allow('staff', 'manager'), async (req, res) => {
  const approvals = await pos.listApprovedRefunds({ branchId: req.user.branchId })
  const orderIds = [...new Set(approvals.map((a) => a.order_id))]
  const rows = orderIds.length ? await run(db.from('payments').select('order_id, type, approval_id').in('order_id', orderIds)) : []
  const charged = new Set(rows.filter((r) => r.type === 'charge').map((r) => r.order_id))
  const refunded = new Set(rows.filter((r) => r.type === 'refund').map((r) => r.approval_id))
  const open = approvals.filter((a) => charged.has(a.order_id) && !refunded.has(a.id))
  const items = await Promise.all(
    open.map(async (a) => {
      const order = await pos.getOrder(a.order_id)
      return { id: a.id, order_id: a.order_id, order_no: order?.order_no ?? null, amount: Number(a.amount), reason: a.reason ?? null }
    }),
  )
  send(res, items, { meta: { total: items.length } })
})

// POST /refunds { approval_id, method } — คืนเงินได้เฉพาะคำขอที่อนุมัติแล้ว · ไม่คืนสต็อก
refundRouter.post('/', allow('staff', 'manager'), async (req, res) => {
  const { approval_id, method: refundMethod } = parse(refundSchema, req.body)
  const key = req.get('idempotency-key') || null

  const done = await run(db.from('payments').select('*').eq('approval_id', approval_id).eq('type', 'refund').maybeSingle())
  if (done) {
    if (key && done.idempotency_key === key) return send(res, { payment: present(done), replayed: true })
    throw conflict('ALREADY_REFUNDED', 'คำขอนี้คืนเงินไปแล้ว', [{ payment_id: done.id, paid_at: done.paid_at }])
  }

  const approval = await pos.getApproval(approval_id)
  if (!approval) throw notFound('ไม่พบคำขอ', 'APPROVAL_NOT_FOUND')
  mustBeMyBranch(req, approval.branch_id)
  if (approval.type !== 'refund') throw conflict('NOT_A_REFUND', 'คำขอนี้ไม่ใช่คำขอคืนเงิน')
  if (approval.status !== 'approved') throw conflict('APPROVAL_NOT_APPROVED', 'คำขอคืนเงินยังไม่ได้รับอนุมัติ')

  const charge = await run(db.from('payments').select('amount').eq('order_id', approval.order_id).eq('type', 'charge').maybeSingle())
  if (!charge) throw conflict('ORDER_NOT_PAID', 'บิลนี้ยังไม่ได้ชำระเงิน คืนเงินไม่ได้')

  const amount = round2(approval.amount)
  const refunds = await run(db.from('payments').select('amount').eq('order_id', approval.order_id).eq('type', 'refund'))
  const refunded = round2(refunds.reduce((s, r) => s + Number(r.amount), 0))
  if (!(amount > 0)) throw conflict('INVALID_REFUND_AMOUNT', 'ยอดคืนเงินไม่ถูกต้อง')
  if (round2(refunded + amount) > Number(charge.amount)) {
    throw conflict('REFUND_EXCEEDS_PAID', 'ยอดคืนรวมเกินยอดที่ลูกค้าจ่าย', [{ paid: Number(charge.amount), refunded, requested: amount }])
  }

  const payment = await run(
    db
      .from('payments')
      .insert({
        order_id: approval.order_id,
        branch_id: approval.branch_id,
        type: 'refund',
        approval_id,
        method: refundMethod,
        amount,
        received_by: req.user.id,
        idempotency_key: key,
      })
      .select()
      .single(),
  )
  await tellPos(payment)
  send(res, { payment: present(payment), replayed: false }, { status: 201 })
})
