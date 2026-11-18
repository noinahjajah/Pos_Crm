// ข้อมูลจำลองของ pos (Dev 3) — ใช้เมื่อ VITE_POS_MODE=mock ระหว่างที่ service pos ยังไม่เสร็จ
// เก็บใน localStorage ใช้ร่วมกันทุกแท็บ: เปิดแท็บ staff กับแท็บผู้จัดการคู่กันเพื่อทดสอบแจ้งเตือนอนุมัติได้
// ล้างข้อมูลจำลอง: localStorage.removeItem('pos.mock.v3') แล้วรีเฟรช
// พฤติกรรมเลียนแบบ API จริง: โยน ApiError เมื่อสถานะไม่ถูกต้อง

import { ApiError } from './client'

const KEY = 'pos.mock.v3'
const VAT_RATE = 0.07

/** ชื่อเหตุการณ์บน window เมื่อคำขออนุมัติเปลี่ยน (approvalFeed.js ฟังอยู่) — detail = approval */
export const MOCK_EVENT = 'pos-mock-approval'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** หน่วงเหมือนเรียกผ่านเน็ต แล้วอ่านข้อมูลล่าสุด (แท็บอื่นอาจแก้ไปแล้ว) */
const wait = async (ms = 150) => {
  await sleep(ms)
  store = load()
}
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
const minutesAgo = (m) => new Date(Date.now() - m * 60_000).toISOString()
const clone = (v) => JSON.parse(JSON.stringify(v))

const conflict = (message) => new ApiError({ status: 409, code: 'CONFLICT', message })
const notFound = (message) => new ApiError({ status: 404, code: 'NOT_FOUND', message })

// ---------- ข้อมูลตั้งต้น (ตรงกับตัวอย่างใน Figma) ----------
const item = (menu_name, quantity, unit_price, extra = {}) => ({
  id: uid(),
  menu_id: null,
  menu_name,
  quantity,
  unit_price,
  note: extra.note || '',
  options: extra.options || [],
})

function seed() {
  const tables = [
    ...[4, 2, 4, 4, 4, 4, 6, 2, 4, 6, 4, 4].map((seats, i) => ({ id: uid(), table_no: `T${i + 1}`, seats, zone: 'โซนในร้าน' })),
    ...[4, 4, 2, 2].map((seats, i) => ({ id: uid(), table_no: `O${i + 1}`, seats, zone: 'โซนด้านนอก' })),
  ]
  const byNo = Object.fromEntries(tables.map((t) => [t.table_no, t.id]))
  const orders = []
  let seq = 1

  const add = (tableNos, guest_count, openedMin, status, items) => {
    const id = uid()
    orders.push({
      id,
      order_no: `B${String(seq++).padStart(4, '0')}`,
      status,
      guest_count,
      opened_at: minutesAgo(openedMin),
      opened_by_name: 'มานี',
      table_ids: tableNos.map((n) => byNo[n]),
      discount_amount: 0,
      tickets: [{ id: uid(), round_no: 1, status: 'preparing', created_at: minutesAgo(openedMin - 3), created_by_name: 'มานี', items }],
    })
  }

  add(['T2'], 2, 75, 'waiting_payment', [item('ข้าวผัดกุ้ง', 2, 80), item('ต้มยำกุ้งน้ำข้น', 1, 150), item('ชาไทยเย็น', 2, 45), item('ไข่เจียวหมูสับ', 1, 50)])
  add(['T4'], 4, 50, 'open', [item('ต้มยำกุ้งน้ำข้น', 2, 150), item('ข้าวผัดกุ้ง', 4, 80), item('ชาไทยเย็น', 4, 45), item('ผัดซีอิ๊วหมู', 2, 65)])
  add(['T5'], 3, 25, 'open', [
    item('ต้มยำกุ้งน้ำข้น', 1, 150),
    item('ข้าวผัดกุ้ง', 2, 80),
    item('ชาไทยเย็น', 3, 45, { note: 'หวานน้อย' }),
  ])
  add(['T6'], 4, 17, 'open', [item('ต้มยำกุ้งน้ำข้น', 2, 150), item('ข้าวผัดกุ้ง', 4, 80), item('ทับทิมกรอบ', 4, 45)])
  add(['T9'], 2, 6, 'open', [item('ผัดซีอิ๊วหมู', 2, 65), item('ต้มยำกุ้งน้ำข้น', 1, 150), item('ชาไทยเย็น', 2, 45), item('ทับทิมกรอบ', 1, 45)])
  add(['T10'], 5, 90, 'waiting_payment', [item('ต้มยำกุ้งน้ำข้น', 4, 150), item('ข้าวผัดกุ้ง', 8, 80), item('ชาไทยเย็น', 8, 45), item('ทับทิมกรอบ', 4, 45)])
  add(['T12'], 2, 1, 'open', [item('ข้าวผัดกุ้ง', 1, 80), item('น้ำมะนาวโซดา', 2, 40)])

  // บิลที่จ่ายแล้ววันนี้ (ใช้ทดสอบหน้าขอคืนเงิน) — โต๊ะว่างแล้ว แต่บิลยังจำโต๊ะเดิมไว้
  const paid = (tableNo, openedMin, method, items) => {
    add([tableNo], 2, openedMin, 'paid', items)
    const o = orders[orders.length - 1]
    o.paid_at = minutesAgo(openedMin - 40)
    o.payment_method = method
  }
  paid('T1', 150, 'cash', [item('ข้าวผัดกุ้ง', 1, 80), item('น้ำมะนาวโซดา', 2, 40), item('ผัดซีอิ๊วหมู', 2, 65), item('ทับทิมกรอบ', 2, 45)])
  paid('O2', 130, 'promptpay', [item('ต้มยำกุ้งน้ำข้น', 2, 150), item('ข้าวผัดกุ้ง', 3, 80), item('ชาไทยเย็น', 2, 45)])
  paid('T7', 110, 'cash', [item('ต้มยำกุ้งน้ำข้น', 3, 150), item('ข้าวผัดกุ้ง', 4, 80), item('ชาไทยเย็น', 4, 45), item('ไข่เจียวหมูสับ', 1, 70)])
  paid('T4', 95, 'cash', [item('ข้าวผัดกุ้ง', 2, 80), item('ชาไทยเย็น', 2, 45), item('ทับทิมกรอบ', 1, 45)])

  return { tables, orders, seq, approvals: [] }
}

