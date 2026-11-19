// =====================================================================
// pos — โต๊ะ ออร์เดอร์ ตั๋วครัว (Dev 3)
// เส้นทางตาม เอกสาร/pos-crm-phase1-spec.md ข้อ "pos" (ผ่าน gateway /api/v1/pos)
//
// VITE_POS_MODE=mock → ใช้ข้อมูลจำลองใน posMock.js ระหว่างที่ service pos ยังไม่เสร็จ
//   (เมนูยังดึงจาก catalog ของ Dev 2 ตามจริง)
//
// รูปข้อมูลที่หน้าเว็บคาดหวัง
//   table: { id, table_no, seats, zone?, status: 'available'|'occupied'|'waiting_payment',
//            order?: { id, guest_count, opened_at, item_count, subtotal, total } }
//   order: { id, order_no, status, guest_count, opened_at, opened_by_name?, paid_at?, payment_method?,
//            tables: [{ id, table_no }], subtotal, discount_amount, vat_amount, total,
//            tickets: [{ id, round_no, status, created_at, created_by_name?,
//                        items: [{ id, menu_id, menu_name, quantity, unit_price, note,
//                                  options: [{ option_id, option_name, extra_price }] }] }] }
// =====================================================================

import { api } from './client'
import * as mock from './posMock'

export const POS_MOCK = import.meta.env.VITE_POS_MODE === 'mock'

const data = (promise) => promise.then((res) => res.data)

// ---------- โต๊ะ (1.7, 1.8) ----------
/** query: { branch_id? } — owner ส่ง branch_id เพื่อดูทีละสาขา (staff/manager ใช้สาขาตัวเองเสมอ) */
export const listTables = (query) => (POS_MOCK ? mock.listTables() : data(api.get('/pos/tables', { query })))

/** เพิ่มโต๊ะ (manager/owner) — body: { table_no, seats?, zone?, branch_id? } owner ต้องส่ง branch_id */
export const createTable = (body) => (POS_MOCK ? mock.createTable(body) : data(api.post('/pos/tables', { body })))

// ---------- ออร์เดอร์ ----------
/** เปิดโต๊ะ/เปิดบิล → order */
export const openOrder = ({ table_ids, guest_count }) =>
  POS_MOCK ? mock.openOrder({ table_ids, guest_count }) : data(api.post('/pos/orders', { body: { table_ids, guest_count } }))

export const getOrder = (id) => (POS_MOCK ? mock.getOrder(id) : data(api.get(`/pos/orders/${id}`)))

/** ย้ายโต๊ะ (1.11) — ปลายทางต้องเป็นโต๊ะว่าง */
export const moveTable = (orderId, { from_table_id, to_table_id }) =>
  POS_MOCK
    ? mock.moveTable(orderId, { from_table_id, to_table_id })
    : data(api.post(`/pos/orders/${orderId}/tables/move`, { body: { from_table_id, to_table_id } }))

/** รวมโต๊ะเป็นบิลเดียว (1.12) — table_ids = โต๊ะที่จะรวมเข้ามา */
export const mergeTables = (orderId, { table_ids }) =>
  POS_MOCK
    ? mock.mergeTables(orderId, { table_ids })
    : data(api.post(`/pos/orders/${orderId}/tables/merge`, { body: { table_ids } }))

/**
 * สั่งอาหาร 1 รอบ (1.9, 1.10) → ticket สำหรับพิมพ์ใบออร์เดอร์
 * items: [{ menu_id, quantity, note, options: [{ option_id, option_name, extra_price }], menu_name, unit_price }]
 * ส่งให้ backend เฉพาะ { menu_id, quantity, note, option_ids } — ชื่อ/ราคา backend snapshot เอง
 */
export function sendTicket(orderId, items) {
  if (POS_MOCK) return mock.sendTicket(orderId, items)
  const body = {
    items: items.map((it) => ({
      menu_id: it.menu_id,
      quantity: it.quantity,
      note: it.note || null,
      option_ids: (it.options || []).map((o) => o.option_id),
    })),
  }
  return data(api.post(`/pos/orders/${orderId}/tickets`, { body }))
}

