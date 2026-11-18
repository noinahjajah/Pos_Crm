// /internal — ให้ service อื่นเรียกผ่าน X-Internal-Key เท่านั้น (gateway บล็อก /internal/* จากข้างนอก)
import { Router } from 'express'
import { db, run } from './db.js'
import { idParam, notFound, parse, send } from './helpers.js'

const router = Router()

// GET /internal/branches/:id — catalog/payment ใช้ตรวจว่าสาขามีจริงใน identity1
router.get('/branches/:id', async (req, res) => {
  const { id } = parse(idParam, req.params)
  const branch = await run(db.from('branches').select('id, code, name, is_active').eq('id', id).maybeSingle())
  if (!branch) throw notFound('ไม่พบสาขา', 'BRANCH_NOT_FOUND')
  send(res, branch)
})

export default router
