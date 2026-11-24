// ตัวช่วยที่ทุกไฟล์ใน pos ใช้: error, ตรวจข้อมูล, สิทธิ์, สาขา (รูปแบบเดียวกับ catalog/payment)
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

// ข้อผิดพลาดจากฟังก์ชันในฐานข้อมูล ('POS:<CODE>') → HTTP
const POS_ERRORS = {
  BAD_INPUT: [400, 'ข้อมูลไม่ถูกต้อง'],
  ORDER_NOT_FOUND: [404, 'ไม่พบบิล'],
  TABLE_NOT_FOUND: [404, 'ไม่พบโต๊ะในสาขานี้'],
  APPROVAL_NOT_FOUND: [404, 'ไม่พบคำขอ'],
  ITEM_NOT_IN_ORDER: [400, 'รายการนี้ไม่ได้อยู่ในบิล'],
  TABLE_NOT_AVAILABLE: [409, 'โต๊ะนี้มีลูกค้าอยู่แล้ว'],
  TABLE_INACTIVE: [409, 'โต๊ะนี้ถูกปิดใช้งาน'],
  TABLE_NOT_IN_ORDER: [409, 'โต๊ะต้นทางไม่ได้อยู่ในบิลนี้'],
  BRANCH_MISMATCH: [409, 'โต๊ะ/บิลอยู่คนละสาขา'],
  ORDER_NOT_OPEN: [409, 'บิลนี้ไม่ได้เปิดอยู่ (อาจเรียกเก็บเงินหรือปิดไปแล้ว)'],
  ORDER_EMPTY: [409, 'ยังไม่มีรายการอาหาร เรียกเก็บเงินไม่ได้'],
  ORDER_HAS_ITEMS: [409, 'บิลนี้ยังมีรายการอาหาร ยกเลิกทั้งบิลไม่ได้ (ยกเลิกทุกรายการก่อน)'],
  ORDER_ALREADY_CLOSED: [409, 'บิลนี้ปิดไปแล้ว ยกเลิกรายการไม่ได้'],
  CANCEL_QTY_EXCEEDED: [409, 'ยกเลิกเกินจำนวนที่เหลืออยู่'],
  CANCELLATION_IMMUTABLE: [409, 'ประวัติการยกเลิกเป็นบันทึกถาวร แก้ไข/ลบไม่ได้'],
  ORDER_ALREADY_PAID: [409, 'บิลนี้ชำระเงินแล้ว'],
  ORDER_NOT_PAID: [409, 'ขอคืนเงินได้เฉพาะบิลที่จ่ายแล้ว'],
  ORDER_NOT_WAITING_PAYMENT: [409, 'บิลยังไม่ได้กดเรียกเก็บเงิน'],
  AMOUNT_MISMATCH: [409, 'ยอดเงินไม่ตรงกับบิล'],
  PENDING_APPROVAL: [409, 'บิลนี้มีคำขอรออนุมัติอยู่'],
  MERGE_HAS_APPROVAL: [409, 'บิลที่มีคำขอส่วนลดรวมโต๊ะไม่ได้ (รวมโต๊ะก่อนแล้วค่อยขอส่วนลด)'],
  APPROVAL_PENDING_EXISTS: [409, 'บิลนี้มีคำขอประเภทนี้รออนุมัติอยู่แล้ว'],
  APPROVAL_DECIDED: [409, 'คำขอนี้ถูกตัดสินไปแล้ว'],
  APPROVAL_IMMUTABLE: [409, 'คำขอเป็นบันทึกถาวร แก้ไขไม่ได้'],
  APPROVAL_UNDELETABLE: [409, 'คำขอเป็นบันทึกถาวร ลบไม่ได้'],
  APPROVAL_ALREADY_REFUNDED: [409, 'คำขอนี้คืนเงินไปแล้ว'],
  DISCOUNT_TOO_LARGE: [409, 'ส่วนลดรวมเกินยอดบิล'],
  REFUND_QTY_EXCEEDED: [409, 'คืนเกินจำนวนที่สั่ง (รวมที่ขอคืนไปแล้ว)'],
  NOTHING_TO_REFUND: [409, 'บิลนี้ไม่มียอดเหลือให้คืน'],
  INVALID_STATUS: [409, 'เปลี่ยนสถานะบิลแบบนี้ไม่ได้'],
}

/** แปลง error จาก Supabase เป็น AppError */
export function dbError(error) {
  const msg = error?.message || ''
  const m = msg.match(/^POS:([A-Z_]+)/)
  if (m && POS_ERRORS[m[1]]) {
    const [status, message] = POS_ERRORS[m[1]]
    return new AppError(status, m[1], message)
  }
  if (error?.code === '23505') return conflict('DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว')
  if (error?.code === '23503') return badRequest('ข้อมูลที่อ้างถึงไม่มีอยู่จริง')
  if (error?.code === '23514') return badRequest('ข้อมูลไม่ผ่านเงื่อนไข', [{ message: msg }])
  console.error('[pos] database error:', error)
  return new AppError(500, 'DB_ERROR', 'ติดต่อฐานข้อมูลไม่สำเร็จ', [{ message: msg }])
}

/** middleware ตัวสุดท้าย: ส่ง error กลับเป็น JSON */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  if (err?.type === 'entity.parse.failed') err = badRequest('รูปแบบ JSON ไม่ถูกต้อง')
  if (err?.type === 'entity.too.large') err = new AppError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลใหญ่เกินไป')
  if (!(err instanceof AppError)) {
    console.error('[pos]', err)
    err = new AppError(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ')
  }
  if (res.headersSent) return res.end()
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
export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบวันที่ YYYY-MM-DD')
export const money = z
  .number({ invalid_type_error: 'ต้องเป็นตัวเลข' })
  .min(0, 'ต้องไม่ติดลบ')
  .max(9_999_999.99)
  .transform((v) => Math.round(v * 100) / 100)
export const atLeastOne = (v) => Object.keys(v).length > 0
export const round2 = (n) => Math.round(Number(n) * 100) / 100

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export const todayTh = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

/** 'YYYY-MM-DD' (เวลาไทย) → ช่วง ISO [ต้นวัน, ต้นวันถัดไป) */
export function dayRangeIso(from, to = from) {
  const start = new Date(`${from}T00:00:00+07:00`)
  const end = new Date(`${to}T00:00:00+07:00`)
  end.setUTCDate(end.getUTCDate() + 1)
  return [start.toISOString(), end.toISOString()]
}

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

/** สาขาที่ใช้กรองตอนอ่าน · staff/manager = สาขาตัวเอง · owner = ?branch_id= (ไม่ส่ง = ทุกสาขา → null) */
export function branchFilter(req) {
  if (req.user.role !== 'owner') return req.user.branchId
  const fromQuery = typeof req.query.branch_id === 'string' && UUID_RE.test(req.query.branch_id) ? req.query.branch_id : null
  return req.user.branchId || fromQuery
}

/** สาขาที่ใช้ตอนสร้าง: staff/manager = สาขาตัวเอง · owner ต้องส่ง branch_id */
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
