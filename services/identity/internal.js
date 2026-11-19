// /internal — ให้ service อื่นเรียกผ่าน X-Internal-Key เท่านั้น (gateway บล็อก /internal/* จากข้างนอก)
import { Router } from 'express'
import { db, run } from './db.js'
import { badRequest, idParam, notFound, parse, send } from './helpers.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const router = Router()

// GET /internal/branches/:id — catalog/payment ใช้ตรวจว่าสาขามีจริงใน identity1
router.get('/branches/:id', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const branch = await run(db.from('branches').select('id, code, name, is_active').eq('id', id).maybeSingle())
  if (!branch) throw notFound('ไม่พบสาขา', 'BRANCH_NOT_FOUND')
  send(res, branch)
})

// GET /internal/users?ids=a,b,c — pos ใช้แสดงชื่อพนักงานในบิล/ตั๋วครัว/คำขออนุมัติ (ไม่เกิน 100 คน · รวมคนที่ปิดบัญชีแล้ว)
router.get('/users', async (req, res) => {
  const ids = [...new Set(String(req.query.ids || '').split(',').map((s) => s.trim()).filter(Boolean))]
  if (ids.length === 0) return send(res, [])
  if (ids.length > 100 || ids.some((id) => !UUID_RE.test(id))) throw badRequest('ids ต้องเป็น uuid คั่นด้วย , ไม่เกิน 100 ตัว')
  const rows = await run(db.from('profiles').select('id, username, full_name, branch_id, is_active').in('id', ids))
  send(res, rows)
})

export default router
