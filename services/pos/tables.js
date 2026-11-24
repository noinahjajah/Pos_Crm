// /tables — โต๊ะของสาขาพร้อมสถานะ (1.7, 1.8)
import { Router } from 'express'
import { db, run } from './db.js'
import { allow, atLeastOne, badRequest, branchFilter, conflict, idParam, mustBeMyBranch, notFound, parse, send, uuid, z } from './helpers.js'
import { branchForWrite } from './services.js'
import { activeQty } from './views.js'

const tableNo = z.string().trim().min(1, 'กรุณากรอกชื่อโต๊ะ').max(20)
const seats = z.number().int().min(1).max(50)
const zone = z.string().trim().max(50).nullish().transform((v) => v || null)

const createSchema = z.object({ branch_id: uuid.optional(), table_no: tableNo, seats: seats.default(4), zone })
const updateSchema = z
  .object({ table_no: tableNo.optional(), seats: seats.optional(), zone: zone.optional(), is_active: z.boolean().optional() })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

/** โต๊ะ + บิลที่ใช้อยู่ (ถ้ามี) */
function toTable(row) {
  const active = (row.order_tables || []).find((ot) => !ot.left_at && ot.orders)
  const o = active?.orders
  return {
    id: row.id,
    branch_id: row.branch_id,
    table_no: row.table_no,
    seats: row.seats,
    zone: row.zone,
    status: row.status,
    is_active: row.is_active,
    order: o
      ? {
          id: o.id,
          order_no: o.order_no,
          guest_count: o.guest_count,
          opened_at: o.opened_at,
          status: o.status,
          item_count: (o.order_items || []).reduce((s, i) => s + activeQty(i), 0),
          subtotal: Number(o.subtotal),
          total: Number(o.total),
        }
      : null,
  }
}

const TABLE_WITH_ORDER = '*, order_tables(left_at, orders(id, order_no, guest_count, opened_at, status, subtotal, total, order_items(quantity, cancelled_quantity)))'

const router = Router()

// GET /tables — owner ไม่ส่ง branch_id = ทุกสาขา · manager/owner ส่ง ?include_inactive=true ดูโต๊ะที่ปิดด้วย
router.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  let query = db.from('dining_tables').select(TABLE_WITH_ORDER).is('order_tables.left_at', null)
  const branchId = branchFilter(req)
  if (branchId) query = query.eq('branch_id', branchId)
  if (!(req.user.role !== 'staff' && req.query.include_inactive === 'true')) query = query.eq('is_active', true)

  const raw = await run(query)
  // โซนเรียงตามลำดับที่สร้าง (โต๊ะแรกของโซน) · ในโซนเรียงเลขโต๊ะแบบธรรมชาติ (T2 ก่อน T10)
  const zoneFirst = new Map()
  for (const t of raw) {
    const z = t.zone || ''
    if (!zoneFirst.has(z) || t.created_at < zoneFirst.get(z)) zoneFirst.set(z, t.created_at)
  }
  const rows = raw.map(toTable)
  rows.sort(
    (a, b) =>
      zoneFirst.get(a.zone || '').localeCompare(zoneFirst.get(b.zone || '')) ||
      a.table_no.localeCompare(b.table_no, 'th', { numeric: true }),
  )
  send(res, rows, { meta: { total: rows.length } })
})

// POST /tables — เพิ่มโต๊ะ (owner ต้องส่ง branch_id)
router.post('/', allow('manager', 'owner'), async (req, res) => {
  const { branch_id, ...body } = parse(createSchema, req.body)
  const branchId = await branchForWrite(req, branch_id)
  const row = await run(db.from('dining_tables').insert({ ...body, branch_id: branchId }).select().single()).catch((err) => {
    throw err.code === 'DUPLICATE' ? conflict('TABLE_NO_DUPLICATE', `โต๊ะ ${body.table_no} มีอยู่แล้วในสาขานี้`) : err
  })
  send(res, toTable(row), { status: 201 })
})

// PATCH /tables/:id — แก้ชื่อ/ที่นั่ง/โซน หรือปิดใช้ (โต๊ะที่มีลูกค้าปิดไม่ได้)
router.patch('/:id', allow('manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const table = await run(db.from('dining_tables').select('*').eq('id', id).maybeSingle())
  if (!table) throw notFound('ไม่พบโต๊ะ', 'TABLE_NOT_FOUND')
  mustBeMyBranch(req, table.branch_id)
  if (body.is_active === false && table.status !== 'available') throw badRequest('โต๊ะที่มีลูกค้าอยู่ปิดใช้ไม่ได้')

  const row = await run(db.from('dining_tables').update(body).eq('id', id).select(TABLE_WITH_ORDER).is('order_tables.left_at', null).single()).catch(
    (err) => {
      throw err.code === 'DUPLICATE' ? conflict('TABLE_NO_DUPLICATE', 'ชื่อโต๊ะซ้ำกับโต๊ะอื่นในสาขานี้') : err
    },
  )
  send(res, toTable(row))
})

export default router
