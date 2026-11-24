// คุยกับ service อื่นผ่าน internal API (X-Internal-Key) — ไม่อ่านตารางของคนอื่นตรง ๆ
//   identity: GET  /internal/branches/:id   ตรวจสาขา (owner สร้างโต๊ะ)
//             GET  /internal/users?ids=      ชื่อพนักงานที่แสดงในบิล/คำขอ
//   catalog:  POST /internal/menus/lookup    ชื่อ/ราคา/ตัวเลือกตอนสั่ง (snapshot)
//             POST /internal/stocks/deduct   ตัดสต็อก (reference = id ตั๋ว)
//             POST /internal/stocks/restore  คืนสต็อกเมื่อบันทึกตั๋วไม่สำเร็จ / ยกเลิกรายการที่ยังไม่ได้ทำ
import { AppError, badRequest, branchForCreate } from './helpers.js'

const IDENTITY_URL = (process.env.IDENTITY_URL || 'http://localhost:3001').replace(/\/$/, '')
const CATALOG_URL = (process.env.CATALOG_URL || 'http://localhost:3002').replace(/\/$/, '')

async function call(base, name, method, path, body, timeout = 5000) {
  let res
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': process.env.INTERNAL_KEY },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeout),
    })
  } catch {
    throw new AppError(502, `${name.toUpperCase()}_UNAVAILABLE`, `ติดต่อระบบ${name === 'catalog' ? 'เมนู' : 'ผู้ใช้'}ไม่ได้ กรุณาลองใหม่`)
  }
  const json = await res.json().catch(() => ({}))
  return { status: res.status, ok: res.ok, json }
}

// ===================== identity =====================
/** สาขาต้องมีจริงและยังเปิดใช้ ไม่งั้น 400 */
export async function mustBeActiveBranch(branchId, field = 'branch_id') {
  const r = await call(IDENTITY_URL, 'identity', 'GET', `/internal/branches/${branchId}`, null, 3000)
  const invalid = () => badRequest('สาขาไม่ถูกต้องหรือถูกปิดใช้', [{ field, message: 'ไม่พบสาขานี้ในระบบ' }])
  if (r.status === 404) throw invalid()
  if (!r.ok) throw new AppError(502, 'IDENTITY_ERROR', 'ตรวจสอบสาขาไม่ได้ กรุณาลองใหม่')
  if (!r.json.data?.is_active) throw invalid()
}

/** สาขาสำหรับสร้างข้อมูล · owner เลือกเอง จึงต้องตรวจกับ identity */
export async function branchForWrite(req, requested) {
  const branchId = branchForCreate(req, requested)
  if (req.user.role === 'owner') await mustBeActiveBranch(branchId)
  return branchId
}

// ชื่อพนักงาน: แคช 5 นาที · identity ล่มก็ยังทำงานต่อได้ (แค่ไม่มีชื่อ)
const NAME_TTL = 5 * 60 * 1000
const names = new Map() // id → { name, at }

/** → Map(id → ชื่อ) */
export async function userNames(ids) {
  const wanted = [...new Set(ids.filter(Boolean))]
  const now = Date.now()
  const missing = wanted.filter((id) => !(names.get(id)?.at > now - NAME_TTL))
  if (missing.length) {
    try {
      const r = await call(IDENTITY_URL, 'identity', 'GET', `/internal/users?ids=${missing.join(',')}`, null, 3000)
      if (r.ok) for (const u of r.json.data || []) names.set(u.id, { name: u.full_name || u.username, at: now })
    } catch {
      /* ไม่มีชื่อก็แสดงต่อได้ */
    }
  }
  return new Map(wanted.map((id) => [id, names.get(id)?.name ?? null]))
}

// ===================== catalog =====================
/** ตรวจเมนู/ตัวเลือก + ได้ชื่อและราคา · ไม่ผ่าน → 409 พร้อมรายละเอียดรายการ */
export async function lookupMenus(branchId, items) {
  const r = await call(CATALOG_URL, 'catalog', 'POST', '/internal/menus/lookup', { branch_id: branchId, items })
  if (r.ok) return r.json.data.items
  const e = r.json.error || {}
  if (r.status === 409 || r.status === 400) throw new AppError(409, e.code || 'MENU_LOOKUP_FAILED', e.message || 'รายการสั่งบางรายการใช้ไม่ได้', e.details || [])
  throw new AppError(502, 'CATALOG_ERROR', 'ระบบเมนูตอบผิดพลาด')
}

/** ตัดสต็อกทุกรายการพร้อมกัน (1.20) · reference เดิมเรียกซ้ำได้ */
export async function deductStocks(branchId, reference, items) {
  const r = await call(CATALOG_URL, 'catalog', 'POST', '/internal/stocks/deduct', { branch_id: branchId, reference, items })
  if (r.ok) return r.json.data
  const e = r.json.error || {}
  if (r.status === 409) throw new AppError(409, 'STOCK_NOT_ENOUGH', e.message || 'เมนูบางรายการหมดหรือปิดขาย', e.details || [])
  throw new AppError(502, 'CATALOG_ERROR', 'ตัดสต็อกไม่สำเร็จ กรุณาลองใหม่')
}

/** คืนสต็อกตามรายการ (ยกเลิกรายการที่ยังไม่ได้ทำ) · reference เดิมเรียกซ้ำได้ไม่คืนซ้ำ · คืนไม่สำเร็จ → false */
export async function restoreStockItems(branchId, reference, items) {
  try {
    const r = await call(CATALOG_URL, 'catalog', 'POST', '/internal/stocks/restore', { branch_id: branchId, reference, items })
    if (r.ok) return true
    console.error('[pos] คืนสต็อกรายการที่ยกเลิกไม่สำเร็จ (ต้องตรวจมือ)', reference, r.status, r.json)
  } catch (err) {
    console.error('[pos] คืนสต็อกรายการที่ยกเลิกไม่สำเร็จ (ต้องตรวจมือ)', reference, err.message)
  }
  return false
}

/** คืนสต็อกที่ตัดไปด้วย reference เดิม (ใช้เฉพาะตอนบันทึกตั๋วไม่สำเร็จ) */
export async function restoreStocks(branchId, reference) {
  try {
    const r = await call(CATALOG_URL, 'catalog', 'POST', '/internal/stocks/restore', { branch_id: branchId, reference })
    if (!r.ok) console.error('[pos] คืนสต็อกไม่สำเร็จ', reference, r.status, r.json)
  } catch (err) {
    console.error('[pos] คืนสต็อกไม่สำเร็จ (ต้องตรวจมือ)', reference, err.message)
  }
}
