// membership: สมาชิกลูกค้า ระดับ แต้ม

import { api } from './client.js'

export const membershipApi = {
  listCustomers: (query) => api.get('/membership/customers', { query }),
  lookup: (phone) => api.get('/membership/customers/lookup', { query: { phone } }),
  getCustomer: (id) => api.get(`/membership/customers/${id}`),
  register: (body) => api.post('/membership/customers', { body }),
  updateCustomer: (id, body) => api.patch(`/membership/customers/${id}`, { body }),
  addVisit: (id, body) => api.post(`/membership/customers/${id}/visits`, { body }),
  redeem: (id, body) => api.post(`/membership/customers/${id}/redeem`, { body }),
  adjust: (id, body) => api.post(`/membership/customers/${id}/adjust`, { body }),
  listTiers: () => api.get('/membership/tiers'),
  updateTier: (id, body) => api.patch(`/membership/tiers/${id}`, { body }),
}
