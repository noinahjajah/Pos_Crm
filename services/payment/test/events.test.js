// เทสต์ SSE แดชบอร์ด (events.js): ใครได้เหตุการณ์ของสาขาไหน · ไม่ต้องมี DB/network · รัน: npm test
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { describe, test } from 'node:test'
import { publishReport, reportStream, streamCount } from '../events.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

/** เปิด stream จำลอง 1 เส้น → { written, close } */
function open(user) {
  const req = new EventEmitter()
  req.user = user
  const written = []
  const res = {
    status() {
      return this
    },
    set() {
      return this
    },
    flushHeaders() {},
    write(chunk) {
      written.push(chunk)
    },
  }
  reportStream(req, res)
  const events = () => written.filter((w) => w.startsWith('event: report')).map((w) => JSON.parse(w.split('data: ')[1]))
  return { events, close: () => req.emit('close') }
}

describe('payment: realtime แดชบอร์ด (SSE)', () => {
  test('owner ได้ทุกสาขา · manager ได้เฉพาะสาขาตัวเอง', () => {
    const owner = open({ role: 'owner', branchId: null })
    const managerA = open({ role: 'manager', branchId: A })
    const managerB = open({ role: 'manager', branchId: B })

    publishReport('charge', A)
    publishReport('expense', B)

    assert.deepEqual(owner.events().map((e) => [e.kind, e.branch_id]), [['charge', A], ['expense', B]])
    assert.deepEqual(managerA.events().map((e) => e.kind), ['charge'])
    assert.deepEqual(managerB.events().map((e) => e.kind), ['expense'])
    assert.ok(owner.events()[0].at, 'มีเวลาที่เกิดเหตุการณ์')

    for (const c of [owner, managerA, managerB]) c.close()
    assert.equal(streamCount(), 0, 'ปิดแล้วต้องเลิกฟัง')
  })

  test('staff ไม่ได้เหตุการณ์ · ไม่มีสาขา = ไม่ส่ง', () => {
    const staff = open({ role: 'staff', branchId: A })
    const owner = open({ role: 'owner', branchId: null })
    publishReport('refund', A)
    publishReport('refund', null)
    assert.equal(staff.events().length, 0)
    assert.equal(owner.events().length, 1)
    staff.close()
    owner.close()
  })
})
