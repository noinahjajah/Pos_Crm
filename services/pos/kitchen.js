// /kitchen — จอครัว (1.9, 1.10): ตั๋วแต่ละรอบของสาขา เปลี่ยนสถานะ รอทำ → กำลังทำ → เสิร์ฟแล้ว
import { Router } from 'express'
import { db, run } from './db.js'
import { openStream, publish } from './events.js'
import { allow, branchFilter, conflict, idParam, mustBeMyBranch, notFound, parse, send, z } from './helpers.js'

const SELECT = '*, orders(order_no, guest_count, order_tables(left_at, dining_tables(table_no))), order_items(*, order_item_options(*))'
const NEXT = { pending: ['preparing', 'served'], preparing: ['served'], served: [] }

function toTicket(row) {
  const links = row.orders?.order_tables ?? []
  const active = links.filter((l) => !l.left_at)
  const tables = [...new Set((active.length ? active : links).map((l) => l.dining_tables?.table_no).filter(Boolean))]
  return {
    id: row.id,
    order_id: row.order_id,
    branch_id: row.branch_id,
    round: row.round_no,
    ticket_no: `${row.orders?.order_no}-${row.round_no}`,
    order_no: row.orders?.order_no,
    status: row.status,
    created_at: row.created_at,
    guest_count: row.orders?.guest_count ?? null,
    table_names: tables,
    items: (row.order_items ?? []).map((i) => ({
      id: i.id,
      name: i.menu_name,
      quantity: i.quantity,
      note: i.note,
      options: (i.order_item_options ?? []).map((o) => ({ name: o.option_name })),
    })),
  }
}

const router = Router()

// ?status=pending,preparing (ค่าเริ่มต้น) หรือ served (ล่าสุด 50 ใบ)
router.get('/tickets', allow('staff', 'manager', 'owner'), async (req, res) => {
  const { status } = parse(z.object({ status: z.string().regex(/^[a-z,]+$/).default('pending,preparing') }), req.query)
  const statuses = status.split(',').filter((s) => s in NEXT)
  let query = db.from('kitchen_tickets').select(SELECT).in('status', statuses)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  query = statuses.includes('served') ? query.order('created_at', { ascending: false }).limit(50) : query.order('created_at')
  send(res, (await run(query)).map(toTicket))
})

router.patch('/tickets/:id', allow('staff', 'manager'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const { status } = parse(z.object({ status: z.enum(['preparing', 'served'], { message: 'status ต้องเป็น preparing หรือ served' }) }), req.body)
  const current = await run(db.from('kitchen_tickets').select('*').eq('id', id).maybeSingle())
  if (!current) throw notFound('ไม่พบใบสั่งอาหาร', 'TICKET_NOT_FOUND')
  mustBeMyBranch(req, current.branch_id)
  if (current.status !== status && !NEXT[current.status].includes(status)) {
    throw conflict('INVALID_STATUS', 'เปลี่ยนสถานะย้อนกลับไม่ได้')
  }
  const row = await run(db.from('kitchen_tickets').update({ status }).eq('id', id).select(SELECT).single())
  publish('ticket', { branch_id: row.branch_id, id: row.id, status: row.status })
  send(res, toTicket(row))
})

// SSE: แจ้งเมื่อมีตั๋วใหม่หรือสถานะเปลี่ยน (สาขาตัวเอง)
router.get('/stream', allow('staff', 'manager', 'owner'), (req, res) => {
  const branchId = branchFilter(req)
  openStream(req, res, (e) => (e.type === 'ticket' || e.type === 'table') && (!branchId || e.branch_id === branchId))
})

export default router
