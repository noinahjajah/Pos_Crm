// /orders — เปิดโต๊ะ/บิล (1.7) ย้าย/รวมโต๊ะ (1.11–1.13) สั่งอาหารแต่ละรอบ (1.9, 1.10) เรียกเก็บเงิน (1.24)
import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { catalog } from './catalog.js'
import { db, run } from './db.js'
import { publish } from './events.js'
import {
  allow,
  branchFilter,
  branchForCreate,
  conflict,
  dateString,
  dayRangeIso,
  idParam,
  mustBeMyBranch,
  notFound,
  parse,
  round2,
  send,
  todayTh,
  uuid,
  z,
} from './helpers.js'

const ORDER_SELECT =
  '*, order_tables(table_id, left_at, dining_tables(id, table_no)), order_items(*, order_item_options(*)), kitchen_tickets(id, round_no, status, created_at), approvals(*)'

const num = (v) => (v == null ? v : Number(v))

/** โต๊ะของบิล: ที่ยังใช้อยู่ ถ้าบิลปิดแล้วใช้โต๊ะทั้งหมดที่เคยใช้ */
function tablesOf(row) {
  const links = row.order_tables ?? []
  const active = links.filter((l) => !l.left_at)
  const seen = new Map()
  for (const l of active.length ? active : links) if (l.dining_tables) seen.set(l.table_id, l.dining_tables)
  return [...seen.values()].map((t) => ({ id: t.id, table_no: t.table_no }))
}

/** บิลเต็มสำหรับหน้าเว็บ / ใบเสร็จ (ตัวเลขมาจากฐานข้อมูล ไม่คำนวณใหม่) */
export function toOrder(row) {
  const rounds = new Map((row.kitchen_tickets ?? []).map((t) => [t.id, t.round_no]))
  const tables = tablesOf(row)
  const items = (row.order_items ?? [])
    .map((i) => {
      const options = (i.order_item_options ?? []).map((o) => ({
        option_id: o.option_id,
        option_name: o.option_name,
        name: o.option_name,
        extra_price: num(o.extra_price),
      }))
      const extra = options.reduce((s, o) => s + o.extra_price, 0)
      return {
        id: i.id,
        ticket_id: i.ticket_id,
        round: rounds.get(i.ticket_id) ?? null,
        menu_id: i.menu_id,
        menu_name: i.menu_name,
        name: i.menu_name,
        quantity: i.quantity,
        unit_price: num(i.unit_price),
        note: i.note,
        options,
        line_total: round2((num(i.unit_price) + extra) * i.quantity),
        created_at: i.created_at,
      }
    })
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0) || a.created_at.localeCompare(b.created_at))
  return {
    id: row.id,
    order_no: row.order_no,
    branch_id: row.branch_id,
    status: row.status,
    guest_count: row.guest_count,
    customer_id: row.customer_id,
    opened_by: row.opened_by,
    closed_by: row.closed_by,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    paid_at: row.status === 'paid' || row.status === 'refunded' ? row.closed_at : null,
    subtotal: num(row.subtotal),
    discount_amount: num(row.discount_amount),
    vat_amount: num(row.vat_amount),
    total: num(row.total),
    tables,
    table_names: tables.map((t) => t.table_no),
    items,
    tickets: (row.kitchen_tickets ?? [])
      .map((t) => ({ id: t.id, round: t.round_no, status: t.status, created_at: t.created_at }))
      .sort((a, b) => a.round - b.round),
    approvals: (row.approvals ?? [])
      .map((a) => ({ ...a, value: num(a.value), amount: num(a.amount) }))
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at)),
  }
}

export async function loadOrder(id) {
  const row = await run(db.from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle())
  if (!row) throw notFound('ไม่พบบิล', 'ORDER_NOT_FOUND')
  return toOrder(row)
}

/** บิลของสาขาตัวเอง (owner ทุกสาขา) */
async function myOrder(req) {
  const { id } = parse(idParam, req.params)
  const order = await loadOrder(id)
  mustBeMyBranch(req, order.branch_id)
  return order
}

const openSchema = z.object({
  branch_id: uuid.optional(),
  table_ids: z.array(uuid).min(1, 'เลือกโต๊ะอย่างน้อย 1 โต๊ะ').max(20),
  guest_count: z.number({ error: 'ใส่จำนวนลูกค้า' }).int().min(1, 'อย่างน้อย 1 คน').max(200),
})
const moveSchema = z.object({ from_table_id: uuid, to_table_id: uuid })
const mergeSchema = z.object({ table_ids: z.array(uuid).min(1, 'เลือกโต๊ะอย่างน้อย 1 โต๊ะ').max(20) })
const ticketSchema = z.object({
  items: z
    .array(
      z.object({
        menu_id: uuid,
        quantity: z.number().int('ต้องเป็นจำนวนเต็ม').min(1, 'อย่างน้อย 1').max(99),
        note: z.string().trim().max(200).nullish(),
        option_ids: z.array(uuid).max(30).default([]),
      }),
    )
    .min(1, 'เลือกเมนูอย่างน้อย 1 รายการ')
    .max(50),
})

const router = Router()

// รายการบิล ?status=open,waiting_payment&date=YYYY-MM-DD (ค่าเริ่มต้น: วันนี้)
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  const q = parse(
    z.object({
      status: z.string().regex(/^[a-z_,]+$/).optional(),
      date: dateString.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(100),
    }),
    req.query,
  )
  const date = q.date ?? todayTh()
  const [start, end] = dayRangeIso(date, date)
  let query = db.from('orders').select(ORDER_SELECT).order('opened_at', { ascending: false }).limit(q.limit)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  const statuses = q.status?.split(',').filter(Boolean)
  // บิลที่ยังไม่ปิดแสดงเสมอแม้เปิดเมื่อวาน · บิลที่ปิดแล้วกรองตามวันที่
  if (statuses?.length && statuses.every((s) => s === 'open' || s === 'waiting_payment')) query = query.in('status', statuses)
  else {
    query = query.gte('opened_at', start).lt('opened_at', end)
    if (statuses?.length) query = query.in('status', statuses)
  }
  const rows = await run(query)
  send(res, rows.map(toOrder), { meta: { date } })
})

