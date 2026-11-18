// payment — รับเงิน คืนเงิน รายจ่าย รายงาน (Dev 2)
// owner ส่ง branch_id ใน query เพื่อดูทีละสาขา · staff/manager ระบบใช้สาขาของตัวเองเสมอ

import { api } from './client'

const data = (promise) => promise.then((res) => res.data)

// ---------- บิลสำหรับหน้าคิดเงิน ----------
export const listWaitingOrders = () => data(api.get('/payment/orders'))
export const getOrder = (id) => data(api.get(`/payment/orders/${id}`))

// ---------- รับเงิน (1.23, 1.25) ----------
// body: { order_id, method: 'cash' | 'promptpay', cash_received? }
// idempotencyKey: สุ่มครั้งเดียวต่อการจ่าย 1 ครั้ง กดซ้ำด้วย key เดิม = ไม่รับเงินซ้ำ
export const createPayment = (body, idempotencyKey) =>
  data(api.post('/payment/payments', { body, headers: { 'Idempotency-Key': idempotencyKey } }))

// ---------- คืนเงินหลังอนุมัติ (1.28, 1.30) ----------
// body: { approval_id, method }
export const createRefund = (body, idempotencyKey) =>
  data(api.post('/payment/refunds', { body, headers: idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {} }))

export const listApprovedRefunds = () => data(api.get('/payment/refunds/approved'))

// รายการรับ/คืนเงิน · query: { date? | from?, to?, type?, method?, page?, limit?, branch_id? } → { data, meta }
export const listPayments = (query) => api.get('/payment/payments', { query })

// ---------- รายจ่าย (1.32, 1.33) ----------
// query: { from?, to?, category?, page?, limit?, branch_id? } → { data, meta: { total, sum, from, to } }
export const listExpenses = (query) => api.get('/payment/expenses', { query })
// body: { category, amount, expense_date: 'YYYY-MM-DD', note?, branch_id? (owner) }
export const createExpense = (body) => data(api.post('/payment/expenses', { body }))
export const updateExpense = (id, body) => data(api.patch(`/payment/expenses/${id}`, { body }))
export const deleteExpense = (id) => data(api.delete(`/payment/expenses/${id}`))

// ---------- รายงาน (1.34–1.37) ----------
export const getDailyReport = (query) => data(api.get('/payment/reports/daily', { query }))
export const getBranchReport = (query) => data(api.get('/payment/reports/branches', { query }))
export const getProfitReport = (query) => data(api.get('/payment/reports/profit', { query }))

// หมวดรายจ่าย (ค่าที่ backend รับ → ชื่อที่แสดง)
export const EXPENSE_CATEGORIES = [
  { value: 'labor', label: 'ค่าแรง' },
  { value: 'rent_utilities', label: 'ค่าเช่า/ค่าไฟ/ค่าน้ำ' },
  { value: 'ingredients', label: 'วัตถุดิบ' },
  { value: 'other', label: 'อื่นๆ' },
]
