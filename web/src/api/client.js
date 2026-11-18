// ที่เดียวที่เรียก backend: base /api/v1 ผ่าน gateway, แนบ token, refresh token เมื่อใกล้หมดอายุ

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
  get fieldErrors() {
    return Object.fromEntries(this.details.filter((d) => d.field).map((d) => [d.field, d.message]))
  }
}

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
  }
}

function endSession(reason) {
  try {
    if (reason) sessionStorage.setItem('pos.logoutReason', reason)
  } catch {
  }
  setSession(null)
}

function apply(next) {
  session = next
  listeners.forEach((fn) => fn(next))
  scheduleRefresh()
}

export function setSession(next) {
  if (next && !next.expires_at && next.expires_in) next = { ...next, expires_at: Date.now() + next.expires_in * 1000 }
  try {
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
  }
  apply(next)
}

// ต่ออายุ token ล่วงหน้า 1 นาทีก่อนหมด ผู้ใช้จะไม่หลุดกลางงาน
function scheduleRefresh() {
  clearTimeout(refreshTimer)
  if (!session?.expires_at) return
  const wait = Math.max(5_000, session.expires_at - Date.now() - 60_000)
  refreshTimer = setTimeout(() => refreshSession(), wait)
}

if (typeof window !== 'undefined') {
  // เปิดหลายแท็บ: login/logout ในแท็บหนึ่ง แท็บอื่นตามด้วย
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) apply(readSession())
  })
  scheduleRefresh()
}

export function onSessionChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

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

export async function rawRequest(path, { method = 'GET', body, query, token, headers: extra } = {}) {
  const headers = { Accept: 'application/json', ...extra }
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

// ถ้าผู้ใช้ออกจากระบบระหว่างรอ จะไม่ดึงกลับเข้าระบบ
async function refreshSession() {
  if (!session?.refresh_token) return false
  const used = session.refresh_token
  refreshing ??= rawRequest('/identity/auth/refresh', {
    method: 'POST',
    body: { refresh_token: used },
  })
    .then(({ data }) => {
      if (session?.refresh_token !== used) return Boolean(session)
      setSession(data)
      return true
    })
    .catch((err) => {
      if (!session) return false
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

// เรียกแบบสั้น: api.get(path, { query }) · api.post(path, { body, headers }) · คืน { data, meta }
for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
  api[method] = (path, options = {}) => api(path, { ...options, method: method.toUpperCase() })
}

