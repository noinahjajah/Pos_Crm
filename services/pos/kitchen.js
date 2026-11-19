// /kitchen — จอครัว: ตั๋วของสาขา และเปลี่ยนสถานะ pending → preparing → served
import { Router } from 'express'
import { db, run } from './db.js'
import { allow, badRequest, idParam, notFound, parse, send, z } from './helpers.js'
import { userNames } from './services.js'
import { currentTables, toItem } from './views.js'

const STATUSES = ['pending', 'preparing', 'served']
// ห้ามย้อนสถานะ (เสิร์ฟแล้วกลับไปทำใหม่ไม่ได้)
const NEXT = { pending: ['preparing', 'served'], preparing: ['served'], served: [] }

const listSchema = z.object({
  status: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',') : ['pending', 'preparing']))
    .pipe(z.array(z.enum(STATUSES))),
  limit: z.coerce.number().int().min(1).max(200).default(100),
})
const patchSchema = z.object({ status: z.enum(['preparing', 'served']) })

const TICKET = '*, order_items(*, order_item_options(*)), orders(order_no, guest_count, status, order_tables(table_id, joined_at, left_at, dining_tables(table_no)))'

async function toTickets(rows) {
  const names = await userNames(rows.map((t) => t.created_by))
  return rows.map((t) => ({
    id: t.id,
    order_id: t.order_id,
    order_no: t.orders?.order_no ?? null,
    guest_count: t.orders?.guest_count ?? null,
    tables: currentTables(t.orders?.order_tables),
    round_no: t.round_no,
    status: t.status,
    created_at: t.created_at,
    printed_at: t.printed_at,
    status_changed_at: t.status_changed_at,
    created_by_name: names.get(t.created_by),
    items: (t.order_items || []).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toItem),
  }))
}

const router = Router()

// GET /kitchen/tickets?status=pending,preparing — ตั๋วของสาขาตัวเอง เก่าสุดก่อน (ทำตามลำดับ)
router.get('/tickets', allow('staff', 'manager'), async (req, res) => {
  const q = parse(listSchema, req.query)
  const rows = await run(
    db.from('kitchen_tickets').select(TICKET).eq('branch_id', req.user.branchId).in('status', q.status).order('created_at').limit(q.limit),
  )
  send(res, await toTickets(rows), { meta: { total: rows.length } })
})

// PATCH /kitchen/tickets/:id { status } — เริ่มทำ / เสิร์ฟแล้ว
router.patch('/tickets/:id', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { status } = parse(patchSchema, req.body)
  const ticket = await run(db.from('kitchen_tickets').select('id, branch_id, status').eq('id', id).maybeSingle())
  if (!ticket || ticket.branch_id !== req.user.branchId) throw notFound('ไม่พบตั๋ว', 'TICKET_NOT_FOUND')
  if (ticket.status !== status && !NEXT[ticket.status].includes(status)) {
    throw badRequest(`เปลี่ยนจาก ${ticket.status} เป็น ${status} ไม่ได้`)
  }
  // เงื่อนไข status เดิมกันสองเครื่องกดพร้อมกันแล้วย้อนสถานะ
  const rows = await run(db.from('kitchen_tickets').update({ status }).eq('id', id).eq('status', ticket.status).select(TICKET))
  const fresh = rows[0] ?? (await run(db.from('kitchen_tickets').select(TICKET).eq('id', id).single()))
  send(res, (await toTickets([fresh]))[0])
})

export default router
