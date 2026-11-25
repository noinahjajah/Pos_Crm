// เทสต์ตรรกะรับเงิน/คืนเงินของ payment (1.23, 1.25, 1.28, 1.30) โดยสลับ db และ pos เป็นของจำลองในหน่วยความจำ
// ไม่ต้องมี Supabase/network · รัน: npm test (ต้องใช้ --experimental-test-module-mocks ตั้งไว้ใน npm test แล้ว)
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, mock, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import express from 'express'

const here = (f) => pathToFileURL(new URL(`../${f}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')).href

// ---------- db จำลอง: รองรับเฉพาะ query ที่ payments.js ใช้ ----------
const tables = { payments: [] }
let seq = 0
function query(table) {
  const f = { eq: [], is: [], in: [] }
  let op = 'select'
  let patch
  let row
  let single = null
  const q = {
    select: () => q,
    insert: (r) => ((op = 'insert'), (row = r), q),
    update: (p) => ((op = 'update'), (patch = p), q),
    eq: (c, v) => (f.eq.push([c, v]), q),
    is: (c, v) => (f.is.push([c, v]), q),
    in: (c, v) => (f.in.push([c, v]), q),
    gte: () => q,
    lt: () => q,
    order: () => q,
    limit: () => q,
    range: () => q,
    single: () => ((single = 'single'), q),
    maybeSingle: () => ((single = 'maybe'), q),
    then: (resolve, reject) => {
      try {
        resolve(exec())
      } catch (e) {
        reject(e)
      }
    },
  }
  const match = (r) => f.eq.every(([c, v]) => r[c] === v) && f.is.every(([c, v]) => (v === null ? r[c] == null : r[c] === v)) && f.in.every(([c, v]) => v.includes(r[c]))
  function exec() {
    const rows = tables[table]
    if (op === 'insert') {
      if (row.idempotency_key && rows.some((r) => r.idempotency_key === row.idempotency_key)) {
        return { data: null, error: { code: '23505', message: 'duplicate key' } }
      }
      const created = { id: `p-${++seq}`, paid_at: new Date().toISOString(), pos_synced_at: null, approval_id: null, cash_received: null, change_amount: null, idempotency_key: null, ...row }
      rows.push(created)
      return { data: single ? created : [created], error: null }
    }
    if (op === 'update') {
      const hit = rows.filter(match)
      hit.forEach((r) => Object.assign(r, patch))
      return { data: hit, error: null }
    }
    const hit = rows.filter(match)
    if (single === 'single') return { data: hit[0] ?? null, error: hit[0] ? null : { code: 'PGRST116', message: 'no rows' } }
    if (single === 'maybe') return { data: hit[0] ?? null, error: null }
    return { data: hit, error: null, count: hit.length }
  }
  return q
}
const fakeDb = { from: (t) => query(t) }
const fakeRun = async (q) => {
  const { data, error } = await q
  if (error) throw Object.assign(new Error(error.message), { code: error.code, status: 500 })
  return data
}

// ---------- pos จำลอง ----------
const BRANCH = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ORDER = 'e0000000-0000-4000-8000-000000000001'
const APPROVAL = 'f0000000-0000-4000-8000-000000000001'
let orders
let approvals
let posCalls
const fakePos = {
  getOrder: async (id) => orders.get(id) ?? null,
  getApproval: async (id) => approvals.get(id) ?? null,
  markPaid: async (id, body) => (posCalls.push(['markPaid', id, body]), orders.get(id) ? ((orders.get(id).status = 'paid'), orders.get(id)) : null),
  markRefunded: async (id, body) => (posCalls.push(['markRefunded', id, body]), orders.get(id) ?? null),
  listApprovedRefunds: async () => [...approvals.values()].filter((a) => a.type === 'refund' && a.status === 'approved'),
  listWaitingOrders: async () => [...orders.values()].filter((o) => o.status === 'waiting_payment'),
}

let server
let base
let currentUser

before(async () => {
  mock.module(here('db.js'), { namedExports: { db: fakeDb, run: fakeRun, supabase: {} } })
  mock.module(here('pos.js'), { namedExports: { pos: fakePos, posMode: 'mock', mockOrderList: [] } })
  const { paymentRouter, refundRouter } = await import(here('payments.js'))
  const { errorHandler } = await import(here('helpers.js'))
  const app = express()
  app.use(express.json())
  app.use((req, res, next) => ((req.user = currentUser), next()))
  app.use('/payments', paymentRouter)
  app.use('/refunds', refundRouter)
  app.use(errorHandler)
  await new Promise((r) => (server = app.listen(0, '127.0.0.1', r)))
  base = `http://127.0.0.1:${server.address().port}`
})
after(() => new Promise((r) => server.close(r)))

