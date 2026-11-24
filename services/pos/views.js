// อ่านบิล/คำขอจากฐานข้อมูลแล้วจัดรูปให้หน้าเว็บและ payment ใช้
// รูปข้อมูลตรงกับ web/src/api/pos.js และ services/payment/pos.js
import { db, run } from './db.js'
import { notFound, round2 } from './helpers.js'
import { userNames } from './services.js'

const TABLES = 'order_tables(table_id, joined_at, left_at, dining_tables(table_no))'
export const ORDER_FULL = `*, ${TABLES}, kitchen_tickets(*, order_items(*, order_item_options(*), order_item_cancellations(*)))`
export const ORDER_SUMMARY = `*, ${TABLES}, order_items(quantity, cancelled_quantity)`

/** จำนวนที่ยังไม่ถูกยกเลิก */
export const activeQty = (oi) => oi.quantity - (oi.cancelled_quantity || 0)
export const APPROVAL_FULL = `*, orders(order_no, status, subtotal, discount_amount, total, ${TABLES}), refund_items(order_item_id, quantity, amount, order_items(menu_name))`

const num = (v) => (v == null ? null : Number(v))

/** โต๊ะที่บิลใช้อยู่ · บิลที่ปิดแล้วใช้ชุดโต๊ะสุดท้ายก่อนปิด */
export function currentTables(orderTables = []) {
  let rows = orderTables.filter((t) => !t.left_at)
  if (!rows.length && orderTables.length) {
    const last = orderTables.reduce((m, t) => (t.left_at > m ? t.left_at : m), '')
    rows = orderTables.filter((t) => t.left_at === last)
  }
  return rows
    .map((t) => ({ id: t.table_id, table_no: t.dining_tables?.table_no ?? null }))
    .sort((a, b) => String(a.table_no).localeCompare(String(b.table_no), 'th', { numeric: true }))
}

// quantity = จำนวนที่ยังไม่ถูกยกเลิก (ใช้คิดเงิน/ใบเสร็จ/คืนเงิน) · ordered_quantity = จำนวนที่สั่งตอนแรก
export function toItem(oi) {
  const options = (oi.order_item_options || []).map((o) => ({
    option_id: o.option_id,
    option_name: o.option_name,
    extra_price: num(o.extra_price),
  }))
  const unit = num(oi.unit_price) + options.reduce((s, o) => s + o.extra_price, 0)
  const quantity = activeQty(oi)
  return {
    id: oi.id,
    menu_id: oi.menu_id,
    menu_name: oi.menu_name,
    quantity,
    ordered_quantity: oi.quantity,
    cancelled_quantity: oi.cancelled_quantity || 0,
    cancellations: (oi.order_item_cancellations || [])
      .sort((a, b) => a.cancelled_at.localeCompare(b.cancelled_at))
      .map((c) => ({ id: c.id, quantity: c.quantity, cooked: c.cooked, reason: c.reason, cancelled_by: c.cancelled_by, cancelled_at: c.cancelled_at })),
    unit_price: num(oi.unit_price),
    note: oi.note,
    options,
    line_total: round2(unit * quantity),
  }
}

function money(o) {
  return {
    subtotal: num(o.subtotal),
    discount_amount: num(o.discount_amount),
    vat_amount: num(o.vat_amount),
    total: num(o.total),
    refunded_amount: num(o.refunded_amount),
  }
}

/** บิลเต็ม: โต๊ะ ตั๋วแต่ละรอบ รายการ + ชื่อพนักงาน */
export async function toOrder(row) {
  const tickets = [...(row.kitchen_tickets || [])].sort((a, b) => a.round_no - b.round_no)
  const names = await userNames([row.opened_by, row.closed_by, ...tickets.map((t) => t.created_by)])
  const paid = row.status === 'paid' || row.status === 'refunded'
  return {
    id: row.id,
    order_no: row.order_no,
    branch_id: row.branch_id,
    status: row.status,
    guest_count: row.guest_count,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    paid_at: paid ? row.closed_at : null,
    payment_method: row.payment_method,
    merged_into: row.merged_into,
    opened_by: row.opened_by,
    opened_by_name: names.get(row.opened_by),
    tables: currentTables(row.order_tables),
    ...money(row),
    tickets: tickets.map((t) => ({
      id: t.id,
      round_no: t.round_no,
      status: t.status,
      created_at: t.created_at,
      printed_at: t.printed_at,
      status_changed_at: t.status_changed_at,
      created_by: t.created_by,
      created_by_name: names.get(t.created_by),
      items: (t.order_items || []).sort((a, b) => a.created_at.localeCompare(b.created_at)).map(toItem),
    })),
  }
}