// ---------- เก็บ/อ่าน ----------
// โหลดตอนเรียกใช้ครั้งแรก (ผ่าน wait) — ไฟล์นี้ถูก import เสมอ แต่ไม่ควรเขียน localStorage ถ้าไม่ได้ใช้โหมดจำลอง
let store = null

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY))
    if (saved?.tables) return saved
  } catch {
    /* อ่านไม่ได้ → เริ่มใหม่ */
  }
  // ยังไม่มีข้อมูล → สร้างชุดตั้งต้นแล้วเก็บทันที ให้ทุกแท็บใช้ชุดเดียวกัน
  const fresh = store ?? seed()
  try {
    localStorage.setItem(KEY, JSON.stringify(fresh))
  } catch {
    /* เก็บไม่ได้ ใช้ในหน่วยความจำต่อ */
  }
  return fresh
}
function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store))
  } catch {
    /* เก็บไม่ได้ ใช้ในหน่วยความจำต่อ */
  }
}

const notifyApproval = (approval) => window.dispatchEvent(new CustomEvent(MOCK_EVENT, { detail: clone(approval) }))

// แท็บอื่นแก้ข้อมูล → แจ้งคำขอที่ใหม่หรือเปลี่ยนสถานะในแท็บนี้ด้วย (จำลอง realtime ข้ามเครื่อง)
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY || !e.newValue || !store) return
    let next
    try {
      next = JSON.parse(e.newValue)
    } catch {
      return
    }
    const before = new Map((store?.approvals || []).map((a) => [a.id, a.status]))
    store = next
    for (const a of next.approvals || []) if (before.get(a.id) !== a.status) notifyApproval(a)
  })
}

// ---------- คำนวณ ----------
const lineAmount = (it) => (Number(it.unit_price) + (it.options || []).reduce((s, o) => s + Number(o.extra_price || 0), 0)) * it.quantity
const allItems = (order) => order.tickets.flatMap((t) => t.items)

function totals(order) {
  const subtotal = allItems(order).reduce((s, it) => s + lineAmount(it), 0)
  const discount = Number(order.discount_amount || 0)
  const vat = Math.round((subtotal - discount) * VAT_RATE * 100) / 100
  return { subtotal, discount_amount: discount, vat_amount: vat, total: subtotal - discount + vat }
}

const activeOrders = () => store.orders.filter((o) => o.status === 'open' || o.status === 'waiting_payment')
const orderOfTable = (tableId) => activeOrders().find((o) => o.table_ids.includes(tableId))

function findOrder(id) {
  const order = store.orders.find((o) => o.id === id)
  if (!order) throw notFound('ไม่พบบิล')
  return order
}
function mustBeOpen(order) {
  if (order.status !== 'open') throw conflict('บิลนี้ไม่ได้อยู่ในสถานะเปิด')
}

function toOrder(order) {
  const { table_ids, ...rest } = order
  return clone({
    ...rest,
    ...totals(order),
    tables: table_ids.map((id) => {
      const t = store.tables.find((x) => x.id === id)
      return { id, table_no: t?.table_no }
    }),
  })
}

