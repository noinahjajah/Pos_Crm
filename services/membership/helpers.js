// ตัวช่วยของ membership: ของกลางอยู่ใน ../shared/ · ที่นี่มีแค่ข้อความ error ของฐานข้อมูล membership

import { AppError, badRequest, conflict, errorHandler as makeErrorHandler, notFound } from '../shared/index.js'

export * from '../shared/index.js'

export const errorHandler = makeErrorHandler()

/** แปลง error จาก Supabase เป็น AppError */
export function dbError(error) {
  const text = `${error?.message || ''} ${error?.details || ''}`
  if (text.includes('MEMBERSHIP:NOT_FOUND')) return notFound('ไม่พบสมาชิก หรือสมาชิกถูกปิดแล้ว', 'MEMBER_NOT_FOUND')
  if (text.includes('MEMBERSHIP:NOT_ENOUGH_POINTS')) return conflict('NOT_ENOUGH_POINTS', 'แต้มไม่พอ')
  if (error?.code === '23505' && text.includes('phone')) {
    return conflict('PHONE_TAKEN', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว', [{ field: 'phone', message: 'เบอร์นี้เป็นสมาชิกอยู่แล้ว' }])
  }
  if (error?.code === '23505') return conflict('DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว')
  if (error?.code === '23514') return badRequest('ข้อมูลไม่ถูกต้อง')
  if (error?.code === 'PGRST106' || text.includes('Invalid schema')) {
    return new AppError(
      503,
      'MEMBERSHIP_NOT_READY',
      'ระบบสมาชิกยังไม่เปิดใช้: เจ้าของโปรเจค Supabase ต้องเพิ่ม membership ใน Integrations → Data API → Settings → Exposed schemas',
    )
  }
  console.error('[membership] database error:', error)
  return new AppError(500, 'DB_ERROR', 'ติดต่อฐานข้อมูลไม่สำเร็จ', [{ message: error?.message }])
}
