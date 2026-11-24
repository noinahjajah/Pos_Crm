// /orders — เปิดโต๊ะ สั่งอาหาร ย้าย/รวมโต๊ะ เรียกเก็บเงิน ขอส่วนลด/คืนเงิน (1.7–1.13, 1.20, 1.24, 1.27, 1.28)
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { db, rpc, run } from './db.js'
import { publishApproval } from './events.js'
import { allow, branchFilter, conflict, dateString, dayRangeIso, idParam, mustBeMyBranch, parse, send, uuid, z } from './helpers.js'
import { deductStocks, lookupMenus, restoreStockItems, restoreStocks } from './services.js'
import { ORDER_SUMMARY, loadApproval, loadOrder, toOrder, toOrderSummary } from './views.js'

const tableIds = z.array(uuid).min(1, 'เลือกอย่างน้อย 1 โต๊ะ').max(20)

const openSchema = z.object({ table_ids: tableIds, guest_count: z.number().int().min(1, 'อย่างน้อย 1 คน').max(200) })
const moveSchema = z.object({ from_table_id: uuid, to_table_id: uuid }).refine((v) => v.from_table_id !== v.to_table_id, 'โต๊ะต้นทางกับปลายทางต้องไม่ใช่โต๊ะเดียวกัน')
const mergeSchema = z.object({ table_ids: tableIds })
const ticketSchema = z.object({
  items: z
    .array(
      z.object({
        menu_id: uuid,
        quantity: z.number().int().min(1).max(999),
        note: z.string().trim().max(200).nullish().transform((v) => v || null),
        option_ids: z.array(uuid).max(30).default([]),
      }),
    )
    .min(1, 'ยังไม่มีรายการอาหาร')
    .max(100),
})
const approvalSchema = z
  .object({
    type: z.enum(['discount', 'refund']),
    value_type: z.enum(['amount', 'percent']).default('amount'),
    value: z.number().positive('ต้องมากกว่า 0').max(9_999_999),
    reason: z.string().trim().min(1, 'กรุณาระบุเหตุผล').max(200),
    refund_items: z.array(z.object({ order_item_id: uuid, quantity: z.number().int().min(1).max(999) })).max(100).optional(),
  })
  .refine((v) => v.value_type !== 'percent' || v.value <= 100, { path: ['value'], message: 'เปอร์เซ็นต์ต้องไม่เกิน 100' })
  .refine((v) => v.type !== 'refund' || v.value_type === 'amount', { path: ['value_type'], message: 'คืนเงินใช้ value_type = amount' })
const itemParams = z.object({ id: uuid, itemId: uuid })
const cancelItemSchema = z.object({
  quantity: z.number().int().min(1, 'อย่างน้อย 1').max(999),
  cooked: z.boolean({ required_error: 'เลือกว่าทำอาหารไปแล้วหรือยัง' }),
  reason: z.string().trim().max(200).nullish().transform((v) => v || null),
})
const listSchema = z.object({
  status: z.enum(['open', 'waiting_payment', 'paid', 'refunded', 'merged', 'cancelled']).optional(),
  date: dateString.optional(),
  q: z.string().trim().max(50).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})

/** บิลของสาขาตัวเองเท่านั้น (owner ผ่านทุกสาขา) */
async function myOrder(req, id) {
  const row = await loadOrder(id)
  mustBeMyBranch(req, row.branch_id)
  return row
}
const fullOrder = async (id) => toOrder(await loadOrder(id))

const router = Router()

// POST /orders — เปิดโต๊ะ/เปิดบิล { table_ids, guest_count } (1.7)
router.post('/', allow('staff', 'manager'), async (req, res) => {
  const { table_ids, guest_count } = parse(openSchema, req.body)
  const order = await rpc('open_order', { p_branch_id: req.user.branchId, p_table_ids: table_ids, p_guest_count: guest_count, p_actor: req.user.id })
  send(res, await fullOrder(order.id), { status: 201 })
})

