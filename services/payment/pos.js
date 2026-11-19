// คุยกับ pos (Dev 3) ผ่าน internal API
//   GET  /internal/orders/:id/summary        ยอดที่ต้องจ่าย + สถานะบิล
//   POST /internal/orders/:id/mark-paid      ปิดบิล คืนโต๊ะเป็นว่าง
//   POST /internal/orders/:id/mark-refunded  อัปเดตบิลหลังคืนเงิน
//   GET  /internal/approvals/:id             ข้อมูลคำขอคืนเงิน
//   GET  /internal/reports/top-menus         เมนูขายดี
import { AppError } from './helpers.js'

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
  topMenus: ({ branchId, from, to, limit }) =>
    call('GET', `/internal/reports/top-menus?${new URLSearchParams({ from, to, limit, ...(branchId ? { branch_id: branchId } : {}) })}`),
}

export const pos = httpPos
