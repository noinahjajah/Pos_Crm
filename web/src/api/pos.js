// pos: โต๊ะ ออร์เดอร์ ใบเข้าครัว คำขออนุมัติ (Dev 3) · endpoint ตามตารางสิทธิ์ใน server/gateway/permissions.js

import { api } from './client.js'

export const posApi = {
  getTables: (query) => api(`/pos/tables`, { query }),
  postTables: (body) => api(`/pos/tables`, { method: 'POST', body }),
  patchTables: (id, body) => api(`/pos/tables/${id}`, { method: 'PATCH', body }),
  postOrders: (body) => api(`/pos/orders`, { method: 'POST', body }),
  getOrders: (query) => api(`/pos/orders`, { query }),
  getOrdersById: (id, query) => api(`/pos/orders/${id}`, { query }),
  postOrdersTablesMove: (id, body) => api(`/pos/orders/${id}/tables/move`, { method: 'POST', body }),
  postOrdersTablesMerge: (id, body) => api(`/pos/orders/${id}/tables/merge`, { method: 'POST', body }),
  postOrdersTickets: (id, body) => api(`/pos/orders/${id}/tickets`, { method: 'POST', body }),
  postOrdersRequestPayment: (id, body) => api(`/pos/orders/${id}/request-payment`, { method: 'POST', body }),
  getKitchenTickets: (query) => api(`/pos/kitchen/tickets`, { query }),
  patchKitchenTickets: (id, body) => api(`/pos/kitchen/tickets/${id}`, { method: 'PATCH', body }),
  postOrdersApprovals: (id, body) => api(`/pos/orders/${id}/approvals`, { method: 'POST', body }),
  getApprovals: (query) => api(`/pos/approvals`, { query }),
  postApprovalsApprove: (id, body) => api(`/pos/approvals/${id}/approve`, { method: 'POST', body }),
  postApprovalsReject: (id, body) => api(`/pos/approvals/${id}/reject`, { method: 'POST', body }),
}