// GET /orders?status=&date=&q= — รายการบิล (date = วันที่เปิดบิล หรือวันที่ปิดสำหรับบิลที่จ่ายแล้ว)
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  const q = parse(listSchema, req.query)
  let query = db.from('orders').select(ORDER_SUMMARY).order('opened_at', { ascending: false }).limit(q.limit)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (q.status) query = query.eq('status', q.status)
  if (q.q) query = query.ilike('order_no', `%${q.q.replace(/[%_,()]/g, '')}%`)
  if (q.date) {
    const [start, end] = dayRangeIso(q.date)
    const col = q.status === 'paid' || q.status === 'refunded' ? 'closed_at' : 'opened_at'
    query = query.gte(col, start).lt(col, end)
  }
  const rows = (await run(query)).map(toOrderSummary)
  send(res, rows, { meta: { total: rows.length } })
})

// GET /orders/:id — บิลเต็ม (1.23, 1.24)
router.get('/:id', allow('staff', 'manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  send(res, await toOrder(await myOrder(req, id)))
})

// POST /orders/:id/tables/move — ย้ายโต๊ะ (1.11)
router.post('/:id/tables/move', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { from_table_id, to_table_id } = parse(moveSchema, req.body)
  await myOrder(req, id)
  await rpc('move_table', { p_order_id: id, p_from_table: from_table_id, p_to_table: to_table_id })
  send(res, await fullOrder(id))
})

// POST /orders/:id/tables/merge — รวมโต๊ะเป็นบิลเดียว (1.12) · ไม่มีแยกบิล (1.13)
router.post('/:id/tables/merge', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { table_ids } = parse(mergeSchema, req.body)
  await myOrder(req, id)
  await rpc('merge_tables', { p_order_id: id, p_table_ids: table_ids })
  send(res, await fullOrder(id))
})

// POST /orders/:id/tickets — สั่งอาหาร 1 รอบ → ข้อมูลพิมพ์ใบออร์เดอร์ (1.9, 1.10, 1.20)
// ลำดับ: ตรวจเมนูกับ catalog (ได้ snapshot ชื่อ/ราคา) → ตัดสต็อก (reference = id ตั๋ว) → บันทึกตั๋ว
// บันทึกตั๋วไม่สำเร็จ → คืนสต็อกด้วย reference เดิม · ส่ง Idempotency-Key ซ้ำ = ไม่สั่งซ้ำ ไม่ตัดสต็อกซ้ำ
router.post('/:id/tickets', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { items } = parse(ticketSchema, req.body)
  const order = await myOrder(req, id)
  if (order.status !== 'open') throw conflict('ORDER_NOT_OPEN', 'บิลนี้ไม่ได้เปิดอยู่ สั่งอาหารเพิ่มไม่ได้')

  // Idempotency-Key (uuid) ใช้ซ้ำได้เมื่อไม่รู้ผล (เน็ตหลุด) · ถ้าได้ error กลับมาแล้ว ให้สุ่ม key ใหม่
  // (key ที่ล้มเหลวถูกใช้ตัด/คืนสต็อกไปแล้ว catalog จะถือว่าตัดแล้ว)
  const key = req.get('idempotency-key')
  const ticketId = key && /^[0-9a-f-]{36}$/i.test(key) ? key : randomUUID()

  const looked = await lookupMenus(
    order.branch_id,
    items.map((i) => ({ menu_id: i.menu_id, quantity: i.quantity, option_ids: i.option_ids })),
  )
  // รวมจำนวนต่อเมนูก่อนตัดสต็อก (เมนูเดียวกันต่างตัวเลือกนับรวม)
  const perMenu = new Map()
  for (const i of items) perMenu.set(i.menu_id, (perMenu.get(i.menu_id) || 0) + i.quantity)
  await deductStocks(order.branch_id, ticketId, [...perMenu].map(([menu_id, quantity]) => ({ menu_id, quantity })))

  try {
    await rpc('add_ticket', {
      p_order_id: id,
      p_actor: req.user.id,
      p_ticket_id: ticketId,
      p_items: items.map((i, idx) => ({
        menu_id: i.menu_id,
        menu_name: looked[idx].name,
        unit_price: looked[idx].price, // ราคาเมนู (ก่อน VAT) · ราคาตัวเลือกเก็บแยกในแต่ละตัวเลือก
        quantity: i.quantity,
        note: i.note,
        options: looked[idx].options.map((o) => ({ option_id: o.option_id, option_name: o.name, extra_price: o.extra_price })),
      })),
    })
  } catch (err) {
    await restoreStocks(order.branch_id, ticketId)
    throw err
  }

  const full = await fullOrder(id)
  const ticket = full.tickets.find((t) => t.id === ticketId)
  send(res, { ...ticket, order_id: id, order_no: full.order_no, tables: full.tables, guest_count: full.guest_count }, { status: 201 })
})