/** โหลดบิลเต็ม · ไม่มี → 404 */
export async function loadOrder(id) {
  const row = await run(db.from('orders').select(ORDER_FULL).eq('id', id).maybeSingle())
  if (!row) throw notFound('ไม่พบบิล', 'ORDER_NOT_FOUND')
  return row
}

/** แถวสรุปบิล (รายการบิล / ผังโต๊ะ) */
export function toOrderSummary(row) {
  const paid = row.status === 'paid' || row.status === 'refunded'
  return {
    id: row.id,
    order_no: row.order_no,
    branch_id: row.branch_id,
    status: row.status,
    guest_count: row.guest_count,
    opened_at: row.opened_at,
    closed_at: row.closed_at,
    paid_at: paid ? row.closed_at : null,
    payment_method: row.payment_method,
    tables: currentTables(row.order_tables),
    item_count: (row.order_items || []).reduce((s, i) => s + activeQty(i), 0),
    ...money(row),
  }
}

/** สรุปบิลสำหรับ payment (internal) — รายการแบน + table_no แบบข้อความ */
export function toPaymentSummary(order) {
  // ใบเสร็จ/คิดเงิน: ไม่แสดงรายการที่ยกเลิกหมดแล้ว
  const items = order.tickets.flatMap((t) => t.items).filter((i) => i.quantity > 0)
  return {
    id: order.id,
    order_no: order.order_no,
    branch_id: order.branch_id,
    status: order.status,
    guest_count: order.guest_count,
    opened_at: order.opened_at,
    paid_at: order.paid_at,
    tables: order.tables,
    table_no: order.tables.map((t) => t.table_no).join(', '),
    items,
    subtotal: order.subtotal,
    discount_amount: order.discount_amount,
    vat_amount: order.vat_amount,
    total: order.total,
    refunded_amount: order.refunded_amount,
  }
}

/** คำขอ + ข้อมูลบิล + ชื่อผู้ขอ/ผู้ตัดสิน (หน้าอนุมัติไม่ต้องเรียกบิลแยก) */
export async function toApprovals(rows) {
  const names = await userNames(rows.flatMap((a) => [a.requested_by, a.approved_by]))
  return rows.map((a) => ({
    id: a.id,
    request_no: a.request_no,
    order_id: a.order_id,
    order_no: a.orders?.order_no ?? null,
    order_status: a.orders?.status ?? null,
    branch_id: a.branch_id,
    type: a.type,
    value_type: a.value_type,
    value: num(a.value),
    amount: num(a.amount),
    reason: a.reason,
    note: a.note,
    status: a.status,
    requested_by: a.requested_by,
    requested_by_name: names.get(a.requested_by),
    approved_by: a.approved_by,
    approved_by_name: names.get(a.approved_by),
    requested_at: a.requested_at,
    decided_at: a.decided_at,
    refunded_at: a.refunded_at,
    tables: currentTables(a.orders?.order_tables),
    order_subtotal: num(a.orders?.subtotal),
    order_discount: num(a.orders?.discount_amount),
    order_total: num(a.orders?.total),
    refund_items: (a.refund_items || []).map((r) => ({
      order_item_id: r.order_item_id,
      quantity: r.quantity,
      amount: num(r.amount),
      menu_name: r.order_items?.menu_name ?? null,
    })),
  }))
}

export async function loadApproval(id) {
  const row = await run(db.from('approvals').select(APPROVAL_FULL).eq('id', id).maybeSingle())
  if (!row) throw notFound('ไม่พบคำขอ', 'APPROVAL_NOT_FOUND')
  return (await toApprovals([row]))[0]
}
