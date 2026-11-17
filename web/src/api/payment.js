// payment: รับเงิน คืนเงิน รายจ่าย รายงาน (Dev 2/3) · endpoint ตามตารางสิทธิ์ใน server/gateway/permissions.js

import { api } from './client.js'

export const paymentApi = {
  postPayments: (body) => api(`/payment/payments`, { method: 'POST', body }),
  postRefunds: (body) => api(`/payment/refunds`, { method: 'POST', body }),
  getPayments: (query) => api(`/payment/payments`, { query }),
  getExpenses: (query) => api(`/payment/expenses`, { query }),
  postExpenses: (body) => api(`/payment/expenses`, { method: 'POST', body }),
  patchExpenses: (id, body) => api(`/payment/expenses/${id}`, { method: 'PATCH', body }),
  deleteExpenses: (id) => api(`/payment/expenses/${id}`, { method: 'DELETE' }),
  getReportsDaily: (query) => api(`/payment/reports/daily`, { query }),
  getReportsBranches: (query) => api(`/payment/reports/branches`, { query }),
  getReportsProfit: (query) => api(`/payment/reports/profit`, { query }),
}
