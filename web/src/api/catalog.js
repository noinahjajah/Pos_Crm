// catalog: เมนู ตัวเลือก สต็อก (Dev 2) · endpoint ตามตารางสิทธิ์ใน server/gateway/permissions.js

import { api } from './client.js'

export const catalogApi = {
  getCategories: (query) => api(`/catalog/categories`, { query }),
  postCategories: (body) => api(`/catalog/categories`, { method: 'POST', body }),
  patchCategories: (id, body) => api(`/catalog/categories/${id}`, { method: 'PATCH', body }),
  getMenus: (query) => api(`/catalog/menus`, { query }),
  getMenusById: (id, query) => api(`/catalog/menus/${id}`, { query }),
  postMenus: (body) => api(`/catalog/menus`, { method: 'POST', body }),
  patchMenus: (id, body) => api(`/catalog/menus/${id}`, { method: 'PATCH', body }),
  deleteMenus: (id) => api(`/catalog/menus/${id}`, { method: 'DELETE' }),
  postMenusCopy: (id, body) => api(`/catalog/menus/${id}/copy`, { method: 'POST', body }),
  patchMenusAvailability: (id, body) => api(`/catalog/menus/${id}/availability`, { method: 'PATCH', body }),
  putMenusOptionGroups: (id, body) => api(`/catalog/menus/${id}/option-groups`, { method: 'PUT', body }),
  getOptionGroups: (query) => api(`/catalog/option-groups`, { query }),
  postOptionGroups: (body) => api(`/catalog/option-groups`, { method: 'POST', body }),
  patchOptionGroups: (id, body) => api(`/catalog/option-groups/${id}`, { method: 'PATCH', body }),
  postOptionGroupsOptions: (id, body) => api(`/catalog/option-groups/${id}/options`, { method: 'POST', body }),
  patchOptions: (id, body) => api(`/catalog/options/${id}`, { method: 'PATCH', body }),
  getStocks: (query) => api(`/catalog/stocks`, { query }),
  patchStocks: (menuId, body) => api(`/catalog/stocks/${menuId}`, { method: 'PATCH', body }),
}