beforeEach(() => {
  tables.payments = []
  posCalls = []
  currentUser = { id: 'u-staff', role: 'staff', branchId: BRANCH }
  orders = new Map([[ORDER, { id: ORDER, order_no: 'B1', branch_id: BRANCH, status: 'waiting_payment', subtotal: 395, discount_amount: 39.5, vat_amount: 24.89, total: 380.39 }]])
  approvals = new Map([[APPROVAL, { id: APPROVAL, order_id: ORDER, branch_id: BRANCH, type: 'refund', status: 'approved', amount: 43.34, reason: 'x' }]])
})

const post = async (path, body, key = 'key-0001-abcdef') => {
  const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}
const pay = (extra = {}, key) => post('/payments', { order_id: ORDER, method: 'cash', cash_received: 400, ...extra }, key)

describe('POST /payments — เงินสด (1.23, 1.25)', () => {
  test('รับเงินสด: ทอน = รับ − ยอดสุทธิ · บันทึก 1 รายการ · แจ้ง pos', async () => {
    const r = await pay({ cash_received: 500 })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.change_amount, 119.61)
    assert.equal(r.body.data.payment.amount, 380.39)
    assert.equal(r.body.data.replayed, false)
    assert.equal(tables.payments.length, 1)
    assert.equal(posCalls[0][0], 'markPaid')
    assert.equal(posCalls[0][2].amount, 380.39)
    assert.equal(r.body.data.payment.order_status_synced, true)
  })
  test('จ่ายพอดี → ทอน 0', async () => {
    const r = await pay({ cash_received: 380.39 })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.change_amount, 0)
  })
  test('รับเงินไม่พอ → 400 CASH_NOT_ENOUGH ไม่บันทึกอะไร', async () => {
    const r = await pay({ cash_received: 380.38 })
    assert.equal(r.status, 400)
    assert.equal(r.body.error.code, 'CASH_NOT_ENOUGH')
    assert.equal(tables.payments.length, 0)
    assert.equal(posCalls.length, 0)
  })
  test('เงินสดแต่ไม่ส่ง cash_received → 400', async () => {
    const r = await post('/payments', { order_id: ORDER, method: 'cash' })
    assert.equal(r.status, 400)
  })
  test('PromptPay: สำเร็จทันที ไม่ต้องมี cash_received ไม่มีเงินทอน (1.25)', async () => {
    const r = await post('/payments', { order_id: ORDER, method: 'promptpay' })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.change_amount, null)
    assert.equal(r.body.data.payment.method, 'promptpay')
    assert.equal(r.body.data.payment.amount, 380.39)
  })
  test('บัตร (EDC): บันทึกเลขท้าย 4 หลัก + รหัสอนุมัติ (ตัวพิมพ์ใหญ่) ไม่มีเงินทอน · แจ้ง pos ด้วย method card', async () => {
    const r = await post('/payments', { order_id: ORDER, method: 'credit_card', card_last4: '4242', card_approval_code: ' ab12c3 ' })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.change_amount, null)
    assert.equal(r.body.data.payment.method, 'credit_card')
    assert.equal(r.body.data.payment.card_last4, '4242')
    assert.equal(r.body.data.payment.card_approval_code, 'AB12C3')
    assert.equal(r.body.data.payment.cash_received, null)
    assert.equal(posCalls[0][2].method, 'credit_card')
  })
  test('บัตรแต่ไม่ส่งเลขท้าย/รหัสอนุมัติ หรือรูปแบบผิด → 400 ไม่บันทึก', async () => {
    for (const extra of [{}, { card_last4: '4242' }, { card_approval_code: 'AB12' }, { card_last4: '424', card_approval_code: 'AB12' }, { card_last4: '4242424242424242', card_approval_code: 'AB12' }, { card_last4: '4242', card_approval_code: 'AB-12' }]) {
      const r = await post('/payments', { order_id: ORDER, method: 'credit_card', ...extra })
      assert.equal(r.status, 400, JSON.stringify(extra))
    }
    assert.equal(tables.payments.length, 0)
  })
  test('ส่งข้อมูลบัตรมากับเงินสด → ไม่บันทึกข้อมูลบัตร', async () => {
    const r = await pay({ cash_received: 500, card_last4: '4242', card_approval_code: 'AB12' })
    assert.equal(r.status, 201)
    assert.equal(r.body.data.payment.card_last4, null)
    assert.equal(r.body.data.payment.card_approval_code, null)
  })
  test('ยอดที่บันทึกมาจากบิลใน pos ไม่ใช่จากที่ client ส่งมา', async () => {
    const r = await pay({ amount: 1, total: 1, cash_received: 1000 })
    assert.equal(r.body.data.payment.amount, 380.39)
  })
})

