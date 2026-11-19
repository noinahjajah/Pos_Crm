// ทดสอบ service pos แบบ end-to-end กับ Postgres + PostgREST จริง (ไม่ใช้ Supabase จริง)
// - proxy :3100/rest/v1 → PostgREST :3199 (เลียนแบบ Supabase)
// - identity stub :3101 · catalog stub :3102 (เมนู/สต็อกในหน่วยความจำ)
// - รัน services/pos/server.js ที่ :3103 แล้วยิง HTTP ตาม flow จริง
//
// วิธีรัน (PowerShell ที่ root ของโปรเจกต์ · ต้องมี Docker):
//   docker network create pos-it
//   docker run -d --rm --name pos-it-db --network pos-it -e POSTGRES_PASSWORD=test -v "${PWD}\supabase:/sql:ro" postgres:16-alpine
//   docker exec -w /sql/tests pos-it-db psql -U postgres -v ON_ERROR_STOP=1 -q -f pos_stub.sql -f ../migrations/20261119000300_pos.sql
//   docker run -d --rm --name pos-it-rest --network pos-it -p 127.0.0.1:3199:3000 -e PGRST_DB_URI=postgres://postgres:test@pos-it-db:5432/postgres `
//     -e PGRST_DB_SCHEMAS=pos -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET=pos-integration-test-secret-0123456789abcdef postgrest/postgrest:v12.2.3
//   node services/pos/test/e2e.mjs "$PWD\services\pos"
//   docker stop pos-it-rest pos-it-db; docker network rm pos-it
// รันซ้ำบนฐานเดิม: ล้างข้อมูลก่อน (truncate ตาราง pos ทั้งหมด) หรือสร้าง container ใหม่
import { spawn } from 'node:child_process'
import { createHmac, randomUUID } from 'node:crypto'
import http from 'node:http'

