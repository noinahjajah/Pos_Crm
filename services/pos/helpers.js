// ตัวช่วยของ pos: ของกลางอยู่ใน ../shared/ · ที่นี่มีแค่ข้อความ error ของฐานข้อมูล orders

import { AppError, badRequest, conflict, errorHandler as makeErrorHandler, notFound } from '../shared/index.js'

export * from '../shared/index.js'

export const errorHandler = makeErrorHandler()

// รหัสที่ฟังก์ชัน/trigger ใน supabase/migrations/*_orders_pos.sql ส่งมา → สถานะ HTTP
const CODES = {
  ORDER_NOT_FOUND: 404,
  TABLE_NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  ORDER_EMPTY: 409,
  TABLE_BUSY: 409,
  TABLE_INACTIVE: 409,
  TABLE_NOT_IN_ORDER: 409,
  ORDER_NOT_OPEN: 409,
  ORDER_CLOSED: 409,
  ORDER_HAS_ITEMS: 409,
  ORDER_ALREADY_PAID: 409,
  ORDER_NOT_PAID: 409,
  ORDER_NOT_WAITING_PAYMENT: 409,
  INVALID_STATUS: 409,
  REFUND_EXCEEDS_TOTAL: 409,
  APPROVAL_DECIDED: 409,
  APPROVAL_IMMUTABLE: 409,
  APPROVAL_UNDELETABLE: 409,
  BRANCH_MISMATCH: 403,
}

/** แปลง error จาก Supabase เป็น AppError */
export function dbError(error) {
  const text = `${error?.message || ''}`
  const m = text.match(/^([A-Z_]+): (.*)$/s)
  if (m && CODES[m[1]]) return new AppError(CODES[m[1]], m[1], m[2])
  if (error?.code === '23505') {
    if (text.includes('dining_tables_branch_table_no_uk')) {
      return conflict('TABLE_NO_TAKEN', 'มีโต๊ะเลขนี้ในสาขาแล้ว', [{ field: 'table_no', message: 'มีโต๊ะเลขนี้ในสาขาแล้ว' }])
    }
    if (text.includes('order_tables_active_table_uk')) return conflict('TABLE_BUSY', 'โต๊ะนี้มีบิลเปิดอยู่แล้ว')
    return conflict('DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว')
  }
  if (error?.code === '23514') return badRequest('ข้อมูลไม่ถูกต้อง')
  if (error?.code === 'PGRST116') return notFound()
  if (error?.code === 'PGRST106' || error?.code === 'PGRST205' || text.includes('Invalid schema')) {
    return new AppError(503, 'POS_NOT_READY', 'ยังไม่ได้สร้างตารางของ pos ใน Supabase (รัน supabase/migrations/*_orders_pos.sql)')
  }
  console.error('[pos] database error:', error)
  return new AppError(500, 'DB_ERROR', 'ติดต่อฐานข้อมูลไม่สำเร็จ', [{ message: error?.message }])
}