// ---------- API จำลอง ----------
export async function listTables() {
  await wait()
  return clone(
    store.tables.map((t) => {
      const order = orderOfTable(t.id)
      if (!order) return { ...t, status: 'available', order: null }
      return {
        ...t,
        status: order.status === 'waiting_payment' ? 'waiting_payment' : 'occupied',
        order: {
          id: order.id,
          guest_count: order.guest_count,
          opened_at: order.opened_at,
          item_count: allItems(order).reduce((s, it) => s + it.quantity, 0),
          ...totals(order),
        },
      }
    }),
  )
}

export async function openOrder({ table_ids, guest_count }) {
  await wait()
  for (const id of table_ids) {
    if (!store.tables.some((t) => t.id === id)) throw notFound('ไม่พบโต๊ะ')
    if (orderOfTable(id)) throw conflict('โต๊ะนี้มีลูกค้าอยู่แล้ว')
  }
  const order = {
    id: uid(),
    order_no: `B${String(store.seq++).padStart(4, '0')}`,
    status: 'open',
    guest_count,
    opened_at: new Date().toISOString(),
    opened_by_name: 'ผู้ใช้ทดสอบ',
    table_ids: [...table_ids],
    discount_amount: 0,
    tickets: [],
  }
  store.orders.push(order)
  save()
  return toOrder(order)
}

export async function getOrder(id) {
  await wait()
  return toOrder(findOrder(id))
}

export async function moveTable(orderId, { from_table_id, to_table_id }) {
  await wait()
  const order = findOrder(orderId)
  mustBeOpen(order)
  if (!order.table_ids.includes(from_table_id)) throw conflict('โต๊ะต้นทางไม่ได้อยู่ในบิลนี้')
  if (orderOfTable(to_table_id)) throw conflict('ย้ายได้เฉพาะไปโต๊ะว่าง')
  order.table_ids = order.table_ids.map((id) => (id === from_table_id ? to_table_id : id))
  save()
  return toOrder(order)
}

export async function mergeTables(orderId, { table_ids }) {
  await wait()
  const order = findOrder(orderId)
  mustBeOpen(order)
  for (const tableId of table_ids) {
    if (order.table_ids.includes(tableId)) continue
    const other = orderOfTable(tableId)
    if (other) {
      mustBeOpen(other)
      // รวมบิล: ย้ายตั๋ว โต๊ะ และจำนวนลูกค้าเข้าบิลหลัก · นับเวลาจากบิลที่เปิดก่อน
      let round = order.tickets.length
      const moved = other.tickets.map((t) => ({ ...t, round_no: ++round }))
      order.tickets.push(...moved)
      order.table_ids.push(...other.table_ids.filter((id) => !order.table_ids.includes(id)))
      order.guest_count += other.guest_count
      if (other.opened_at < order.opened_at) order.opened_at = other.opened_at
      other.status = 'merged'
      other.table_ids = []
    } else {
      order.table_ids.push(tableId)
    }
  }
  save()
  return toOrder(order)
}

export async function sendTicket(orderId, items) {
  await wait(250)
  const order = findOrder(orderId)
  mustBeOpen(order)
  if (!items?.length) throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: 'ยังไม่มีรายการอาหาร' })
  const ticket = {
    id: uid(),
    round_no: order.tickets.length + 1,
    status: 'pending',
    created_at: new Date().toISOString(),
    printed_at: new Date().toISOString(),
    created_by_name: order.opened_by_name,
    items: items.map((it) => ({
      id: uid(),
      menu_id: it.menu_id,
      menu_name: it.menu_name,
      quantity: it.quantity,
      unit_price: Number(it.unit_price),
      note: it.note || '',
      options: (it.options || []).map((o) => ({ option_id: o.option_id, option_name: o.option_name, extra_price: Number(o.extra_price || 0) })),
    })),
  }
  order.tickets.push(ticket)
  save()
  const full = toOrder(order)
  return { ...clone(ticket), order_no: full.order_no, tables: full.tables, guest_count: full.guest_count }
}

export async function listOrders({ status, q } = {}) {
  await wait()
  const term = (q || '').trim().toLowerCase()
  return store.orders
    .filter((o) => o.status !== 'merged')
    .filter((o) => !status || o.status === status)
    .filter((o) => !term || o.order_no.toLowerCase().includes(term))
    .sort((a, b) => (b.paid_at || b.opened_at).localeCompare(a.paid_at || a.opened_at))
    .map((o) => {
      const { tickets, ...rest } = toOrder(o)
      return { ...rest, item_count: tickets.flatMap((t) => t.items).reduce((s, it) => s + it.quantity, 0) }
    })
}