describe('POST /payments — Idempotency-Key และสถานะบิล', () => {
  test('ไม่ส่ง / สั้นเกิน / อักขระแปลก Idempotency-Key → 400', async () => {
    for (const key of [null, 'short', 'has space in key!', 'x'.repeat(101)]) {
      const r = await pay({}, key)
      assert.equal(r.status, 400, String(key))
    }
    assert.equal(tables.payments.length, 0)
  })
  test('กดซ้ำด้วย key เดิม → ส่งผลเดิมกลับ (replayed) ไม่รับเงินซ้ำ', async () => {
    const a = await pay()
    const b = await pay()
    assert.equal(a.status, 201)
    assert.equal(b.status, 200)
    assert.equal(b.body.data.replayed, true)
    assert.equal(b.body.data.payment.id, a.body.data.payment.id)
    assert.equal(tables.payments.length, 1)
  })
  test('key เดิมแต่คนละบิล → 409 IDEMPOTENCY_KEY_REUSED', async () => {
    await pay()
    const r = await post('/payments', { order_id: 'e0000000-0000-4000-8000-000000000002', method: 'cash', cash_received: 999 })
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'IDEMPOTENCY_KEY_REUSED')
  })
  test('บิลจ่ายแล้ว ใช้ key ใหม่ → 409 ORDER_ALREADY_PAID', async () => {
    await pay()
    const r = await pay({}, 'key-0002-abcdef')
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'ORDER_ALREADY_PAID')
    assert.equal(tables.payments.length, 1)
  })
  test('บิลยังเปิดอยู่ (ยังไม่กดเรียกเก็บเงิน) → 409', async () => {
    orders.get(ORDER).status = 'open'
    const r = await pay()
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'ORDER_NOT_WAITING_PAYMENT')
  })
  test('ไม่พบบิล → 404', async () => {
    const r = await post('/payments', { order_id: 'e0000000-0000-4000-8000-0000000000ff', method: 'cash', cash_received: 1 })
    assert.equal(r.status, 404)
  })
  test('บิลของสาขาอื่น → 403 · owner รับเงินได้ทุกสาขา (คิดเงินจากผังโต๊ะ)', async () => {
    orders.get(ORDER).branch_id = OTHER
    assert.equal((await pay()).status, 403)
    currentUser = { id: 'o', role: 'owner', branchId: null }
    const r = await pay({}, 'key-0003-abcdef')
    assert.equal(r.status, 201)
    assert.equal(r.body.data.payment.branch_id, OTHER)
  })
  test('pos ล่ม: เงินยังบันทึกแล้ว (order_status_synced = false) เพื่อให้ syncPending ลองใหม่', async () => {
    fakePos.markPaid = async () => {
      throw new Error('pos down')
    }
    try {
      const r = await pay()
      assert.equal(r.status, 201)
      assert.equal(r.body.data.payment.order_status_synced, false)
      assert.equal(tables.payments.length, 1)
    } finally {
      fakePos.markPaid = async (id, body) => (posCalls.push(['markPaid', id, body]), orders.get(id) ? ((orders.get(id).status = 'paid'), orders.get(id)) : null)
    }
  }, { timeout: 10_000 })
})

