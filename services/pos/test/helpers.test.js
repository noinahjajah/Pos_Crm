// เทสต์ helpers ของ pos: สัญญากลาง + การแปลงรหัส POS:* + เงิน/วันที่เวลาไทย · ไม่ต้องมี DB/network
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runContract } from '../../_shared-test/contract.js'
import * as h from '../helpers.js'

runContract('pos', h)

const quiet = (fn) => {
  const o = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = o
  }
}

describe('pos: dbError แปลงรหัส POS:*', () => {
  test('รหัสที่รู้จัก → status/code ตามตาราง', () => {
    const cases = {
      'POS:ORDER_NOT_FOUND': 404,
      'POS:TABLE_NOT_AVAILABLE': 409,
      'POS:ORDER_NOT_OPEN': 409,
      'POS:APPROVAL_UNDELETABLE': 409,
      'POS:DISCOUNT_TOO_LARGE': 409,
      'POS:BAD_INPUT': 400,
    }
    for (const [msg, status] of Object.entries(cases)) {
      const e = h.dbError({ message: msg })
      assert.deepEqual([e.status, e.code], [status, msg.slice(4)], msg)
    }
  })
  test('ข้อความมีส่วนต่อท้ายก็จับได้ · รหัสที่ไม่รู้จัก → 500', () => {
    assert.equal(h.dbError({ message: 'POS:ORDER_EMPTY: no items' }).code, 'ORDER_EMPTY')
    assert.equal(quiet(() => h.dbError({ message: 'POS:NO_SUCH_CODE' })).status, 500)
  })
  test('23505 → 409 DUPLICATE · 23503/23514 → 400', () => {
    assert.equal(h.dbError({ code: '23505' }).code, 'DUPLICATE')
    assert.equal(h.dbError({ code: '23503' }).status, 400)
    assert.equal(h.dbError({ code: '23514', message: 'x' }).status, 400)
  })
})

describe('pos: เงินและวันที่', () => {
  test('money ปัด 2 ตำแหน่ง · round2', () => {
    assert.equal(h.money.parse(12.345), 12.35)
    assert.equal(h.round2('12.344'), 12.34)
    assert.equal(h.money.safeParse(-1).success, false)
  })
  test('dayRangeIso (เวลาไทย)', () => {
    assert.deepEqual(h.dayRangeIso('2026-11-20'), ['2026-11-19T17:00:00.000Z', '2026-11-20T17:00:00.000Z'])
    assert.deepEqual(h.dayRangeIso('2026-11-19', '2026-11-20'), ['2026-11-18T17:00:00.000Z', '2026-11-20T17:00:00.000Z'])
  })
  test('dateString รูปแบบ YYYY-MM-DD', () => {
    assert.equal(h.dateString.safeParse('2026-11-20').success, true)
    assert.equal(h.dateString.safeParse('20-11-2026').success, false)
  })
})
