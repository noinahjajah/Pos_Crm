// catalog service :3002 (Dev 2) — จุดเริ่มต้น รันด้วย npm run dev
// gateway ตัด /api/v1/catalog ออกก่อนส่งมา เช่น /api/v1/catalog/menus → /menus
import express from 'express'
import { db } from './db.js'
import { checkInternalKey, errorHandler, notFound } from './helpers.js'
import categories from './categories.js'
import menus from './menus.js'
import { optionGroupRouter, optionRouter } from './optionGroups.js'
import stocks from './stocks.js'
import internal from './internal.js'

const PORT = Number(process.env.PORT || 3002)
const INTERNAL_KEY = process.env.INTERNAL_KEY
if (!INTERNAL_KEY) throw new Error('ยังไม่ได้ใส่ INTERNAL_KEY ในไฟล์ .env')

const app = express()
app.disable('x-powered-by')
app.set('query parser', 'simple')

// เช็กว่า service ยังทำงานและต่อฐานข้อมูลได้ (ไม่ต้องใช้ key)
app.get('/health', async (req, res) => {
  const { error } = await db.from('categories').select('id', { head: true, count: 'exact' })
  res.status(error ? 503 : 200).json({ status: error ? 'db_error' : 'ok', service: 'catalog', db: error?.message ?? 'connected' })
})

app.use(checkInternalKey(INTERNAL_KEY))
app.use(express.json({ limit: '4mb' })) // รูปเมนูแบบ base64 ไม่เกิน 2MB

app.use('/categories', categories)
app.use('/menus', menus)
app.use('/option-groups', optionGroupRouter)
app.use('/options', optionRouter)
app.use('/stocks', stocks)
app.use('/internal', internal)

app.use((req, res, next) => next(notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND')))
app.use(errorHandler)

app.listen(PORT, async () => {
  console.log(`[catalog] เปิดที่ http://localhost:${PORT}`)
  const { error } = await db.from('categories').select('id', { head: true, count: 'exact' })
  console.log(error ? `[catalog] ❌ ต่อ Supabase ไม่ได้: ${error.message}` : '[catalog] ✅ ต่อ Supabase แล้ว')
})