const SECRET = 'pos-integration-test-secret-0123456789abcdef'
const KEY = 'it-internal-key'
const POS_DIR = process.argv[2]
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload) => {
  const h = b64({ alg: 'HS256', typ: 'JWT' })
  const p = b64(payload)
  return `${h}.${p}.${createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
const SERVICE_KEY = jwt({ role: 'service_role', iss: 'it', exp: Math.floor(Date.now() / 1000) + 3600 })

const BRANCH = '00000000-0000-4000-8000-00000000000a'
const OTHER_BRANCH = '00000000-0000-4000-8000-00000000000b'
const STAFF = '00000000-0000-4000-8000-0000000000f1'
const MANAGER = '00000000-0000-4000-8000-0000000000a1'
const OWNER = '00000000-0000-4000-8000-0000000000c0'
const RICE = '00000000-0000-4000-8000-0000000000e1'
const TEA = '00000000-0000-4000-8000-0000000000e2'
const EGG = '00000000-0000-4000-8000-0000000000d1'

// ---------- stubs ----------
const readBody = (req) => new Promise((r) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => r(s ? JSON.parse(s) : {})) })
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) }

const proxy = http.createServer((req, res) => {
  if (!req.url.startsWith('/rest/v1')) return json(res, 404, {})
  const up = http.request({ host: '127.0.0.1', port: 3199, path: req.url.slice('/rest/v1'.length) || '/', method: req.method, headers: { ...req.headers, host: '127.0.0.1:3199' } }, (r) => {
    res.writeHead(r.statusCode, r.headers)
    r.pipe(res)
  })
  req.pipe(up)
})

const NAMES = { [STAFF]: 'สมศรี', [MANAGER]: 'วิชัย', [OWNER]: 'คุณกิตติ' }
const identity = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (url.pathname === '/internal/users') {
    const ids = (url.searchParams.get('ids') || '').split(',')
    return json(res, 200, { data: ids.filter((id) => NAMES[id]).map((id) => ({ id, full_name: NAMES[id], username: id.slice(-4) })) })
  }
  if (url.pathname.startsWith('/internal/branches/')) return json(res, 200, { data: { id: url.pathname.split('/').pop(), is_active: true } })
  json(res, 404, {})
})

const MENUS = {
  [RICE]: { name: 'ข้าวผัดกุ้ง', price: 80, options: { [EGG]: { name: 'ไข่ดาว', extra_price: 10 } } },
  [TEA]: { name: 'ชาไทยเย็น', price: 45, options: {} },
}
const stock = { [RICE]: 10, [TEA]: 3 }
const deducted = new Map() // reference → items
const catalog = http.createServer(async (req, res) => {
  const body = await readBody(req)
  if (req.url === '/internal/menus/lookup') {
    const items = body.items.map((i) => {
      const m = MENUS[i.menu_id]
      const opts = i.option_ids.map((id) => ({ option_id: id, name: m.options[id].name, extra_price: m.options[id].extra_price }))
      return { menu_id: i.menu_id, name: m.name, price: m.price, options: opts, unit_price: m.price + opts.reduce((s, o) => s + o.extra_price, 0) }
    })
    return json(res, 200, { data: { items } })
  }
  if (req.url === '/internal/stocks/deduct') {
    if (deducted.has(body.reference)) return json(res, 200, { data: { replayed: true } })
    const short = body.items.filter((i) => stock[i.menu_id] < i.quantity)
    if (short.length) return json(res, 409, { error: { code: 'STOCK_NOT_ENOUGH', message: 'หมด', details: short } })
    body.items.forEach((i) => (stock[i.menu_id] -= i.quantity))
    deducted.set(body.reference, body.items)
    return json(res, 200, { data: { replayed: false } })
  }
  if (req.url === '/internal/stocks/restore') {
    const items = deducted.get(body.reference) || []
    items.forEach((i) => (stock[i.menu_id] += i.quantity))
    deducted.set(body.reference, [])
    return json(res, 200, { data: { replayed: false } })
  }
  json(res, 404, {})
})

await Promise.all([[proxy, 3100], [identity, 3101], [catalog, 3102]].map(([s, p]) => new Promise((r) => s.listen(p, '127.0.0.1', r))))

// ---------- pos service ----------
const pos = spawn(process.execPath, ['server.js'], {
  cwd: POS_DIR,
  env: { ...process.env, PORT: '3103', INTERNAL_KEY: KEY, SUPABASE_URL: 'http://127.0.0.1:3100', SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, IDENTITY_URL: 'http://127.0.0.1:3101', CATALOG_URL: 'http://127.0.0.1:3102' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let posLog = ''
pos.stdout.on('data', (d) => (posLog += d))
pos.stderr.on('data', (d) => (posLog += d))
for (let i = 0; i < 50; i++) {
  if (posLog.includes('ต่อ Supabase')) break
  await new Promise((r) => setTimeout(r, 200))
}

// ---------- ยิง HTTP ----------
const as = (user) => async (method, path, body, extra = {}) => {
  const headers = { 'Content-Type': 'application/json', 'X-Internal-Key': KEY, ...extra }
  if (user) Object.assign(headers, { 'X-User-Id': user.id, 'X-User-Role': user.role, 'X-Branch-Id': user.branch || '' })
  const res = await fetch(`http://127.0.0.1:3103${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const staff = as({ id: STAFF, role: 'staff', branch: BRANCH })
const manager = as({ id: MANAGER, role: 'manager', branch: BRANCH })
const otherManager = as({ id: randomUUID(), role: 'manager', branch: OTHER_BRANCH })
const owner = as({ id: OWNER, role: 'owner' })
const internal = as(null)

let failed = 0
const check = (cond, name, detail) => {
  if (cond) console.log('ok  ', name)
  else {
    failed++
    console.log('FAIL', name, detail !== undefined ? JSON.stringify(detail).slice(0, 400) : '')
  }
}

try {
  let r = await fetch('http://127.0.0.1:3103/health').then((x) => x.json())
  check(r.status === 'ok', 'health ต่อฐานข้อมูลได้', r)
  r = await as(null)('GET', '/tables', null, { 'X-Internal-Key': 'wrong' })
  check(r.status === 401, 'key ผิด → 401')

  // โต๊ะ
  for (const [no, zone] of [['T1', 'โซนในร้าน'], ['T2', 'โซนในร้าน'], ['T10', 'โซนในร้าน'], ['O1', 'โซนด้านนอก']]) {
    r = await manager('POST', '/tables', { table_no: no, seats: 4, zone })
    check(r.status === 201, `manager เพิ่มโต๊ะ ${no}`, r.body)
  }
  r = await manager('POST', '/tables', { table_no: 't1' })
  check(r.status === 409 && r.body.error.code === 'TABLE_NO_DUPLICATE', 'ชื่อโต๊ะซ้ำ (ไม่สนตัวพิมพ์) → 409', r.body)
  r = await staff('POST', '/tables', { table_no: 'X' })
  check(r.status === 403, 'staff เพิ่มโต๊ะไม่ได้')
  r = await staff('GET', '/tables')
  const tables = Object.fromEntries(r.body.data.map((t) => [t.table_no, t]))
  check(r.body.data.map((t) => t.table_no).join(',') === 'T1,T2,T10,O1', 'เรียงตามโซนแล้วเลขโต๊ะแบบธรรมชาติ', r.body.data.map((t) => `${t.zone}/${t.table_no}`))

  // เปิดโต๊ะ + สั่ง
  r = await staff('POST', '/orders', { table_ids: [tables.T1.id], guest_count: 3 })
  check(r.status === 201 && r.body.data.opened_by_name === 'สมศรี' && r.body.data.tables[0].table_no === 'T1', 'เปิดโต๊ะ + ชื่อผู้เปิด', r.body)
  const order = r.body.data
  r = await staff('POST', '/orders', { table_ids: [tables.T1.id], guest_count: 2 })
  check(r.status === 409 && r.body.error.code === 'TABLE_NOT_AVAILABLE', 'เปิดโต๊ะซ้อน → 409', r.body)

  const key1 = randomUUID()
  r = await staff('POST', `/orders/${order.id}/tickets`, { items: [{ menu_id: RICE, quantity: 2, option_ids: [EGG] }, { menu_id: TEA, quantity: 1, note: 'หวานน้อย' }] }, { 'Idempotency-Key': key1 })
  check(r.status === 201 && r.body.data.round_no === 1 && r.body.data.items.length === 2 && r.body.data.order_no, 'สั่งรอบ 1 → ข้อมูลพิมพ์ใบออร์เดอร์', r.body)
  check(stock[RICE] === 8 && stock[TEA] === 2, 'ตัดสต็อกที่ catalog', stock)
  r = await staff('POST', `/orders/${order.id}/tickets`, { items: [{ menu_id: RICE, quantity: 2, option_ids: [EGG] }, { menu_id: TEA, quantity: 1 }] }, { 'Idempotency-Key': key1 })
  check(r.status === 201 && stock[RICE] === 8, 'ส่งซ้ำ key เดิม → ไม่สั่ง/ไม่ตัดซ้ำ', { status: r.status, stock })
  r = await staff('POST', `/orders/${order.id}/tickets`, { items: [{ menu_id: TEA, quantity: 5 }] })
  check(r.status === 409 && r.body.error.code === 'STOCK_NOT_ENOUGH', 'สต็อกไม่พอ → 409', r.body)
  r = await staff('POST', `/orders/${order.id}/tickets`, { items: [{ menu_id: TEA, quantity: 2 }] })
  check(r.status === 201 && r.body.data.round_no === 2, 'สั่งรอบ 2', r.body)

  r = await staff('GET', `/orders/${order.id}`)
  const o = r.body.data
  // (80+10)×2 + 45 + 45×2 = 315 · VAT 22.05 · 337.05
  check(o.subtotal === 315 && o.vat_amount === 22.05 && o.total === 337.05 && o.tickets.length === 2, 'ยอดบิล + VAT 7%', o)
  check(o.tickets[0].items[0].line_total === 180 && o.tickets[0].items[0].options[0].option_name === 'ไข่ดาว', 'รายการ + ตัวเลือก + line_total', o.tickets[0].items)
  r = await otherManager('GET', `/orders/${order.id}`)
  check(r.status === 403, 'manager สาขาอื่นดูบิลไม่ได้')

  r = await staff('GET', '/tables')
  const t1 = r.body.data.find((t) => t.table_no === 'T1')
  check(t1.status === 'occupied' && t1.order.item_count === 5 && t1.order.subtotal === 315, 'ผังโต๊ะแสดงบิลที่ใช้อยู่', t1)

  // ย้าย + รวมโต๊ะ
  r = await staff('POST', `/orders/${order.id}/tables/move`, { from_table_id: tables.T1.id, to_table_id: tables.T2.id })
  check(r.status === 200 && r.body.data.tables.map((t) => t.table_no).join() === 'T2', 'ย้ายโต๊ะ T1 → T2', r.body)
  r = await staff('POST', '/orders', { table_ids: [tables.T10.id], guest_count: 2 })
  const o2 = r.body.data
  await staff('POST', `/orders/${o2.id}/tickets`, { items: [{ menu_id: RICE, quantity: 1 }] })
  r = await staff('POST', `/orders/${order.id}/tables/merge`, { table_ids: [tables.T10.id] })
  check(r.status === 200 && r.body.data.guest_count === 5 && r.body.data.subtotal === 395 && r.body.data.tables.length === 2, 'รวมโต๊ะ T2 + T10', r.body)

  // ยกเลิกบิลเปล่า
  r = await staff('POST', '/orders', { table_ids: [tables.O1.id], guest_count: 1 })
  r = await staff('POST', `/orders/${r.body.data.id}/cancel`)
  check(r.status === 200 && r.body.data.status === 'cancelled', 'ยกเลิกบิลที่เปิดผิด', r.body)

  // จอครัว
  r = await staff('GET', '/kitchen/tickets')
  check(r.status === 200 && r.body.data.length === 3 && r.body.data[0].tables.length > 0, 'จอครัวเห็นตั๋วค้าง 3 ใบ', r.body)
  const tk = r.body.data[0].id
  r = await staff('PATCH', `/kitchen/tickets/${tk}`, { status: 'served' })
  check(r.status === 200 && r.body.data.status === 'served', 'เสิร์ฟแล้ว', r.body)
  r = await staff('PATCH', `/kitchen/tickets/${tk}`, { status: 'preparing' })
  check(r.status === 400, 'ย้อนสถานะไม่ได้', r.body)

  // SSE + ส่วนลด
  const sse = await fetch('http://127.0.0.1:3103/approvals/stream', { headers: { 'X-Internal-Key': KEY, 'X-User-Id': MANAGER, 'X-User-Role': 'manager', 'X-Branch-Id': BRANCH } })
  const reader = sse.body.pipeThrough(new TextDecoderStream()).getReader()
  let sseText = ''
  const pump = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; sseText += value } })()
  r = await staff('GET', `/approvals/stream`)
  check(r.status === 403, 'staff เปิด stream ไม่ได้')

  r = await staff('POST', `/orders/${order.id}/approvals`, { type: 'discount', value_type: 'percent', value: 10, reason: 'ลูกค้าประจำ' })
  check(r.status === 201 && r.body.data.amount === 39.5 && r.body.data.requested_by_name === 'สมศรี' && r.body.data.request_no && r.body.data.order_subtotal === 395, 'ขอส่วนลด 10%', r.body)
  const disc = r.body.data
  await new Promise((x) => setTimeout(x, 300))
  check(sseText.includes('event: approval') && sseText.includes(disc.id), 'SSE แจ้ง manager ทันที', sseText.slice(0, 200))
  r = await manager('POST', `/orders/${order.id}/approvals`, { type: 'discount', value: 5, reason: 'x' })
  check(r.status === 403, 'manager ส่งคำขอเองไม่ได้ (spec: S)')
  r = await staff('GET', '/approvals?status=pending')
  check(r.body.data.length === 1, 'staff เห็นคำขอของตัวเอง')
  r = await otherManager('POST', `/approvals/${disc.id}/approve`, {})
  check(r.status === 403, 'manager สาขาอื่นอนุมัติไม่ได้')
  r = await manager('POST', `/approvals/${disc.id}/approve`, { note: 'โอเค' })
  check(r.status === 200 && r.body.data.status === 'approved' && r.body.data.approved_by_name === 'วิชัย' && r.body.data.note === 'โอเค', 'manager อนุมัติ', r.body)
  r = await staff('GET', `/orders/${order.id}`)
  check(r.body.data.discount_amount === 39.5 && r.body.data.total === 380.39, 'ส่วนลดเข้าบิล ยอดใหม่ 380.39', r.body.data)

  // เรียกเก็บเงิน + payment (internal)
  r = await internal('POST', `/internal/orders/${order.id}/mark-paid`, { payment_id: randomUUID(), method: 'cash', amount: 380.39, paid_by: STAFF })
  check(r.status === 409 && r.body.error.code === 'ORDER_NOT_WAITING_PAYMENT', 'ยังไม่เรียกเก็บเงิน → payment รับเงินไม่ได้', r.body)
  r = await staff('POST', `/orders/${order.id}/request-payment`)
  check(r.status === 200 && r.body.data.status === 'waiting_payment', 'เรียกเก็บเงิน', r.body)
  r = await internal('GET', `/internal/orders?status=waiting_payment&branch_id=${BRANCH}`)
  check(r.status === 200 && r.body.data.length === 1 && r.body.data[0].table_no === 'T10, T2' || r.body.data[0]?.table_no === 'T2, T10', 'payment เห็นบิลรอชำระ', r.body)
  r = await internal('GET', `/internal/orders/${order.id}/summary`)
  check(r.body.data.total === 380.39 && r.body.data.items.length === 4 && r.body.data.items[0].line_total, 'summary สำหรับ payment', r.body.data)
  const payId = randomUUID()
  r = await internal('POST', `/internal/orders/${order.id}/mark-paid`, { payment_id: payId, method: 'cash', amount: 380.39, paid_by: STAFF, paid_at: new Date().toISOString() })
  check(r.status === 200 && r.body.data.status === 'paid', 'mark-paid', r.body)
  r = await internal('POST', `/internal/orders/${order.id}/mark-paid`, { payment_id: payId, method: 'cash', amount: 380.39, paid_by: STAFF })
  check(r.status === 200, 'mark-paid ซ้ำ (payment ลองใหม่) → ไม่ error')
  r = await staff('GET', '/tables')
  check(r.body.data.every((t) => t.status === 'available'), 'จ่ายแล้วโต๊ะว่างทั้งหมด (1.26)', r.body.data.map((t) => t.status))
  r = await internal('GET', `/internal/orders/${randomUUID()}/summary`)
  check(r.status === 404, 'บิลไม่มี → 404 (payment แปลงเป็น null)')

  // คืนเงิน
  r = await staff('GET', '/orders?status=paid&date=' + new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10))
  check(r.body.data.length === 1 && r.body.data[0].payment_method === 'cash' && r.body.data[0].paid_at, 'รายการบิลจ่ายแล้ววันนี้ (หน้าขอคืนเงิน)', r.body)
  const teaItem = o.tickets[1].items[0]
  r = await staff('POST', `/orders/${order.id}/approvals`, { type: 'refund', value: 1, reason: 'ไม่ได้รับเครื่องดื่ม', refund_items: [{ order_item_id: teaItem.id, quantity: 1 }] })
  check(r.status === 201 && r.body.data.amount === 43.34 && r.body.data.refund_items[0].menu_name === 'ชาไทยเย็น', 'ขอคืนเงิน 1 แก้ว = 43.34', r.body)
  const ref = r.body.data
  await owner('POST', `/approvals/${ref.id}/approve`, {})
  r = await internal('GET', `/internal/approvals?type=refund&status=approved&branch_id=${BRANCH}`)
  check(r.body.data.length === 1 && r.body.data[0].id === ref.id, 'payment เห็นคำขอคืนเงินที่ต้องคืน', r.body)
  r = await internal('GET', `/internal/approvals/${ref.id}`)
  check(r.body.data.status === 'approved' && r.body.data.branch_id === BRANCH, 'payment อ่านคำขอ', r.body)
  r = await internal('POST', `/internal/orders/${order.id}/mark-refunded`, { payment_id: randomUUID(), approval_id: ref.id, amount: 43.34 })
  check(r.status === 200 && r.body.data.status === 'refunded' && r.body.data.refunded_amount === 43.34, 'mark-refunded', r.body)
  r = await internal('GET', `/internal/approvals?type=refund&status=approved&branch_id=${BRANCH}`)
  check(r.body.data.length === 0, 'คืนแล้วไม่ค้างในรายการ', r.body)
  check(stock[TEA] === 0, 'คืนเงินไม่คืนสต็อก (1.28)', stock)

  // รายงาน
  r = await internal('GET', `/internal/reports/top-menus?branch_id=${BRANCH}`)
  check(r.status === 200 && r.body.data[0]?.menu_name && typeof r.body.data[0].quantity === 'number', 'เมนูขายดีให้ payment', r.body)
  r = await owner('GET', '/approvals')
  check(r.body.data.length === 2, 'owner เห็นคำขอทุกสาขา')

  await reader.cancel()
  await pump.catch(() => {})
} catch (err) {
  failed++
  console.log('FAIL exception', err)
}

console.log(failed ? `\n${failed} FAILED` : '\nALL SERVICE TESTS PASSED')
if (failed) console.log('--- pos log ---\n' + posLog.slice(-3000))
pos.kill()
for (const s of [proxy, identity, catalog]) s.close()
process.exit(failed ? 1 : 0)
