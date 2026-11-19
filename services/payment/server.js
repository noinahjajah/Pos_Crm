// payment service :3004 (Dev 2) — จุดเริ่มต้น รันด้วย npm run dev
// gateway ตัด /api/v1/payment ออกก่อนส่งมา เช่น /api/v1/payment/payments → /payments
import express from 'express'
import { db } from './db.js'
import { checkInternalKey, errorHandler, notFound } from './helpers.js'
import { paymentRouter, refundRouter, syncPending } from './payments.js'
import expenses from './expenses.js'
import reports from './reports.js'

const PORT = Number(process.env.PORT || 3004)
const INTERNAL_KEY = process.env.INTERNAL_KEY
if (!INTERNAL_KEY) throw new Error('ยังไม่ได้ใส่ INTERNAL_KEY ในไฟล์ .env')

const app = express()
app.disable('x-powered-by')
app.set('query parser', 'simple')

// เช็กว่า service ยังทำงานและต่อฐานข้อมูลได้ (ไม่ต้องใช้ key)
app.get('/health', async (req, res) => {
  const { error } = await db.from('payments').select('id', { head: true, count: 'exact' })
  res.status(error ? 503 : 200).json({ status: error ? 'db_error' : 'ok', service: 'payment', db: error?.message ?? 'connected' })
})

app.use(checkInternalKey(INTERNAL_KEY))
app.use(express.json({ limit: '100kb' }))

app.use('/payments', paymentRouter)
app.use('/refunds', refundRouter)
app.use('/expenses', expenses)
app.use('/reports', reports)

app.use((req, res, next) => next(notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND')))
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`[payment] เปิดที่ http://localhost:${PORT}`)
  const { error } = await db.from('payments').select('id', { head: true, count: 'exact' })
  console.log(error ? `[payment] ❌ ต่อ Supabase ไม่ได้: ${error.message}` : '[payment] ✅ ต่อ Supabase แล้ว')
})

// แจ้ง pos ซ้ำทุก 30 วินาที สำหรับการรับ/คืนเงินที่บันทึกแล้วแต่อัปเดตบิลไม่สำเร็จ
setInterval(() => syncPending().catch(() => {}), 30_000).unref()
