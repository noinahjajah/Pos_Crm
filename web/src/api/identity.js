// =====================================================================
// identity — login, ผู้ใช้, สาขา, role (Dev 1) · 1.1–1.6
// ทุกฟังก์ชันคืนค่า data ของ response
// =====================================================================

import { api, setTokens } from './client'

const data = (promise) => promise.then((res) => res.data)

// ---------- auth (1.2) ----------
/** คืน { access_token, refresh_token, user? } และเก็บ token ให้เลย */
export async function login(username, password) {
  const result = await data(api.post('/identity/auth/login', { body: { username, password } }))
  setTokens(result)
  return result
}

export async function logout() {
  try {
    await api.post('/identity/auth/logout')
  } finally {
    setTokens(null)
  }
}

/** ข้อมูลตัวเอง { id, username, full_name, role, branch_id, branch? } */
export const getMe = () => data(api.get('/identity/me'))

// ---------- สาขา (1.6 owner เพิ่ม/แก้/ลบ) ----------
/** query: { include_inactive? } */
export const listBranches = (query) => data(api.get('/identity/branches', { query }))
/** body: { code, name, branch_type: 'restaurant'|'drinks'|'bar', address?, phone? } */
export const createBranch = (body) => data(api.post('/identity/branches', { body }))
/** body: ช่องเดียวกับตอนสร้าง + is_active (เปิด/ปิดสาขา) */
export const updateBranch = (id, body) => data(api.patch(`/identity/branches/${id}`, { body }))
/** soft delete (is_active = false) */
export const deleteBranch = (id) => data(api.delete(`/identity/branches/${id}`))

// ---------- role ----------
export const listRoles = () => data(api.get('/identity/roles'))

// ---------- ผู้ใช้ (1.5 owner เพิ่ม/แก้/ลบ · manager ดูสาขาตัวเอง) ----------
/** query: { branch_id?, role?, q?, include_inactive? } */
export const listUsers = (query) => data(api.get('/identity/users', { query }))
/** body: { username, password, full_name, role, branch_id (null = owner) } */
export const createUser = (body) => data(api.post('/identity/users', { body }))
/** body: { full_name?, role?, branch_id?, password?, is_active? } */
export const updateUser = (id, body) => data(api.patch(`/identity/users/${id}`, { body }))
/** soft delete + ยกเลิก session */
export const deleteUser = (id) => data(api.delete(`/identity/users/${id}`))
