// ต่อ Supabase (schema catalog) — ใช้ service_role key ฝั่ง server เท่านั้น

import { AppError, badRequest, dbError, serviceClient } from './helpers.js'

export const supabase = serviceClient()

/** ตารางใน schema catalog เช่น db.from('menus') */
export const db = supabase.schema('catalog')

/** รัน query แล้วคืน data ถ้าฐานข้อมูลตอบ error ให้โยนเป็น AppError */
export async function run(query) {
  const { data, error } = await query
  if (error) throw dbError(error)
  return data
}

// ---------- รูปเมนู (Supabase Storage) ----------
const BUCKET = process.env.MENU_IMAGE_BUCKET || 'menu-images'
const IMAGE_EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** image = { data: base64 หรือ data URL, content_type } → URL ของรูป */
export async function uploadImage(branchId, image) {
  const ext = IMAGE_EXT[image.content_type]
  const buffer = Buffer.from(image.data.replace(/^data:[^;]+;base64,/, ''), 'base64')
  if (!ext || !buffer.length) throw badRequest('รูปไม่ถูกต้อง (รองรับ jpeg, png, webp)')
  if (buffer.length > 2 * 1024 * 1024) throw badRequest('รูปต้องไม่เกิน 2MB')
  const path = `${branchId}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET).upload(path, buffer, { contentType: image.content_type })
  if (error) throw new AppError(502, 'IMAGE_UPLOAD_FAILED', 'อัปโหลดรูปไม่สำเร็จ', [{ message: error.message }])
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}