// POST /orders/:id/request-payment — เรียกเก็บเงิน → รอชำระ (1.8, 1.24)
router.post('/:id/request-payment', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  await myOrder(req, id)
  await rpc('request_payment', { p_order_id: id })
  send(res, await fullOrder(id))
})

// POST /orders/:id/items/:itemId/cancel — ยกเลิกรายการหลังส่งครัว (บิลยังไม่จ่าย) { quantity, cooked, reason? }
// cooked = false (ยังไม่ได้ทำ) → คืนสต็อก · cooked = true (ทำแล้ว) → ไม่คืนสต็อก
// บันทึกการยกเลิกก่อน แล้วค่อยคืนสต็อก (reference = id การยกเลิก กันคืนซ้ำ) · คืนไม่สำเร็จ → stock_restore_failed
router.post('/:id/items/:itemId/cancel', allow('staff', 'manager'), async (req, res) => {
  const { id, itemId } = parse(itemParams, req.params)
  const { quantity, cooked, reason } = parse(cancelItemSchema, req.body)
  const order = await myOrder(req, id)
  const cancellation = await rpc('cancel_order_item', {
    p_order_id: id,
    p_item_id: itemId,
    p_quantity: quantity,
    p_cooked: cooked,
    p_reason: reason,
    p_actor: req.user.id,
  })
  let stockRestoreFailed = false
  if (!cooked) {
    const item = order.kitchen_tickets.flatMap((t) => t.order_items || []).find((i) => i.id === itemId)
    stockRestoreFailed = !(await restoreStockItems(order.branch_id, `cancel:${cancellation.id}`, [{ menu_id: item.menu_id, quantity }]))
  }
  send(res, { ...(await fullOrder(id)), stock_restore_failed: stockRestoreFailed })
})

// POST /orders/:id/cancel — ยกเลิกทั้งบิล: เปิดผิด (ยังไม่ได้สั่ง) หรือยกเลิกครบทุกรายการแล้ว → โต๊ะว่าง
router.post('/:id/cancel', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  await myOrder(req, id)
  await rpc('cancel_order', { p_order_id: id, p_actor: req.user.id })
  send(res, await fullOrder(id))
})

// POST /orders/:id/approvals — staff ขอส่วนลด (บิลยังไม่จ่าย) / คืนเงิน (บิลจ่ายแล้ว) → แจ้ง manager/owner (1.27–1.29)
router.post('/:id/approvals', allow('staff'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(approvalSchema, req.body)
  await myOrder(req, id)
  const created = await rpc('create_approval', {
    p_order_id: id,
    p_actor: req.user.id,
    p_type: body.type,
    p_value_type: body.value_type,
    p_value: body.value,
    p_reason: body.reason,
    p_refund_items: body.type === 'refund' && body.refund_items?.length ? body.refund_items : null,
  })
  const approval = await loadApproval(created.id)
  publishApproval(approval)
  send(res, approval, { status: 201 })
})

export default router
