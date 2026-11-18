// ตัวช่วยที่ทุกไฟล์ใน identity ใช้: error, ตรวจข้อมูล, สิทธิ์ (รูปแบบเดียวกับ catalog ของ Dev 2)
import { timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

export { z }

// ===================== error =====================
// ทุก error ตอบรูปแบบเดียวกัน: { error: { code, message, details } }
export class AppError extends Error {
  constructor(status, code, message, details = []) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const badRequest = (message = 'ข้อมูลไม่ถูกต้อง', details = []) => new AppError(400, 'VALIDATION_ERROR', message, details)
export const unauthorized = (message = 'กรุณาเข้าสู่ระบบ', code = 'UNAUTHORIZED') => new AppError(401, code, message)
export const forbidden = (message = 'ไม่มีสิทธิ์ทำรายการนี้', code = 'FORBIDDEN') => new AppError(403, code, message)
export const notFound = (message = 'ไม่พบข้อมูล', code = 'NOT_FOUND') => new AppError(404, code, message)
export const conflict = (code, message, details = []) => new AppError(409, code, message, details)

/** ส่งผลลัพธ์สำเร็จ: { data, meta? } */
export function send(res, data, { status = 200, meta } = {}) {
  return res.status(status).json(meta ? { data, meta } : { data })
}

/** แปลง error จาก Supabase เป็น AppError */
export function dbError(error) {
  const msg = error?.message || ''
  if (error?.code === '23505') {
    if (msg.includes('username')) return conflict('USERNAME_TAKEN', 'ชื่อผู้ใช้นี้มีอยู่แล้ว')
    if (msg.includes('code')) return conflict('BRANCH_CODE_TAKEN', 'รหัสสาขานี้มีอยู่แล้ว')
    return conflict('DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว')
  }
  if (error?.code === '23503') return badRequest('ข้อมูลที่อ้างถึงไม่มีอยู่จริง')
  if (error?.code === '23514') {
    if (msg.includes('profiles_branch_by_role')) return badRequest('เจ้าของร้านต้องไม่มีสาขา ส่วนพนักงาน/ผู้จัดการต้องมีสาขา')
    return badRequest('ข้อมูลไม่ตรงรูปแบบที่กำหนด')
  }
  if (error?.code === 'PGRST106' || msg.includes('schema must be one of')) {
    console.error('[identity] ยังไม่ได้เพิ่ม schema ใน Exposed schemas ของ Supabase:', msg)
    return new AppError(500, 'SCHEMA_NOT_EXPOSED', 'ยังไม่ได้เปิด schema identity1 ใน Supabase (Project Settings → API → Exposed schemas)')
  }
  console.error('[identity] database error:', error)
  return new AppError(500, 'DB_ERROR', 'ติดต่อฐานข้อมูลไม่สำเร็จ', [{ message: msg }])
}

/** middleware ตัวสุดท้าย: ส่ง error กลับเป็น JSON */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') err = badRequest('รูปแบบ JSON ไม่ถูกต้อง')
  if (!(err instanceof AppError)) {
    console.error('[identity]', err)
    err = new AppError(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ')
  }
  res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } })
}

// ===================== ตรวจข้อมูล (zod) =====================
/** ตรวจข้อมูลตาม schema ไม่ผ่าน → 400 พร้อมบอกว่าช่องไหนผิด */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {})
  if (!result.success) {
    throw badRequest(
      'ข้อมูลไม่ถูกต้อง',
      result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message })),
    )
  }
  return result.data
}

export const uuid = z.string().uuid('ต้องเป็น uuid')
export const idParam = z.object({ id: uuid })
export const atLeastOne = (v) => Object.keys(v).length > 0

export const ROLE_NAMES = ['staff', 'manager', 'owner']
export const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,30}$/, 'ชื่อผู้ใช้ 3–30 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ -')
export const password = z.string().min(6, 'รหัสผ่านอย่างน้อย 6 ตัว').max(72)
export const fullName = z.string().trim().min(1, 'กรุณากรอกชื่อ-นามสกุล').max(100)

// ===================== ผู้ใช้และสิทธิ์ =====================
// gateway ตรวจ token แล้วส่ง header มาให้:
//   X-Internal-Key  รหัสลับระหว่าง service (กันคนเรียก service ตรง ๆ)
//   X-User-Id, X-User-Role (staff | manager | owner), X-Branch-Id

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** ตรวจ X-Internal-Key แล้วอ่าน X-User-* เป็น req.user (login/refresh ไม่มี req.user) */
export function checkInternalKey(internalKey) {
  return (req, res, next) => {
    if (req.path === '/health') return next()
    if (!sameSecret(req.get('x-internal-key'), internalKey)) {
      return next(new AppError(401, 'INTERNAL_KEY_INVALID', 'ไม่อนุญาตให้เรียก service โดยตรง'))
    }
    const id = req.get('x-user-id')
    const role = req.get('x-user-role')
    req.user = id && role ? { id, role, branchId: req.get('x-branch-id') || null } : null
    next()
  }
}

/** อนุญาตเฉพาะ role ที่ระบุ (ด่านที่ 2 ต่อจาก gateway) เช่น allow('manager', 'owner') */
export function allow(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized())
    if (!roles.includes(req.user.role)) return next(forbidden())
    next()
  }
}
