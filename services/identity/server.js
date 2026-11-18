// identity service :3001 (Dev 1) — จุดเริ่มต้น รันด้วย npm run dev
// gateway ตัด /api/v1/identity ออกก่อนส่งมา เช่น /api/v1/identity/me → /me
import 'dotenv/config'
import express from 'express'
import authRouter from './auth.js'
import branchesRouter from './branches.js'
import { db, SCHEMA } from './db.js'
import { checkInternalKey, errorHandler, notFound } from './helpers.js'
import { meRouter, rolesRouter } from './me.js'
import usersRouter from './users.js'

const PORT = Number(process.env.PORT || 3001)
const INTERNAL_KEY = process.env.INTERNAL_KEY
if (!INTERNAL_KEY) throw new Error('ยังไม่ได้ใส่ INTERNAL_KEY ในไฟล์ .env')

const app = express()
app.disable('x-powered-by')
app.set('query parser', 'simple')

// เช็กว่า service ยังทำงานและต่อฐานข้อมูลได้ (ไม่ต้องใช้ key)
// ใช้ GET (ไม่ใช้ head) เพื่อให้ Supabase ส่งข้อความ error กลับมาด้วย
const checkDb = async () => {
  const { error } = await db.from('roles').select('id').limit(1)
  return error ? `${error.code || ''} ${error.message || ''} ${error.hint || ''}`.trim() || 'unknown error' : null
}

app.get('/health', async (req, res) => {
  const problem = await checkDb()
  res.status(problem ? 503 : 200).json({ status: problem ? 'db_error' : 'ok', service: 'identity', schema: SCHEMA, db: problem ?? 'connected' })
})

app.use(checkInternalKey(INTERNAL_KEY))
app.use(express.json({ limit: '100kb' }))

app.use('/auth', authRouter)
app.use('/me', meRouter)
app.use('/roles', rolesRouter)
app.use('/branches', branchesRouter)
app.use('/users', usersRouter)

app.use((req, res, next) => next(notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND')))
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`[identity] เปิดที่ http://localhost:${PORT} (schema ${SCHEMA})`)
  const problem = await checkDb()
  console.log(problem ? `[identity] ❌ ต่อ Supabase ไม่ได้: ${problem}` : '[identity] ✅ ต่อ Supabase แล้ว')
})