export async function requestApproval(orderId, body) {
  await wait()
  const order = findOrder(orderId)
  const reason = (body.reason || '').trim()
  if (!reason) throw new ApiError({ status: 400, code: 'VALIDATION_ERROR', message: 'กรุณาระบุเหตุผล' })
  if (body.type === 'discount' && !['open', 'waiting_payment'].includes(order.status)) throw conflict('ขอส่วนลดได้เฉพาะบิลที่ยังไม่จ่าย')
  if (body.type === 'refund' && order.status !== 'paid') throw conflict('ขอคืนเงินได้เฉพาะบิลที่จ่ายแล้ว')
  if (store.approvals.some((a) => a.order_id === orderId && a.type === body.type && a.status === 'pending')) {
    throw conflict(`บิลนี้มีคำขอ${body.type === 'discount' ? 'ส่วนลด' : 'คืนเงิน'}ที่รออนุมัติอยู่แล้ว`)
  }
  const { subtotal, total } = totals(order)
  const value = Number(body.value)
  const amount =
    body.type === 'discount'
      ? body.value_type === 'percent'
        ? Math.round(subtotal * value) / 100
        : value
      : Math.min(value, total)
  const itemsById = new Map(allItems(order).map((it) => [it.id, it]))
  const approval = {
    id: uid(),
    request_no: `RQ-${String(store.approvals.length + 1).padStart(4, '0')}`,
    order_id: orderId,
    order_no: order.order_no,
    type: body.type,
    value_type: body.value_type,
    value,
    amount,
    reason,
    refund_items: body.refund_items
      ? body.refund_items.map((r) => ({ ...r, menu_name: itemsById.get(r.order_item_id)?.menu_name || 'รายการ' }))
      : null,
    status: 'pending',
    requested_by_name: 'พนักงานทดสอบ',
    requested_at: new Date().toISOString(),
    approved_by_name: null,
    decided_at: null,
    note: null,
  }
  store.approvals.push(approval)
  save()
  notifyApproval(withOrderInfo(approval))
  return clone(withOrderInfo(approval))
}

/** แนบโต๊ะ/ยอดบิลให้คำขอ (backend จริงควรส่งมาด้วย เพื่อให้หน้าอนุมัติไม่ต้องเรียกบิลแยก) */
function withOrderInfo(a) {
  const order = store.orders.find((o) => o.id === a.order_id)
  if (!order) return a
  const t = totals(order)
  return {
    ...a,
    tables: order.table_ids.map((id) => ({ id, table_no: store.tables.find((x) => x.id === id)?.table_no })),
    order_subtotal: t.subtotal,
    order_discount: t.discount_amount,
    order_total: t.total,
  }
}

export async function listApprovals({ status, type, order_id } = {}) {
  await wait()
  return clone(
    store.approvals
      .filter((a) => (!status || a.status === status) && (!type || a.type === type) && (!order_id || a.order_id === order_id))
      .sort((a, b) => b.requested_at.localeCompare(a.requested_at))
      .map(withOrderInfo),
  )
}

/** อนุมัติ/ปฏิเสธ (manager/owner) · ส่วนลดที่อนุมัติ → เพิ่มเข้า discount_amount ของบิล (1.30) */
export async function decideApproval(id, status, { note } = {}) {
  await wait()
  const a = store.approvals.find((x) => x.id === id)
  if (!a) throw notFound('ไม่พบคำขอ')
  if (a.status !== 'pending') throw conflict('คำขอนี้ถูกตัดสินไปแล้ว')
  if (status === 'approved' && a.type === 'discount') {
    const order = findOrder(a.order_id)
    if (!['open', 'waiting_payment'].includes(order.status)) throw conflict('บิลนี้ชำระเงินแล้ว ใช้ส่วนลดไม่ได้')
    const { subtotal } = totals(order)
    if (Number(order.discount_amount || 0) + a.amount > subtotal) throw conflict('ส่วนลดรวมเกินยอดบิล')
    order.discount_amount = Number(order.discount_amount || 0) + a.amount
  }
  a.status = status
  a.approved_by_name = 'ผู้จัดการทดสอบ'
  a.decided_at = new Date().toISOString()
  a.note = (note || '').trim() || null
  save()
  notifyApproval(withOrderInfo(a))
  return clone(withOrderInfo(a))
}

export async function requestPayment(orderId) {
  await wait()
  const order = findOrder(orderId)
  mustBeOpen(order)
  if (!order.tickets.length) throw conflict('ยังไม่มีรายการอาหาร เรียกเก็บเงินไม่ได้')
  order.status = 'waiting_payment'
  save()
  return toOrder(order)
}
