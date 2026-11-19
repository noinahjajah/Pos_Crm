// ต่อ Supabase (schema orders) — ใช้ service_role key ฝั่ง server เท่านั้น

import { dbError, serviceClient } from './helpers.js'

export const supabase = serviceClient()

/** ตารางใน schema orders เช่น db.from('dining_tables') */
export const db = supabase.schema('orders')

/** รัน query แล้วคืน data ถ้าฐานข้อมูลตอบ error ให้โยนเป็น AppError */
export async function run(query) {
  const { data, error } = await query
  if (error) throw dbError(error)
  return data
}
