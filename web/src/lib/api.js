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
let refreshTimer = null

export function getSession() {
  return session
}

/** เหตุผลที่ถูกพาออกจากระบบครั้งล่าสุด ('expired' | 'disabled') — อ่านอย่างเดียว ไม่ลบ */
export function peekLogoutReason() {
  try {
    return sessionStorage.getItem('pos.logoutReason')
  } catch {
    return null
  }
}

export function clearLogoutReason() {
  try {
    sessionStorage.removeItem('pos.logoutReason')
  } catch {
    /* ignore */
  }
}

function endSession(reason) {
  try {
    if (reason) sessionStorage.setItem('pos.logoutReason', reason)
  } catch {
    /* ignore */
  }
  setSession(null)
}

function apply(next) {
  session = next
  listeners.forEach((fn) => fn(next))
  scheduleRefresh()
}

export function setSession(next) {
  // จำเวลาหมดอายุของ access token ไว้ ใช้ต่ออายุล่วงหน้า
  if (next && !next.expires_at && next.expires_in) next = { ...next, expires_at: Date.now() + next.expires_in * 1000 }
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ไม่มี localStorage — ใช้ในหน่วยความจำต่อ */
  }
  apply(next)
}

/** ต่ออายุ token ล่วงหน้า 60 วินาทีก่อนหมดอายุ ผู้ใช้จะไม่หลุดกลางงาน */
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  if (!session?.expires_at) return
  const wait = Math.max(5_000, session.expires_at - Date.now() - 60_000)
  refreshTimer = setTimeout(() => refreshSession(), wait)
}

// เปิดหลายแท็บ: login / logout / ต่ออายุในแท็บหนึ่ง แท็บอื่นตามด้วย
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) apply(readSession())
  })
  scheduleRefresh()
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
    .catch((err) => {
      // refresh token ใช้ได้ครั้งเดียว: ถ้าแท็บอื่นต่ออายุไปก่อนแล้ว ให้ใช้ session ของแท็บนั้น
      const latest = readSession()
      if (latest?.refresh_token && latest.refresh_token !== session?.refresh_token) {
        apply(latest)
        return true
      }
      endSession(err.code === 'ACCOUNT_DISABLED' ? 'disabled' : 'expired')
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
    if (err.status === 401 && session) endSession(err.code === 'ACCOUNT_DISABLED' ? 'disabled' : 'expired')
    throw err
  }
}

// ---------- กติการหัสผ่าน (ตรงกับฝั่ง identity) ----------
export const PASSWORD_RULES = [
  { test: (p) => p.length >= 8, label: 'อย่างน้อย 8 ตัวอักษร' },
  { test: (p) => /[A-Za-z]/.test(p), label: 'มีตัวอักษรภาษาอังกฤษ' },
  { test: (p) => /[0-9]/.test(p), label: 'มีตัวเลข' },
]
export const passwordOk = (p) => p.length <= 72 && PASSWORD_RULES.every((r) => r.test(p))

/** สุ่มรหัสชั่วคราว 10 ตัว (มีตัวอักษรและตัวเลขแน่นอน) */
export function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.getRandomValues(new Uint32Array(8))
  const body = Array.from(bytes, (n) => chars[n % chars.length]).join('')
  return `${body}${(bytes[0] % 8) + 2}${chars[bytes[1] % 23]}`
}

// ---------- identity ----------
export const identityApi = {
  login: (username, password) =>
    rawRequest('/identity/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => api('/identity/auth/logout', { method: 'POST' }),
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
