// =====================================================================
// catalog — หมวดหมู่ เมนู กลุ่มตัวเลือก สต็อก (Dev 2)
// ทุกฟังก์ชันคืนค่า data ของ response
// owner ส่ง branch_id ใน query เพื่อดูทีละสาขา · staff/manager ระบบใช้สาขาของตัวเองเสมอ
// =====================================================================

import { api } from './client'

const data = (promise) => promise.then((res) => res.data)

// ---------- หมวดหมู่ (ของกลาง owner จัดการ) ----------
export const listCategories = (query) => data(api.get('/catalog/categories', { query }))
export const createCategory = (body) => data(api.post('/catalog/categories', { body }))
export const updateCategory = (id, body) => data(api.patch(`/catalog/categories/${id}`, { body }))
export const deleteCategory = (id) => data(api.delete(`/catalog/categories/${id}`))

// ---------- เมนู (1.14, 1.15) ----------
/** query: { branch_id?, category_id?, available?, q? } */
export const listMenus = (query) => data(api.get('/catalog/menus', { query }))
export const getMenu = (id) => data(api.get(`/catalog/menus/${id}`))
/** body: { category_id, name, price, description?, image_url?, image?: { data, content_type }, branch_id? (owner) } */
export const createMenu = (body) => data(api.post('/catalog/menus', { body }))
export const updateMenu = (id, body) => data(api.patch(`/catalog/menus/${id}`, { body }))
export const deleteMenu = (id) => data(api.delete(`/catalog/menus/${id}`))
export const copyMenu = (id, toBranchId) => data(api.post(`/catalog/menus/${id}/copy`, { body: { to_branch_id: toBranchId } }))
export const setMenuAvailability = (id, isAvailable) =>
  data(api.patch(`/catalog/menus/${id}/availability`, { body: { is_available: isAvailable } }))
/** groups: [{ option_group_id, sort_order? }] — แทนที่ทั้งชุด */
export const setMenuOptionGroups = (id, groups) =>
  data(api.put(`/catalog/menus/${id}/option-groups`, { body: { option_groups: groups } }))

// ---------- กลุ่มตัวเลือก (1.16–1.18) ----------
export const listOptionGroups = (query) => data(api.get('/catalog/option-groups', { query }))
/** body: { name, max_select, is_required?, options?: [{ name, extra_price }], branch_id? (owner) } */
export const createOptionGroup = (body) => data(api.post('/catalog/option-groups', { body }))
export const updateOptionGroup = (id, body) => data(api.patch(`/catalog/option-groups/${id}`, { body }))
export const createOption = (groupId, body) => data(api.post(`/catalog/option-groups/${groupId}/options`, { body }))
export const updateOption = (id, body) => data(api.patch(`/catalog/options/${id}`, { body }))

// ---------- สต็อก (1.19–1.22) ----------
export const listStocks = (query) => data(api.get('/catalog/stocks', { query }))
/** body: { quantity } ตั้งค่า หรือ { add } เติมเพิ่ม */
export const adjustStock = (menuId, body) => data(api.patch(`/catalog/stocks/${menuId}`, { body }))

// ---------- ตัวช่วย ----------
/** อ่านไฟล์รูปเป็น { data, content_type } สำหรับส่งใน field image */
export function readImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ data: reader.result, content_type: file.type })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
