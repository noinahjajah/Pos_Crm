// unit test ของ events.js (SSE แจ้งเตือนอนุมัติ 1.29) — ไม่ต้องมี DB/network
// รัน: node --test services/pos/test/events.test.js
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'
import { approvalStream, publishApproval, streamCount } from '../events.js'

const BRANCH_A = 'a0000000-0000-4000-8000-00000000000a'
const BRANCH_B = 'b0000000-0000-4000-8000-00000000000b'

/** จำลอง req/res ของ express ให้พอสำหรับ approvalStream */
function connect(user) {
  const req = new EventEmitter()
  req.user = user
  const res = {
    headers: {},
    chunks: [],
    flushed: false,
    status(code) {
      this.code = code
      return this
    },
    set(h) {
      Object.assign(this.headers, h)
      return this
    },
    flushHeaders() {
      this.flushed = true
    },
    write(s) {
      this.chunks.push(s)
    },
  }
  approvalStream(req, res)
  return { req, res, text: () => res.chunks.join('') }
}

const approval = (branch_id, id = 'ap-1') => ({ id, branch_id, type: 'discount', status: 'pending' })

test('เปิด stream: ส่ง header SSE และข้อความ connected', () => {
  const c = connect({ id: 'm1', role: 'manager', branchId: BRANCH_A })
  assert.equal(c.res.code, 200)
  assert.match(c.res.headers['Content-Type'], /text\/event-stream/)
  assert.equal(c.res.headers['X-Accel-Buffering'], 'no')
  assert.ok(c.res.flushed)
  assert.match(c.text(), /^: connected/)
  c.req.emit('close')
})

test('manager ได้เฉพาะคำขอของสาขาตัวเอง · owner ได้ทุกสาขา', () => {
  const mA = connect({ id: 'm1', role: 'manager', branchId: BRANCH_A })
  const mB = connect({ id: 'm2', role: 'manager', branchId: BRANCH_B })
  const owner = connect({ id: 'o1', role: 'owner', branchId: null })

  publishApproval(approval(BRANCH_A, 'ap-A'))

  assert.match(mA.text(), /event: approval\ndata: .*"ap-A"/)
  assert.doesNotMatch(mB.text(), /ap-A/)
  assert.match(owner.text(), /ap-A/)

  for (const c of [mA, mB, owner]) c.req.emit('close')
})

test('staff ไม่ได้รับแจ้งเตือน แม้จะมี stream ค้างอยู่ (กันรั่ว)', () => {
  const staff = connect({ id: 's1', role: 'staff', branchId: BRANCH_A })
  publishApproval(approval(BRANCH_A, 'ap-staff'))
  assert.doesNotMatch(staff.text(), /ap-staff/)
  staff.req.emit('close')
})

test('รูปแบบข้อความ: event + data เป็น JSON { approval } จบด้วยบรรทัดว่าง', () => {
  const m = connect({ id: 'm1', role: 'manager', branchId: BRANCH_A })
  publishApproval(approval(BRANCH_A, 'ap-fmt'))
  const msg = m.text().split('\n\n').find((s) => s.startsWith('event: approval'))
  assert.ok(msg, 'ต้องมีข้อความ event: approval')
  const data = JSON.parse(msg.split('\n')[1].replace(/^data: /, ''))
  assert.equal(data.approval.id, 'ap-fmt')
  assert.ok(m.text().endsWith('\n\n'))
  m.req.emit('close')
})

test('ปิด stream แล้วเลิกส่ง และลบออกจากรายการผู้ฟัง', () => {
  const before = streamCount()
  const m = connect({ id: 'm1', role: 'manager', branchId: BRANCH_A })
  assert.equal(streamCount(), before + 1)
  m.req.emit('close')
  assert.equal(streamCount(), before)
  publishApproval(approval(BRANCH_A, 'ap-after-close'))
  assert.doesNotMatch(m.text(), /ap-after-close/)
})

test('ผู้ฟังหลายเครื่องของ manager คนเดียวกันได้ครบทุกเครื่อง', () => {
  const user = { id: 'm1', role: 'manager', branchId: BRANCH_A }
  const a = connect(user)
  const b = connect(user)
  publishApproval(approval(BRANCH_A, 'ap-multi'))
  assert.match(a.text(), /ap-multi/)
  assert.match(b.text(), /ap-multi/)
  a.req.emit('close')
  b.req.emit('close')
})
