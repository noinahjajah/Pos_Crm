// ต่อ Supabase (schema pos) — ใช้ service_role key ฝั่ง server เท่านั้น
// ต้องเพิ่ม pos ใน Supabase → Settings → API → Exposed schemas ด้วย (เหมือน catalog/payment)
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { dbError } from './helpers.js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  throw new Error('ยังไม่ได้ใส่ SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ในไฟล์ .env')
}

export const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

/** ตารางใน schema pos เช่น db.from('orders') */
export const db = supabase.schema('pos')

/** รัน query แล้วคืน data ถ้าฐานข้อมูลตอบ error ให้โยนเป็น AppError */
export async function run(query) {
  const { data, error } = await query
  if (error) throw dbError(error)
  return data
}

/** เรียกฟังก์ชันในฐานข้อมูล (atomic) เช่น rpc('open_order', {...}) */
export const rpc = (fn, args) => run(db.rpc(fn, args))
