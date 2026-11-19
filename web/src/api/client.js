// =====================================================================
// client — ที่เดียวที่เรียก backend (ผ่าน API Gateway) (Dev 1)
// - base /api/v1 (ตอน dev vite proxy ส่งต่อให้ gateway :8080)
// - แนบ access token ทุก request
// - เจอ 401 → ขอ token ใหม่ด้วย refresh token 1 ครั้งแล้วยิงซ้ำ ถ้าไม่ได้ → ออกจากระบบ
// - error มาตรฐาน { error: { code, message, details }, request_id } → โยนเป็น ApiError
//
// ใช้: api.get('/catalog/menus', { query })  api.post(path, { body, headers })
// คืน JSON ทั้งก้อน { data, meta }
// =====================================================================

const BASE = '/api/v1'
const STORAGE_KEY = 'pos.auth'
const REFRESH_PATH = '/identity/auth/refresh'

export class ApiError extends Error {
  constructor({ status, code, message, details, requestId }) {
    super(message || 'เกิดข้อผิดพลาด')
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details || []
    this.requestId = requestId
  }
}

// ข้อความเมื่อ backend ไม่ส่ง message มา
const STATUS_TEXT = {
  401: 'กรุณาเข้าสู่ระบบใหม่',
  403: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  404: 'ไม่พบข้อมูล',
  409: 'สถานะข้อมูลไม่ถูกต้อง',
  429: 'เรียกถี่เกินไป กรุณารอสักครู่',
  502: 'ระบบปลายทางไม่ตอบสนอง',
  504: 'ระบบปลายทางตอบช้าเกินไป',
}

// ---------- token ----------
let tokens = readTokens()

function readTokens() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null
  } catch {
    return null
  }
}

/** เก็บ token หลัง login / refresh · ส่ง null = ล้าง */
export function setTokens(next) {
  tokens = next ? { access_token: next.access_token, refresh_token: next.refresh_token } : null
  try {
    if (tokens) localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* โหมดส่วนตัวเก็บไม่ได้ ใช้ในหน่วยความจำต่อ */
  }
}

export const hasToken = () => Boolean(tokens?.access_token)

/** header สำหรับ request ที่ยิงเองนอก api.* (เช่น SSE ผ่าน fetch ที่ต้องอ่านเป็น stream) */
export const authHeaders = () => (tokens?.access_token ? { Authorization: `Bearer ${tokens.access_token}` } : {})
export const API_BASE = BASE

// AuthContext ฟังเหตุการณ์นี้เพื่อพากลับหน้า login เมื่อ refresh ไม่สำเร็จ
const listeners = new Set()
export function onSessionExpired(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// กันยิง refresh ซ้อนกันเมื่อหลาย request เจอ 401 พร้อมกัน
let refreshing = null
function refreshTokens() {
  if (!tokens?.refresh_token) return Promise.resolve(false)
  refreshing ??= fetch(BASE + REFRESH_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  })
    .then(async (res) => {
      if (!res.ok) return false
      const json = await res.json()
      setTokens(json.data ?? json)
      return true
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

// ---------- request ----------
function buildUrl(path, query) {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query || {})) {
    // ข้ามค่าว่าง เช่น branch_id: '' ของ owner = ทุกสาขา
    if (value === undefined || value === null || value === '') continue
    params.append(key, String(value))
  }
  const qs = params.toString()
  return BASE + path + (qs ? `?${qs}` : '')
}

async function request(method, path, { query, body, headers, signal } = {}, retried = false) {
  const init = { method, headers: { Accept: 'application/json', ...headers }, signal }
  if (tokens?.access_token) init.headers.Authorization = `Bearer ${tokens.access_token}`
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body)
  }

  let res
  try {
    res = await fetch(buildUrl(path, query), init)
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new ApiError({ status: 0, code: 'NETWORK_ERROR', message: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต' })
  }

  const isAuthCall = path.startsWith('/identity/auth/')
  if (res.status === 401 && !isAuthCall && !retried) {
    if (await refreshTokens()) return request(method, path, { query, body, headers, signal }, true)
    setTokens(null)
    listeners.forEach((fn) => fn())
  }

  if (res.status === 204) return { data: null }
  const json = await res.json().catch(() => null)

  if (!res.ok) {
    const e = json?.error || {}
    throw new ApiError({
      status: res.status,
      code: e.code || `HTTP_${res.status}`,
      message: e.message || STATUS_TEXT[res.status] || `เกิดข้อผิดพลาด (${res.status})`,
      details: e.details,
      requestId: json?.request_id,
    })
  }
  return json ?? { data: null }
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, opts) => request('POST', path, opts),
  put: (path, opts) => request('PUT', path, opts),
  patch: (path, opts) => request('PATCH', path, opts),
  delete: (path, opts) => request('DELETE', path, opts),
}
