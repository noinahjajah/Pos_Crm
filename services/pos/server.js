// pos service :3003 (Dev 3) — จุดเริ่มต้น รันด้วย npm run dev
// gateway ตัด /api/v1/pos ออกก่อนส่งมา เช่น /api/v1/pos/tables → /tables
import 'dotenv/config'
import express from 'express'
import approvals from './approvals.js'
import { db } from './db.js'
import { streamCount } from './events.js'
import { checkInternalKey, errorHandler, notFound } from './helpers.js'
import internal from './internal.js'
import kitchen from './kitchen.js'
import orders from './orders.js'
import tables from './tables.js'

const PORT = Number(process.env.PORT || 3003)
const INTERNAL_KEY = process.env.INTERNAL_KEY
if (!INTERNAL_KEY) throw new Error('ยังไม่ได้ใส่ INTERNAL_KEY ในไฟล์ .env')

const app = express()
app.disable('x-powered-by')
app.set('query parser', 'simple')

const checkDb = async () => {
  const { error } = await db.from('dining_tables').select('id').limit(1)
  return error ? `${error.code || ''} ${error.message || ''}`.trim() || 'unknown error' : null
}

// เช็กว่า service ยังทำงานและต่อฐานข้อมูลได้ (ไม่ต้องใช้ key)
app.get('/health', async (req, res) => {
  const problem = await checkDb()
  res.status(problem ? 503 : 200).json({ status: problem ? 'db_error' : 'ok', service: 'pos', db: problem ?? 'connected', streams: streamCount() })
})

app.use(checkInternalKey(INTERNAL_KEY))
app.use(express.json({ limit: '200kb' }))

app.use('/tables', tables)
app.use('/orders', orders)
app.use('/kitchen', kitchen)
app.use('/approvals', approvals)
app.use('/internal', internal)

app.use((req, res, next) => next(notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND')))
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`[pos] เปิดที่ http://localhost:${PORT}`)
  const problem = await checkDb()
  console.log(problem ? `[pos] ❌ ต่อ Supabase ไม่ได้: ${problem} (เพิ่ม schema pos ใน Exposed schemas แล้วหรือยัง?)` : '[pos] ✅ ต่อ Supabase แล้ว')
})
