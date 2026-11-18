// /auth — login / refresh / logout (1.2)
// login ด้วย username + password → แปลงเป็นอีเมล <username>@pos.local แล้วให้ Supabase Auth ตรวจ
// token ที่ได้มี user_role + branch_id จาก hook (identity1.custom_access_token_hook)
import { Router } from 'express'
import { authClient, db, EMAIL_DOMAIN, emailOf, run, supabase } from './db.js'
import { AppError, allow, forbidden, parse, send, unauthorized, username, z } from './helpers.js'

// พิมพ์อีเมลเต็มมา (owner@pos.local) ก็รับ — ตัดโดเมนออกเหลือ username
const loginName = z.preprocess((v) => {
  if (typeof v !== 'string') return v
  const suffix = `@${EMAIL_DOMAIN}`
  const trimmed = v.trim()
  return trimmed.toLowerCase().endsWith(suffix) ? trimmed.slice(0, -suffix.length) : trimmed
}, username)
const loginSchema = z.object({ username: loginName, password: z.string().min(1, 'กรุณากรอกรหัสผ่าน') })
const refreshSchema = z.object({ refresh_token: z.string().min(1, 'ไม่มี refresh_token') })

const router = Router()

/** แปลง error ของ Supabase Auth เป็นข้อความที่หน้าเว็บแสดงได้ */
function authError(error) {
  const code = error?.code || ''
  if (code === 'invalid_credentials' || code === 'invalid_grant' || error?.status === 400) {
    return unauthorized('ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', 'INVALID_CREDENTIALS')
  }
  if (code === 'refresh_token_not_found' || code === 'refresh_token_already_used' || code === 'session_not_found') {
    return unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่', 'SESSION_EXPIRED')
  }
  if (code === 'user_banned') return forbidden('บัญชีนี้ถูกปิดใช้งาน', 'ACCOUNT_DISABLED')
  if (code === 'email_not_confirmed') return forbidden('บัญชียังไม่ได้ยืนยัน กรุณาติดต่อเจ้าของร้าน', 'ACCOUNT_NOT_CONFIRMED')
  // hook ปฏิเสธ (บัญชีถูกลบ / สาขาปิด) — ข้อความมาจาก hook
  if (error?.status === 403 || error?.status === 422 || code === 'unexpected_failure') {
    return forbidden(error.message || 'ไม่สามารถเข้าสู่ระบบได้', 'ACCOUNT_DISABLED')
  }
  console.error('[identity] auth error:', error)
  return new AppError(502, 'AUTH_UNAVAILABLE', 'ระบบยืนยันตัวตนไม่ตอบสนอง กรุณาลองใหม่')
}

const tokenPayload = (session) => ({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  token_type: session.token_type,
  expires_in: session.expires_in,
  expires_at: session.expires_at,
})

// POST /auth/login — public
router.post('/login', async (req, res) => {
  const body = parse(loginSchema, req.body)
  const client = authClient()
  const { data, error } = await client.auth.signInWithPassword({ email: emailOf(body.username), password: body.password })
  if (error) throw authError(error)

  // หน้า POS ใช้ได้เฉพาะบัญชีพนักงาน (มี profile ที่ยังใช้งาน) — ไม่มี profile = ไม่ให้ token
  const profile = await run(db.from('profiles_view').select('*').eq('id', data.user.id).maybeSingle())
  if (!profile || !profile.is_active) {
    await supabase.auth.admin.signOut(data.session.access_token, 'local').catch(() => {})
    throw forbidden('บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบ POS', 'NO_PROFILE')
  }

  send(res, { ...tokenPayload(data.session), user: profile })
})

// POST /auth/refresh — public
router.post('/refresh', async (req, res) => {
  const body = parse(refreshSchema, req.body)
  const { data, error } = await authClient().auth.refreshSession({ refresh_token: body.refresh_token })
  if (error || !data.session) throw authError(error)
  send(res, tokenPayload(data.session))
})

// POST /auth/logout — ยกเลิก session ปัจจุบัน (refresh token ใช้ต่อไม่ได้)
router.post('/logout', allow('staff', 'manager', 'owner'), async (req, res) => {
  const token = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') || '')?.[1]
  if (token) await supabase.auth.admin.signOut(token, 'local').catch(() => {})
  res.status(204).end()
})

export default router
