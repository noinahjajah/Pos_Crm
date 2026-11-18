// /users — พนักงาน (1.3, 1.5)
// manager ดูรายชื่อสาขาตัวเองได้อย่างเดียว · owner เพิ่ม/แก้/ลบ ทุกสาขา
// บัญชี login อยู่ใน Supabase Auth (อีเมล <username>@pos.local) · ข้อมูลพนักงานอยู่ใน identity1.profiles
// ลบ = soft delete (is_active = false) + แบนบัญชี (login/refresh ไม่ได้ทันที)
import { Router } from 'express'
import { db, emailOf, run, supabase } from './db.js'
import {
  AppError,
  allow,
  atLeastOne,
  badRequest,
  conflict,
  forbidden,
  fullName,
  idParam,
  notFound,
  parse,
  password,
  ROLE_NAMES,
  send,
  username,
  uuid,
  z,
} from './helpers.js'

const role = z.enum(ROLE_NAMES, { message: 'ตำแหน่งต้องเป็น staff, manager หรือ owner' })

const createSchema = z.object({
  username,
  password,
  full_name: fullName,
  role,
  branch_id: uuid.nullable().optional(),
})
const updateSchema = z
  .object({
    full_name: fullName.optional(),
    role: role.optional(),
    branch_id: uuid.nullable().optional(),
    password: password.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(atLeastOne, 'ต้องส่งอย่างน้อย 1 ช่อง')

const listQuery = z.object({
  branch_id: uuid.optional(),
  role: role.optional(),
  include_inactive: z.enum(['true', 'false']).optional(),
})

const BAN_FOREVER = '876000h' // ~100 ปี
const router = Router()

// ---------- ตัวช่วย ----------
let roleIds = null
async function roleIdOf(name) {
  roleIds ??= Object.fromEntries((await run(db.from('roles').select('id, name'))).map((r) => [r.name, r.id]))
  return roleIds[name]
}

const getUser = (id) => run(db.from('profiles_view').select('*').eq('id', id).maybeSingle())

/** owner ไม่มีสาขา · staff/manager ต้องมีสาขาที่ยังเปิดอยู่ */
async function branchForRole(roleName, branchId) {
  if (roleName === 'owner') return null
  if (!branchId) throw badRequest('กรุณาเลือกสาขา', [{ field: 'branch_id', message: 'พนักงานและผู้จัดการต้องมีสาขา' }])
  const branch = await run(db.from('branches').select('id, is_active').eq('id', branchId).maybeSingle())
  if (!branch || !branch.is_active) throw badRequest('สาขานี้ไม่มีหรือปิดไปแล้ว', [{ field: 'branch_id', message: 'เลือกสาขาที่เปิดอยู่' }])
  return branchId
}

async function setBanned(id, banned) {
  const { error } = await supabase.auth.admin.updateUserById(id, { ban_duration: banned ? BAN_FOREVER : 'none' })
  if (error) throw new AppError(502, 'AUTH_UPDATE_FAILED', 'อัปเดตสถานะบัญชีไม่สำเร็จ', [{ message: error.message }])
}

// ---------- GET /users — M O ----------
router.get('/', allow('manager', 'owner'), async (req, res) => {
  const q = parse(listQuery, req.query)
  let query = db.from('profiles_view').select('*').order('full_name')

  if (req.user.role === 'manager') {
    // manager เห็นเฉพาะสาขาตัวเอง และเฉพาะบัญชีที่ยังใช้งาน (1.3)
    query = query.eq('branch_id', req.user.branchId).eq('is_active', true)
  } else {
    if (q.branch_id) query = query.eq('branch_id', q.branch_id)
    if (q.include_inactive !== 'true') query = query.eq('is_active', true)
  }
  if (q.role) query = query.eq('role', q.role)

  send(res, await run(query))
})

// ---------- POST /users — O ----------
router.post('/', allow('owner'), async (req, res) => {
  const body = parse(createSchema, req.body)
  const branchId = await branchForRole(body.role, body.branch_id)
  const roleId = await roleIdOf(body.role)

  const taken = await run(db.from('profiles').select('id').eq('username', body.username).maybeSingle())
  if (taken) throw conflict('USERNAME_TAKEN', 'ชื่อผู้ใช้นี้มีอยู่แล้ว')

  // 1) บัญชี login
  const { data, error } = await supabase.auth.admin.createUser({
    email: emailOf(body.username),
    password: body.password,
    email_confirm: true,
  })
  if (error) {
    if (error.code === 'email_exists' || error.status === 422) throw conflict('USERNAME_TAKEN', 'ชื่อผู้ใช้นี้มีอยู่แล้ว')
    if (error.code === 'weak_password') throw badRequest('รหัสผ่านง่ายเกินไป', [{ field: 'password', message: error.message }])
    throw new AppError(502, 'AUTH_CREATE_FAILED', 'สร้างบัญชีไม่สำเร็จ', [{ message: error.message }])
  }

  // 2) profile — ถ้าไม่สำเร็จ ลบบัญชี login ทิ้ง ไม่ให้มีบัญชีค้างที่ไม่มี profile
  try {
    await run(
      db.from('profiles').insert({
        id: data.user.id,
        username: body.username,
        full_name: body.full_name,
        role_id: roleId,
        branch_id: branchId,
      }),
    )
  } catch (err) {
    await supabase.auth.admin.deleteUser(data.user.id).catch(() => {})
    throw err
  }

  send(res, await getUser(data.user.id), { status: 201 })
})

// ---------- PATCH /users/:id — O ----------
router.patch('/:id', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  const body = parse(updateSchema, req.body)
  const current = await getUser(id)
  if (!current) throw notFound('ไม่พบผู้ใช้', 'USER_NOT_FOUND')

  const isSelf = id === req.user.id
  if (isSelf && body.role && body.role !== current.role) throw forbidden('เปลี่ยนตำแหน่งของตัวเองไม่ได้', 'CANNOT_CHANGE_OWN_ROLE')
  if (isSelf && body.is_active === false) throw forbidden('ปิดบัญชีของตัวเองไม่ได้', 'CANNOT_DISABLE_SELF')

  const update = {}
  if (body.full_name !== undefined) update.full_name = body.full_name
  if (body.role !== undefined || body.branch_id !== undefined) {
    const nextRole = body.role ?? current.role
    const nextBranch = body.branch_id !== undefined ? body.branch_id : current.branch_id
    update.role_id = await roleIdOf(nextRole)
    update.branch_id = await branchForRole(nextRole, nextBranch)
  }
  if (body.is_active !== undefined) update.is_active = body.is_active

  if (Object.keys(update).length) await run(db.from('profiles').update(update).eq('id', id))

  if (body.password) {
    const { error } = await supabase.auth.admin.updateUserById(id, { password: body.password })
    if (error) throw badRequest('ตั้งรหัสผ่านไม่สำเร็จ', [{ field: 'password', message: error.message }])
  }
  if (body.is_active !== undefined && body.is_active !== current.is_active) await setBanned(id, !body.is_active)

  send(res, await getUser(id))
})

// ---------- DELETE /users/:id — O (soft delete + แบน) ----------
router.delete('/:id', allow('owner'), async (req, res) => {
  const { id } = parse(idParam, req.params)
  if (id === req.user.id) throw forbidden('ลบบัญชีของตัวเองไม่ได้', 'CANNOT_DELETE_SELF')
  const current = await getUser(id)
  if (!current) throw notFound('ไม่พบผู้ใช้', 'USER_NOT_FOUND')

  await run(db.from('profiles').update({ is_active: false }).eq('id', id))
  await setBanned(id, true)
  send(res, await getUser(id))
})

export default router