describe('POST /refunds (1.28, 1.30)', () => {
  const charge = (amount = 380.39) => tables.payments.push({ id: 'c1', order_id: ORDER, branch_id: BRANCH, type: 'charge', amount, method: 'cash' })
  const refund = (body = { approval_id: APPROVAL, method: 'cash' }, key = 'rf-key-00001') => post('/refunds', body, key)

  test('คืนเงินตามคำขอที่อนุมัติแล้ว → 201 และแจ้ง pos', async () => {
    charge()
    const r = await refund()
    assert.equal(r.status, 201)
    assert.equal(r.body.data.payment.type, 'refund')
    assert.equal(r.body.data.payment.amount, 43.34)
    assert.equal(posCalls.at(-1)[0], 'markRefunded')
  })
  test('ยอดคืนมาจากคำขอ ไม่ใช่จาก client', async () => {
    charge()
    const r = await post('/refunds', { approval_id: APPROVAL, method: 'cash', amount: 9999 }, 'rf-key-00002')
    assert.equal(r.body.data.payment.amount, 43.34)
  })
  test('คำขอยัง pending / rejected → 409 APPROVAL_NOT_APPROVED (1.30)', async () => {
    charge()
    for (const status of ['pending', 'rejected']) {
      approvals.get(APPROVAL).status = status
      const r = await refund()
      assert.equal(r.status, 409, status)
      assert.equal(r.body.error.code, 'APPROVAL_NOT_APPROVED')
    }
    assert.equal(tables.payments.filter((p) => p.type === 'refund').length, 0)
  })
  test('คำขอที่ไม่ใช่คืนเงิน (ส่วนลด) → 409 NOT_A_REFUND', async () => {
    charge()
    approvals.get(APPROVAL).type = 'discount'
    assert.equal((await refund()).body.error.code, 'NOT_A_REFUND')
  })
  test('บิลยังไม่ได้ชำระ → 409 ORDER_NOT_PAID', async () => {
    assert.equal((await refund()).body.error.code, 'ORDER_NOT_PAID')
  })
  test('คืนซ้ำ: key เดิม = ผลเดิม (replayed) · key ใหม่ = 409 ALREADY_REFUNDED', async () => {
    charge()
    const a = await refund()
    const b = await refund()
    assert.equal(b.body.data.replayed, true)
    assert.equal(b.body.data.payment.id, a.body.data.payment.id)
    const c = await refund(undefined, 'rf-key-other1')
    assert.equal(c.status, 409)
    assert.equal(c.body.error.code, 'ALREADY_REFUNDED')
    assert.equal(tables.payments.filter((p) => p.type === 'refund').length, 1)
  })
  test('ยอดคืนรวมเกินที่จ่าย → 409 REFUND_EXCEEDS_PAID', async () => {
    charge(30) // จ่ายมา 30 แต่คำขอคืน 43.34
    const r = await refund()
    assert.equal(r.status, 409)
    assert.equal(r.body.error.code, 'REFUND_EXCEEDS_PAID')
  })
  test('คำขอของสาขาอื่น → 403 · ไม่พบคำขอ → 404', async () => {
    charge()
    approvals.get(APPROVAL).branch_id = OTHER
    assert.equal((await refund()).status, 403)
    assert.equal((await refund({ approval_id: 'f0000000-0000-4000-8000-0000000000ff', method: 'cash' }, 'rf-key-00003')).status, 404)
  })
  test('คืนเงินไม่เรียกคืนสต็อก: ไม่มีการเรียก restore ใดๆ ใน pos ที่ payment ใช้', () => {
    assert.equal(Object.keys(fakePos).some((k) => /restore|stock/i.test(k)), false)
  })
})

describe('GET /refunds/approved', () => {
  test('แสดงเฉพาะคำขอที่อนุมัติ + บิลจ่ายแล้ว + ยังไม่ได้คืน', async () => {
    tables.payments.push({ id: 'c1', order_id: ORDER, type: 'charge', amount: 380.39 })
    let r = await fetch(`${base}/refunds/approved`).then((x) => x.json())
    assert.equal(r.data.length, 1)
    assert.equal(r.data[0].amount, 43.34)
    tables.payments.push({ id: 'r1', order_id: ORDER, type: 'refund', approval_id: APPROVAL, amount: 43.34 })
    r = await fetch(`${base}/refunds/approved`).then((x) => x.json())
    assert.equal(r.data.length, 0)
  })
  test('บิลยังไม่จ่าย → ไม่แสดง', async () => {
    const r = await fetch(`${base}/refunds/approved`).then((x) => x.json())
    assert.equal(r.data.length, 0)
  })
})
