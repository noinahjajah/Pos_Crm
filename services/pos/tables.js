// /tables — ผังโต๊ะของสาขาพร้อมสถานะ (1.8) · manager/owner เพิ่ม/แก้โต๊ะ
import { Router } from 'express'
import { db, run } from './db.js'
import { publish } from './events.js'
import { allow, atLeastOne, branchFilter, branchForCreate, conflict, idParam, mustBeMyBranch, notFound, parse, send, uuid, z } from './helpers.js'

const tableNo = z.string().trim().min(1, 'ใส่เลขโต๊ะ').max(20)
const seats = z.number({ error: 'ใส่จำนวนที่นั่ง' }).int().min(1, 'อย่างน้อย 1').max(50)
const createSchema = z.object({ branch_id: uuid.optional(), table_no: tableNo, seats: seats.default(4) })
const updateSchema = z.object({ table_no: tableNo.optional(), seats: seats.optional(), is_active: z.boolean().optional() }).refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

/** โต๊ะ + บิลที่ใช้โต๊ะอยู่ (ถ้ามี) */
const SELECT = '*, order_tables(left_at, orders(id, order_no, status, guest_count, total, opened_at))'

function toTable(row) {
  const link = (row.order_tables ?? []).find((l) => !l.left_at)
  const o = link?.orders
  return {
    id: row.id,
    branch_id: row.branch_id,
    table_no: row.table_no,
    seats: row.seats,
    status: row.status,
    is_active: row.is_active,
    order: o ? { id: o.id, order_no: o.order_no, status: o.status, guest_count: o.guest_count, total: Number(o.total), opened_at: o.opened_at } : null,
  }
}

// เรียงเลขโต๊ะแบบคน (A2 ก่อน A10)
const byNo = (a, b) => a.table_no.localeCompare(b.table_no, 'th', { numeric: true })

const router = Router()

router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  let query = db.from('dining_tables').select(SELECT).is('order_tables.left_at', null)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (req.query.include_inactive !== 'true') query = query.eq('is_active', true)
  const rows = await run(query)
  send(res, rows.map(toTable).sort(byNo))
})

router.post('/', allow('manager', 'owner'), async (req, res) => {
  const body = parse(createSchema, req.body)
  const row = await run(
    db.from('dining_tables').insert({ branch_id: branchForCreate(req, body.branch_id), table_no: body.table_no, seats: body.seats }).select(SELECT).single(),
  )
  publish('table', { branch_id: row.branch_id })
  send(res, toTable(row), { status: 201 })
})

// แก้เลขโต๊ะ/ที่นั่ง หรือปิดโต๊ะ (is_active=false) · ปิดได้เฉพาะโต๊ะที่ว่าง
router.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const current = await run(db.from('dining_tables').select('*').eq('id', id).maybeSingle())
  if (!current) throw notFound('ไม่พบโต๊ะ', 'TABLE_NOT_FOUND')
  mustBeMyBranch(req, current.branch_id)
  if (body.is_active === false && current.status !== 'available') throw conflict('TABLE_IN_USE', 'โต๊ะนี้มีลูกค้าอยู่ ปิดโต๊ะไม่ได้')
  const row = await run(db.from('dining_tables').update(body).eq('id', id).select(SELECT).single())
  publish('table', { branch_id: row.branch_id })
  send(res, toTable(row))
})

export default router