// ---------- จอครัว ----------
/** ตั๋วของสาขาตัวเอง เก่าสุดก่อน · status: 'pending,preparing' (ค่าเริ่มต้น) หรือ 'served' */
export const listKitchenTickets = (status = 'pending,preparing') =>
  POS_MOCK ? mock.listKitchenTickets(status) : data(api.get('/pos/kitchen/tickets', { query: { status } }))

/** เปลี่ยนสถานะตั๋ว: pending → preparing → served (ย้อนกลับไม่ได้) */
export const updateKitchenTicket = (id, status) =>
  POS_MOCK ? mock.updateKitchenTicket(id, status) : data(api.patch(`/pos/kitchen/tickets/${id}`, { body: { status } }))

/** ปิดโต๊ะที่เปิดแล้วลูกค้าไม่ได้สั่ง → บิล cancelled โต๊ะกลับเป็นว่าง (ใช้ได้เฉพาะบิลที่ยังไม่มีรายการอาหาร) */
export const cancelOrder = (orderId) =>
  POS_MOCK ? mock.cancelOrder(orderId) : data(api.post(`/pos/orders/${orderId}/cancel`))

/** เรียกเก็บเงิน → waiting_payment (1.8, 1.24) */
export const requestPayment = (orderId) =>
  POS_MOCK ? mock.requestPayment(orderId) : data(api.post(`/pos/orders/${orderId}/request-payment`))

/** รายการบิล · query: { status?, date?, q? } (q = ค้นเลขบิล) */
export const listOrders = (query) => (POS_MOCK ? mock.listOrders(query) : data(api.get('/pos/orders', { query })))

// ---------- คำขอส่วนลด/คืนเงิน (1.27–1.31) ----------
/**
 * staff ส่งคำขอ → แจ้ง manager/owner · มีผลเมื่ออนุมัติแล้วเท่านั้น
 * ส่วนลด: { type: 'discount', value_type: 'amount'|'percent', value, reason } — บิลที่ยังไม่จ่าย
 * คืนเงิน: { type: 'refund', value_type: 'amount', value, reason, refund_items?: [{ order_item_id, quantity }] }
 *          — บิลที่จ่ายแล้ว · ไม่ส่ง refund_items = คืนทั้งบิล · คืนเงินไม่คืนสต็อก
 */
export const requestApproval = (orderId, body) =>
  POS_MOCK ? mock.requestApproval(orderId, body) : data(api.post(`/pos/orders/${orderId}/approvals`, { body }))

/** query: { status?, type?, order_id? } — staff เห็นเฉพาะคำขอของตัวเอง */
export const listApprovals = (query) => (POS_MOCK ? mock.listApprovals(query) : data(api.get('/pos/approvals', { query })))

/** manager/owner อนุมัติ/ปฏิเสธ (1.29, 1.31) · body: { note? } หมายเหตุถึงพนักงาน */
export const approveApproval = (id, body = {}) =>
  POS_MOCK ? mock.decideApproval(id, 'approved', body) : data(api.post(`/pos/approvals/${id}/approve`, { body }))
export const rejectApproval = (id, body = {}) =>
  POS_MOCK ? mock.decideApproval(id, 'rejected', body) : data(api.post(`/pos/approvals/${id}/reject`, { body }))

export const APPROVAL_TYPE = {
  discount: { label: 'ส่วนลด', cls: 'is-available' },
  refund: { label: 'คืนเงิน', cls: 'is-occupied' },
}

export const APPROVAL_STATUS = {
  pending: { label: 'รออนุมัติ', cls: 'is-occupied' },
  approved: { label: 'อนุมัติแล้ว', cls: 'is-available' },
  rejected: { label: 'ไม่อนุมัติ', cls: 'is-waiting' },
}

// ---------- ตัวช่วยคำนวณ ----------
/** ราคาต่อหน่วยรวมตัวเลือก */
export const unitWithOptions = (it) =>
  Number(it.unit_price || 0) + (it.options || []).reduce((s, o) => s + Number(o.extra_price || 0), 0)

/** ยอดของรายการ 1 แถว */
export const lineAmount = (it) => unitWithOptions(it) * Number(it.quantity || 0)

/** ยอดรวมของตั๋ว/ตะกร้า */
export const itemsAmount = (items) => (items || []).reduce((s, it) => s + lineAmount(it), 0)

/** รายการอาหารทั้งบิล (ทุกรอบ) */
export const orderItems = (order) => (order?.tickets || []).flatMap((t) => t.items || [])
