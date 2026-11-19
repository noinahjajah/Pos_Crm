// /me และ /roles
import { Router } from 'express'
import { db, run } from './db.js'
import { allow, forbidden, send } from './helpers.js'

export const meRouter = Router()

// GET /me — ข้อมูลตัวเอง role สาขา ใช้ซ่อน/แสดงเมนูหน้าเว็บ (1.2)
meRouter.get('/', allow('staff', 'manager', 'owner'), async (req, res) => {
  const me = await run(db.from('profiles_view').select('*').eq('id', req.user.id).maybeSingle())
  if (!me || !me.is_active) throw forbidden('บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบ', 'NO_PROFILE')
  send(res, me)
})

export const rolesRouter = Router()

// GET /roles — M O
rolesRouter.get('/', allow('manager', 'owner'), async (req, res) => {
  send(res, await run(db.from('roles').select('id, name').order('id')))
})
