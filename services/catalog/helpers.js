// ตัวช่วยของ catalog: ของกลางอยู่ใน ../shared/ · ที่นี่มีแค่ข้อความ error ของฐานข้อมูล catalog

import { AppError, badRequest, conflict, notFound, errorHandler as makeErrorHandler } from '../shared/index.js'

export * from '../shared/index.js'

export const errorHandler = makeErrorHandler()

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
