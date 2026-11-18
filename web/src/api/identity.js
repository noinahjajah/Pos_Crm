// identity: login, me, ผู้ใช้, สาขา, role (Dev 1)

import { api, getSession, rawRequest, setSession } from './client.js'

// กติการหัสผ่าน (ตรงกับฝั่ง identity)
export const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, label: 'อย่างน้อย 8 ตัวอักษร' },
  { test: (p) => /[A-Za-z]/.test(p), label: 'มีตัวอักษรภาษาอังกฤษ' },
  { test: (p) => /[0-9]/.test(p), label: 'มีตัวเลข' },
]
export const passwordOk = (p) => p.length <= 72 && PASSWORD_RULES.every((r) => r.test(p))

export function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(8))
  const body = Array.from(bytes, (n) => chars[n % chars.length]).join('')
  return `${body}${(bytes[0] % 8) + 2}${chars[bytes[1] % 23]}`
}

// endpoint ของ identity ที่หน้าเว็บใช้
export const identityApi = {
  // สมัครสมาชิก (ยังไม่ login): สาขาที่เปิดอยู่ + สมัคร
  publicBranches: () => rawRequest('/identity/auth/branches'),
  register: (body) => rawRequest('/identity/auth/register', { method: 'POST', body }),
  login: (username, password) =>
    rawRequest('/identity/auth/login', { method: 'POST', body: { username, password } }),
  // ออกจากระบบทันที แล้วค่อยแจ้ง server เบื้องหลัง
  logout: () => {
    const token = getSession()?.access_token
    setSession(null)
    if (token) rawRequest('/identity/auth/logout', { method: 'POST', token }).catch(() => {})
  },
  me: () => api('/identity/me'),
  changePassword: (current_password, new_password) =>
    api('/identity/auth/change-password', { method: 'POST', body: { current_password, new_password } }),

  listBranches: (query) => api('/identity/branches', { query }),
  createBranch: (body) => api('/identity/branches', { method: 'POST', body }),
  updateBranch: (id, body) => api(`/identity/branches/${id}`, { method: 'PATCH', body }),
  deleteBranch: (id) => api(`/identity/branches/${id}`, { method: 'DELETE' }),

  listRoles: () => api('/identity/roles'),
  listUsers: (query) => api('/identity/users', { query }),
  createUser: (body) => api('/identity/users', { method: 'POST', body }),
  updateUser: (id, body) => api(`/identity/users/${id}`, { method: 'PATCH', body }),
  deleteUser: (id) => api(`/identity/users/${id}`, { method: 'DELETE' }),
}