router.get('/:id', allow('staff', 'manager', 'owner'), async (req, res) => {
  send(res, await myOrder(req))
})

// เปิดโต๊ะ (1.7) → ได้บิลใหม่ โต๊ะเป็น "มีลูกค้า"
router.post('/', allow('staff', 'manager'), async (req, res) => {
  const body = parse(openSchema, req.body)
  const branchId = branchForCreate(req, body.branch_id)
  const order = await run(
    db.rpc('open_order', { p_branch: branchId, p_by: req.user.id, p_guest_count: body.guest_count, p_table_ids: [...new Set(body.table_ids)] }),
  )
  publish('table', { branch_id: branchId })
  send(res, await loadOrder(order.id), { status: 201 })
})

// ยกเลิกบิลที่ยังไม่ได้สั่งอาหาร (เปิดโต๊ะผิด)
router.post('/:id/cancel', allow('staff', 'manager'), async (req, res) => {
  const order = await myOrder(req)
  await run(db.rpc('cancel_empty_order', { p_order: order.id }))
  publish('table', { branch_id: order.branch_id })
  send(res, { id: order.id, cancelled: true })
})

// ย้ายโต๊ะ (1.11)
router.post('/:id/tables/move', allow('staff', 'manager'), async (req, res) => {
  const order = await myOrder(req)
  const body = parse(moveSchema, req.body)
  await run(db.rpc('move_table', { p_order: order.id, p_from: body.from_table_id, p_to: body.to_table_id }))
  publish('table', { branch_id: order.branch_id })
  send(res, await loadOrder(order.id))
})

// รวมโต๊ะ (1.12) — เพิ่มโต๊ะว่างเข้าบิลนี้ ไม่มีแยกบิล (1.13)
router.post('/:id/tables/merge', allow('staff', 'manager'), async (req, res) => {
  const order = await myOrder(req)
  const body = parse(mergeSchema, req.body)
  await run(db.rpc('merge_tables', { p_order: order.id, p_table_ids: [...new Set(body.table_ids)] }))
  publish('table', { branch_id: order.branch_id })
  send(res, await loadOrder(order.id))
})

// สั่งอาหาร 1 รอบ (1.9): ตรวจเมนูกับ catalog → ตัดสต็อก → บันทึก · บันทึกไม่สำเร็จคืนสต็อก
// ตอบข้อมูลใบออร์เดอร์เข้าครัว (1.10)
router.post('/:id/tickets', allow('staff', 'manager'), async (req, res) => {
  const order = await myOrder(req)
  if (order.status !== 'open') throw conflict('ORDER_NOT_OPEN', 'สั่งอาหารได้เฉพาะบิลที่ยังเปิดอยู่ (กดเรียกเก็บเงินแล้วสั่งเพิ่มไม่ได้)')
  const { items } = parse(ticketSchema, req.body)

  const looked = await catalog.lookup(
    order.branch_id,
    items.map((i) => ({ menu_id: i.menu_id, quantity: i.quantity, option_ids: i.option_ids })),
  )
  const ticketId = randomUUID()
  const qtyByMenu = new Map()
  for (const i of items) qtyByMenu.set(i.menu_id, (qtyByMenu.get(i.menu_id) ?? 0) + i.quantity)
  await catalog.deduct(
    order.branch_id,
    [...qtyByMenu].map(([menu_id, quantity]) => ({ menu_id, quantity })),
    ticketId,
  )

  const lines = items.map((i, idx) => {
    const m = looked.items[idx]
    return {
      menu_id: m.menu_id,
      menu_name: m.name,
      quantity: i.quantity,
      unit_price: m.price, // ราคาตัวเลือกเก็บแยกใน order_item_options
      note: i.note || null,
      options: m.options.map((o) => ({ option_id: o.option_id, option_name: o.name, extra_price: o.extra_price })),
    }
  })
  try {
    await run(db.rpc('place_ticket', { p_ticket_id: ticketId, p_order: order.id, p_by: req.user.id, p_items: lines }))
  } catch (err) {
    await catalog.restore(order.branch_id, ticketId).catch((e) => console.error('[pos] คืนสต็อกไม่สำเร็จ', ticketId, e.message))
    throw err
  }
  publish('ticket', { branch_id: order.branch_id, id: ticketId, status: 'pending' })
  publish('table', { branch_id: order.branch_id })

  const full = await loadOrder(order.id)
  const round = full.tickets.find((t) => t.id === ticketId)?.round
  send(
    res,
    {
      order: full,
      ticket: {
        id: ticketId,
        round,
        ticket_no: `${full.order_no}-${round}`,
        created_at: full.tickets.find((t) => t.id === ticketId)?.created_at,
        table_names: full.table_names,
        guest_count: full.guest_count,
        items: full.items.filter((i) => i.ticket_id === ticketId),
      },
    },
    { status: 201 },
  )
})

// เรียกเก็บเงิน (1.24): บิลเป็น "รอชำระ" คำนวณ VAT 7% แล้วไปหน้ารับเงิน
router.post('/:id/request-payment', allow('staff', 'manager'), async (req, res) => {
  const order = await myOrder(req)
  await run(db.rpc('request_payment', { p_order: order.id }))
  publish('table', { branch_id: order.branch_id })
  send(res, await loadOrder(order.id))
})

export default router
