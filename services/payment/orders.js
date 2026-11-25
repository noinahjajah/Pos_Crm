// /orders — บิลที่หน้าคิดเงินใช้ (อ่านผ่าน pos.js จึงใช้ได้ทั้ง pos จริงและบิลจำลอง)
import { Router } from 'express'
import { db, run } from './db.js'
import { pos } from './pos.js'
import { allow, idParam, mustBeMyBranch, notFound, parse, send } from './helpers.js'

/** order_id → 'paid' | 'refunded' จากรายการเงินที่บันทึกไว้จริง */
export async function paymentStates(orderIds) {
  const states = new Map()
  if (!orderIds.length) return states
  const rows = await run(db.from('payments').select('order_id, type').in('order_id', orderIds))
  for (const r of rows) {
    if (r.type === 'refund') states.set(r.order_id, 'refunded')
    else if (!states.has(r.order_id)) states.set(r.order_id, 'paid')
  }
  return states
}

/** บิลจำลองหายเมื่อ service restart จึงยึดสถานะจากรายการเงินในฐานข้อมูล */
const withState = (order, states) =>
  order.status === 'waiting_payment' && states.has(order.id) ? { ...order, status: states.get(order.id) } : order

const router = Router()

// GET /orders — บิลรอชำระของสาขาตัวเอง
router.get('/', allow('staff', 'manager'), async (req, res) => {
  const orders = await pos.listWaitingOrders({ branchId: req.user.branchId })
  const states = await paymentStates(orders.map((o) => o.id))
  const waiting = orders.map((o) => withState(o, states)).filter((o) => o.status === 'waiting_payment')
  send(res, waiting, { meta: { total: waiting.length } })
})

// GET /orders/:id — รายละเอียดบิลสำหรับหน้าคิดเงิน
router.get('/:id', allow('staff', 'manager', 'owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const order = await pos.getOrder(id)
  if (!order) throw notFound('ไม่พบบิล', 'ORDER_NOT_FOUND')
  mustBeMyBranch(req, order.branch_id)
  send(res, withState(order, await paymentStates([id])))
})

export default router
