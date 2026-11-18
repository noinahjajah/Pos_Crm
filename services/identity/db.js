// ต่อ Supabase (schema identity1) — ใช้ service_role key ฝั่ง server เท่านั้น
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { dbError } from './helpers.js'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  throw new Error('ยังไม่ได้ใส่ SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ในไฟล์ .env')
}

export const SCHEMA = process.env.IDENTITY_SCHEMA || 'identity1'
export const EMAIL_DOMAIN = process.env.LOGIN_EMAIL_DOMAIN || 'pos.local'

const options = { auth: { persistSession: false, autoRefreshToken: false } }

/** client หลัก: อ่าน/เขียนตาราง + auth.admin (สร้าง/แก้/แบนผู้ใช้) */
export const supabase = createClient(url, key, options)

/** ตารางใน schema identity1 เช่น db.from('profiles') */
export const db = supabase.schema(SCHEMA)

/**
 * client ใหม่ต่อ 1 request สำหรับ login/refresh
 * (signInWithPassword เก็บ session ไว้ใน client — ไม่ใช้ client หลักกันปนกันระหว่างผู้ใช้)
 */
export const authClient = () => createClient(url, key, options)

/** username → อีเมลที่ใช้ใน Supabase Auth */
export const emailOf = (username) => `${username}@${EMAIL_DOMAIN}`

/** รัน query แล้วคืน data ถ้าฐานข้อมูลตอบ error ให้โยนเป็น AppError */
export async function run(query) {
  const { data, error } = await query
  if (error) throw dbError(error)
  return data
}
