// ตัวช่วยที่ทุกไฟล์ใน catalog ใช้: error, ตรวจข้อมูล, สิทธิ์, สาขา
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
  if (msg === 'CATALOG:NOT_FOUND') return notFound()
  if (msg === 'CATALOG:SAME_BRANCH') return conflict('SAME_BRANCH', 'เมนูนี้อยู่สาขาปลายทางอยู่แล้ว')
  if (msg === 'CATALOG:NEGATIVE_STOCK') return conflict('NEGATIVE_STOCK', 'สต็อกติดลบไม่ได้')
  if (msg === 'CATALOG:GROUP_BRANCH_MISMATCH') return badRequest('กลุ่มตัวเลือกต้องอยู่สาขาเดียวกับเมนูและยังใช้งานอยู่')
  if (error?.code === '23505') return conflict('DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว')
  if (error?.code === '23503') return badRequest('ข้อมูลที่อ้างถึงไม่มีอยู่จริง')
  if (error?.code === '23514' && msg.includes('stocks_open_needs_quantity')) {
    return conflict('STOCK_EMPTY', 'สต็อกเป็น 0 เปิดขายไม่ได้ กรุณาเติมสต็อกก่อน')
  }
  console.error('[catalog] database error:', error)
  return new AppError(500, 'DB_ERROR', 'ติดต่อฐานข้อมูลไม่สำเร็จ', [{ message: msg }])
}

/** middleware ตัวสุดท้าย: ส่ง error กลับเป็น JSON */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') err = badRequest('รูปแบบ JSON ไม่ถูกต้อง')
  if (err?.type === 'entity.too.large') err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลใหญ่เกินไป (รูปไม่เกิน 2MB)')
  if (!(err instanceof AppError)) {
    console.error('[catalog]', err)
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
export const name = z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100)
/** เงิน: ไม่ติดลบ ปัดทศนิยม 2 ตำแหน่ง */
export const money = z
  .number({ invalid_type_error: 'ต้องเป็นตัวเลข' })
  .min(0, 'ต้องไม่ติดลบ')
  .max(999999.99)
  .transform((v) => Math.round(v * 100) / 100)
export const atLeastOne = (v) => Object.keys(v).length > 0

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

/** ตรวจ X-Internal-Key แล้วอ่าน X-User-* เป็น req.user */
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

/** อนุญาตเฉพาะ role ที่ระบุ เช่น allow('manager', 'owner') */
export function allow(...roles) {
  return (req, res, next) => {
    if (!req.user) return next(new AppError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'))
    if (!roles.includes(req.user.role)) return next(forbidden())
    next()
  }
}

// ===================== สาขา =====================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * สาขาที่ใช้กรองตอนอ่านข้อมูล
 * staff/manager = สาขาตัวเองเสมอ · owner = ?branch_id= ที่ส่งมา (ไม่ส่ง = ทุกสาขา → null)
 */
export function branchFilter(req) {
  if (req.user.role !== 'owner') return req.user.branchId
  const fromQuery = typeof req.query.branch_id === 'string' && UUID_RE.test(req.query.branch_id) ? req.query.branch_id : null
  return req.user.branchId || fromQuery
}

/** สาขาที่ใช้ตอนสร้างข้อมูล: staff/manager = สาขาตัวเอง · owner ต้องส่ง branch_id */
export function branchForCreate(req, requested) {
  const branchId = req.user.role === 'owner' ? requested || branchFilter(req) : req.user.branchId
  if (!branchId) throw badRequest('owner ต้องระบุ branch_id', [{ field: 'branch_id', message: 'กรุณาเลือกสาขา' }])
  return branchId
}

/** ข้อมูลของสาขาอื่น → 403 (owner ผ่านทุกสาขา) */
export function mustBeMyBranch(req, branchId) {
  if (req.user.role === 'owner') return
  if (req.user.branchId !== branchId) throw forbidden('ข้อมูลนี้เป็นของสาขาอื่น', 'FORBIDDEN_BRANCH')
}
