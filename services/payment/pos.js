// คุยกับ pos (Dev 3) ผ่าน internal API
//   GET  /internal/orders/:id/summary        ยอดที่ต้องจ่าย + สถานะบิล
//   POST /internal/orders/:id/mark-paid      ปิดบิล คืนโต๊ะเป็นว่าง
//   POST /internal/orders/:id/mark-refunded  อัปเดตบิลหลังคืนเงิน
//   GET  /internal/approvals/:id             ข้อมูลคำขอคืนเงิน (ขอให้ Dev 3 เพิ่ม)
//   GET  /internal/reports/top-menus         เมนูขายดี
//   GET  /internal/reports/approved-refunds  คืนเงินที่อนุมัติแล้วแต่ยังไม่ได้คืน (หักรายได้ตั้งแต่อนุมัติ)
//   GET  /internal/orders?status=waiting_payment&branch_id=          บิลรอชำระ (ขอให้ Dev 3 เพิ่ม)
//   GET  /internal/approvals?type=refund&status=approved&branch_id=  คำขอคืนเงินที่อนุมัติแล้ว (ขอให้ Dev 3 เพิ่ม)
// POS_MODE=mock → ใช้บิลจำลองในหน่วยความจำ ระหว่างรอ pos ของ Dev 3
import { AppError, round2 } from './helpers.js'

const MODE = process.env.POS_MODE || 'mock'
const POS_URL = process.env.POS_URL || 'http://localhost:3003'

// ===================== เรียก pos จริง =====================
async function call(method, path, body) {
  let res
  try {
    res = await fetch(`${POS_URL}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': process.env.INTERNAL_KEY },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    throw new AppError(502, 'POS_UNAVAILABLE', 'ติดต่อระบบบิล (pos) ไม่ได้')
  }
  if (res.status === 404) return null
  const json = await res.json().catch(() => ({}))
  if (res.status >= 500) throw new AppError(502, 'POS_ERROR', 'ระบบบิล (pos) ตอบผิดพลาด')
  if (!res.ok) throw new AppError(res.status, json.error?.code || 'POS_ERROR', json.error?.message || 'ระบบบิลปฏิเสธคำขอ')
  return json.data ?? null
}

const httpPos = {
  getOrder: (orderId) => call('GET', `/internal/orders/${orderId}/summary`),
  markPaid: (orderId, body) => call('POST', `/internal/orders/${orderId}/mark-paid`, body),
  markRefunded: (orderId, body) => call('POST', `/internal/orders/${orderId}/mark-refunded`, body),
  getApproval: (approvalId) => call('GET', `/internal/approvals/${approvalId}`),
  listWaitingOrders: async ({ branchId }) =>
    (await call('GET', `/internal/orders?${new URLSearchParams({ status: 'waiting_payment', branch_id: branchId })}`)) ?? [],
  listApprovedRefunds: async ({ branchId }) =>
    (await call('GET', `/internal/approvals?${new URLSearchParams({ type: 'refund', status: 'approved', branch_id: branchId })}`)) ?? [],
  topMenus: ({ branchId, from, to, limit }) =>
    call('GET', `/internal/reports/top-menus?${new URLSearchParams({ from, to, limit, ...(branchId ? { branch_id: branchId } : {}) })}`),
  approvedRefunds: async ({ branchId, from, to }) =>
    (await call('GET', `/internal/reports/approved-refunds?${new URLSearchParams({ from, to, ...(branchId ? { branch_id: branchId } : {}) })}`)) ?? [],
}

// ===================== pos จำลอง =====================
// บิลรอชำระ 4 บิลของสาขาแรก + คำขอคืนเงินที่อนุมัติแล้ว 1 รายการ (ของบิลที่ 4)
// เปลี่ยน MOCK_BRANCH เป็น id สาขาจริงจาก identity.branches ได้ใน .env
const MOCK_BRANCH = process.env.MOCK_BRANCH_ID || '11111111-1111-4111-8111-111111111111'

/** VAT ตามสูตร 1.24: vat = (subtotal − discount) × 7% ปัดเป็นบาทเต็ม · total = subtotal − discount + vat */
const withVat = (o) => {
  const vat = Math.round((o.subtotal - o.discount_amount) * 0.07)
  return { ...o, vat_amount: vat, total: round2(o.subtotal - o.discount_amount + vat) }
}

const mockItem = (menu_name, quantity, unit_price) => ({ menu_name, quantity, unit_price, line_total: round2(quantity * unit_price) })

const mockOrders = new Map(
  [
    { id: 'e0000000-0000-4000-8000-000000000001', order_no: 'DEMO-0001', table_no: 'A1', subtotal: 200, discount_amount: 0, items: [mockItem('ข้าวกะเพราหมูสับ', 2, 60), mockItem('ชาไทยเย็น', 2, 40)] },
    { id: 'e0000000-0000-4000-8000-000000000002', order_no: 'DEMO-0002', table_no: 'A2', subtotal: 450, discount_amount: 50, items: [mockItem('ปลากะพงทอด', 1, 300), mockItem('ส้มตำไทย', 2, 75)] },
    { id: 'e0000000-0000-4000-8000-000000000003', order_no: 'DEMO-0003', table_no: 'B1', subtotal: 89.5, discount_amount: 0, items: [mockItem('กาแฟเย็น', 1, 89.5)] },
    { id: 'e0000000-0000-4000-8000-000000000004', order_no: 'DEMO-0004', table_no: 'B2', subtotal: 1000, discount_amount: 100, items: [mockItem('ชุดหมูกระทะ', 4, 250)] },
  ].map((o) => [o.id, withVat({ ...o, branch_id: MOCK_BRANCH, status: 'waiting_payment' })]),
)
const mockApprovals = new Map([
  ['f0000000-0000-4000-8000-000000000001', { id: 'f0000000-0000-4000-8000-000000000001', order_id: 'e0000000-0000-4000-8000-000000000004', branch_id: MOCK_BRANCH, type: 'refund', status: 'approved', amount: 107, reason: 'อาหารไม่ตรงตามที่สั่ง (ตัวอย่าง)' }],
])

const mockPos = {
  async getOrder(orderId) {
    return mockOrders.get(orderId) ?? null
  },
  async markPaid(orderId) {
    const o = mockOrders.get(orderId)
    if (o) o.status = 'paid'
    return o ?? null
  },
  async markRefunded(orderId) {
    const o = mockOrders.get(orderId)
    if (o) o.status = 'refunded'
    return o ?? null
  },
  async getApproval(approvalId) {
    return mockApprovals.get(approvalId) ?? null
  },
  async listWaitingOrders({ branchId }) {
    return [...mockOrders.values()].filter((o) => o.branch_id === branchId && o.status === 'waiting_payment')
  },
  async listApprovedRefunds({ branchId }) {
    return [...mockApprovals.values()].filter((a) => a.branch_id === branchId && a.type === 'refund' && a.status === 'approved')
  },
  async approvedRefunds() {
    return []
  },
  async topMenus() {
    return [
      { menu_id: 'demo-1', menu_name: 'ข้าวกะเพราหมูสับ (ตัวอย่าง)', quantity: 42, amount: 2520 },
      { menu_id: 'demo-2', menu_name: 'ชาไทยเย็น (ตัวอย่าง)', quantity: 31, amount: 1395 },
    ]
  },
}

export const pos = MODE === 'http' ? httpPos : mockPos
export const posMode = MODE
export const mockOrderList = [...mockOrders.values()]
