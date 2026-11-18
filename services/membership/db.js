// ต่อ Supabase (schema membership) — ใช้ service_role key ฝั่ง server เท่านั้น

import { dbError, serviceClient } from './helpers.js'

export const supabase = serviceClient()

/** ตารางใน schema membership เช่น db.from('customers') */
export const db = supabase.schema('membership')

/** รัน query แล้วคืน data ถ้าฐานข้อมูลตอบ error ให้โยนเป็น AppError */
export async function run(query) {
  const { data, error } = await query
  if (error) throw dbError(error)
  return data
}
