// ตัวช่วยของ payment: ของกลางอยู่ใน ../shared.js · ที่นี่มีแค่ข้อความ error ของฐานข้อมูล payment

import { AppError, conflict, errorHandler as makeErrorHandler } from '../shared.js'

export * from '../shared.js'

export const errorHandler = makeErrorHandler()

/** แปลง error จาก Supabase เป็น AppError (ชื่อ constraint ตรงกับที่สร้างไว้ในขั้น S3) */
export function dbError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`
  if (error?.code === '23505') {
    if (text.includes('payments_idempotency_key_uk')) return conflict('IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key นี้ถูกใช้แล้ว')
    if (text.includes('payments_one_charge_per_order_uk')) return conflict('ORDER_ALREADY_PAID', 'บิลนี้ชำระเงินแล้ว')
    if (text.includes('payments_one_refund_per_approval_uk')) return conflict('ALREADY_REFUNDED', 'คำขอนี้คืนเงินไปแล้ว')
    return conflict('DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว')
  }
  console.error('[payment] database error:', error)
  return new AppError(500, 'DB_ERROR', 'ติดต่อฐานข้อมูลไม่สำเร็จ', [{ message: error?.message }])
}
