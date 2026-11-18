// membership service :3005 — สมาชิกลูกค้า ระดับ แต้ม · รันด้วย npm run dev
// gateway ตัด /api/v1/membership ออกก่อนส่งมา เช่น /api/v1/membership/customers → /customers
import express from 'express'
import { db } from './db.js'
import { checkInternalKey, dbError, errorHandler, notFound } from './helpers.js'
import { customers, tiers } from './members.js'
import internal from './internal.js'

const PORT = Number(process.env.PORT || 3005)
const INTERNAL_KEY = process.env.INTERNAL_KEY
if (!INTERNAL_KEY) throw new Error('ยังไม่ได้ใส่ INTERNAL_KEY ในไฟล์ .env')

const app = express()
app.disable('x-powered-by')
app.set('query parser', 'simple')

// เช็กว่า service ยังทำงานและต่อฐานข้อมูลได้ (ไม่ต้องใช้ key)
app.get('/health', async (req, res) => {
  const { error } = await db.from('membership_tiers').select('id', { head: true, count: 'exact' })
  res.status(error ? 503 : 200).json({ status: error ? 'db_error' : 'ok', service: 'membership', db: error ? dbError(error).message : 'connected' })
})

app.use(checkInternalKey(INTERNAL_KEY))
app.use(express.json({ limit: '50kb' }))

app.use('/customers', customers)
app.use('/tiers', tiers)
app.use('/internal', internal)

app.use((req, res, next) => next(notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND')))
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`[membership] เปิดที่ http://localhost:${PORT}`)
  const { error } = await db.from('membership_tiers').select('id', { head: true, count: 'exact' })
  console.log(error ? `[membership] ❌ ${dbError(error).message}` : '[membership] ✅ ต่อ Supabase แล้ว')
})
