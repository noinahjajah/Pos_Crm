// pos service :3003 (Dev 3) — โต๊ะ บิล สั่งอาหาร จอครัว ส่วนลด/คืนเงิน · รันด้วย npm run dev
// gateway ตัด /api/v1/pos ออกก่อนส่งมา เช่น /api/v1/pos/orders → /orders · ตารางอยู่ใน schema orders
import express from 'express'
import { requestRouter, approvalRouter } from './approvals.js'
import { db } from './db.js'
import { checkInternalKey, dbError, errorHandler, notFound } from './helpers.js'
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

// เช็กว่า service ยังทำงานและต่อฐานข้อมูลได้ (ไม่ต้องใช้ key)
app.get('/health', async (req, res) => {
  const { error } = await db.from('dining_tables').select('id', { head: true, count: 'exact' })
  res.status(error ? 503 : 200).json({ status: error ? 'db_error' : 'ok', service: 'pos', db: error ? dbError(error).message : 'connected' })
})

app.use(checkInternalKey(INTERNAL_KEY))
app.use(express.json({ limit: '100kb' }))

app.use('/tables', tables)
app.use('/orders', orders)
app.use('/orders', requestRouter)
app.use('/kitchen', kitchen)
app.use('/approvals', approvalRouter)
app.use('/internal', internal)

app.use((req, res, next) => next(notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND')))
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`[pos] เปิดที่ http://localhost:${PORT}`)
  const { error } = await db.from('dining_tables').select('id', { head: true, count: 'exact' })
  console.log(error ? `[pos] ❌ ${dbError(error).message}` : '[pos] ✅ ต่อ Supabase แล้ว')
})
