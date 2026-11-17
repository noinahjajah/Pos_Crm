// client กลางสำหรับเรียก API ผ่าน gateway
// - แนบ access token อัตโนมัติ
// - token หมดอายุ → ขอใหม่ด้วย refresh token 1 ครั้ง แล้วเรียกซ้ำ
// - error ทุกตัวเป็น ApiError ที่มี status / code / message / details ตาม spec ข้อ 7

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1'
const STORAGE_KEY = 'pos.session'

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.error?.message || `เกิดข้อผิดพลาด (${status})`)
    this.status = status
    this.code = body?.error?.code || 'UNKNOWN'
    this.details = body?.error?.details || []
    this.requestId = body?.request_id
  }
  /** ข้อความผิดพลาดของช่องในฟอร์ม { field: message } */
  get fieldErrors() {
    return Object.fromEntries(this.details.filter((d) => d.field).map((d) => [d.field, d.message]))
  }
}

// ---------- session (เก็บใน localStorage) ----------
function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null
  } catch {
    return null
  }
}

let session = readSession()
const listeners = new Set()

export function getSession() {
  return session
}

export function setSession(next) {
  session = next
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ไม่มี localStorage — ใช้ในหน่วยความจำต่อ */
  }
  listeners.forEach((fn) => fn(next))
}

export function onSessionChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ---------- request ----------
function buildUrl(path, query) {
  const url = `${BASE}${path}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

async function rawRequest(path, { method = 'GET', body, query, token } = {}) {
  const headers = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  let res
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, { error: { code: 'NETWORK_ERROR', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' } })
  }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, json)
  return json
}

let refreshing = null
async function refreshSession() {
  if (!session?.refresh_token) return false
  refreshing ??= rawRequest('/identity/auth/refresh', {
    method: 'POST',
    body: { refresh_token: session.refresh_token },
  })
    .then(({ data }) => {
      setSession(data)
      return true
    })
    .catch(() => {
      setSession(null)
      return false
    })
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

/**
 * เรียก API ผ่าน gateway
 * @returns {Promise<{data: any, meta?: any}>}
 */
export async function api(path, options = {}) {
  try {
    return await rawRequest(path, { ...options, token: session?.access_token })
  } catch (err) {
    const canRetry = err.status === 401 && ['TOKEN_EXPIRED', 'TOKEN_INVALID'].includes(err.code) && session
    if (canRetry && (await refreshSession())) {
      return rawRequest(path, { ...options, token: session?.access_token })
    }
    if (err.status === 401 && session) setSession(null)
    throw err
  }
}

// ---------- identity ----------
export const identityApi = {
  login: (username, password) =>
    rawRequest('/identity/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => api('/identity/auth/logout', { method: 'POST' }),
  me: () => api('/identity/me'),

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
