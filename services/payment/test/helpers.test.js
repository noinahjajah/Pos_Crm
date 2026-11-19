// เทสต์ helpers ของ payment: เงิน วันที่ (เวลาไทย) ช่วงวันที่ · ไม่ต้องมี DB/network · รัน: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runContract } from '../../_shared-test/contract.js'
import * as h from '../helpers.js'

runContract('payment', h)

describe('payment: round2 / money', () => {
  test('round2 ปัดครึ่งขึ้น ไม่เพี้ยนจาก floating point', () => {
    assert.equal(h.round2(1.005), 1.01)
    assert.equal(h.round2(0.1 + 0.2), 0.3)
    assert.equal(h.round2('107.004'), 107)
    assert.equal(h.round2(380.385), 380.39)
    assert.equal(h.round2(0), 0)
  })
  test('เงินทอน = รับ − ยอด ไม่เหลือเศษทศนิยมแปลก', () => {
    assert.equal(h.round2(500 - 337.05), 162.95)
    assert.equal(h.round2(100 - 99.99), 0.01)
  })
  test('money: ปัด 2 ตำแหน่ง · ติดลบ/ไม่ใช่ตัวเลข ถูกปฏิเสธ', () => {
    assert.equal(h.money.parse(10.999), 11)
    assert.equal(h.money.safeParse(-1).success, false)
    assert.equal(h.money.safeParse(Number.NaN).success, false)
  })
})

describe('payment: วันที่เวลาไทย', () => {
  test('todayTh = วันตามเวลา UTC+7 (รูปแบบ YYYY-MM-DD)', () => {
    assert.match(h.todayTh(), /^\d{4}-\d{2}-\d{2}$/)
  })
  test('dayRangeIso: 1 วัน = [00:00+07, 00:00 วันถัดไป) เป็น UTC', () => {
    assert.deepEqual(h.dayRangeIso('2026-11-20', '2026-11-20'), ['2026-11-19T17:00:00.000Z', '2026-11-20T17:00:00.000Z'])
  })
  test('dayRangeIso: หลายวัน และข้ามสิ้นปี', () => {
    assert.deepEqual(h.dayRangeIso('2026-12-30', '2026-12-31'), ['2026-12-29T17:00:00.000Z', '2026-12-31T17:00:00.000Z'])
  })
  test('dateString: ปฏิเสธรูปแบบผิดและวันที่ไม่มีจริง', () => {
    assert.equal(h.dateString.safeParse('2026-11-20').success, true)
    for (const bad of ['20/11/2026', '2026-1-2', '2026-13-45', '', 'abc']) assert.equal(h.dateString.safeParse(bad).success, false, bad)
  })
  test('dateRange: ระบุ from+to ตามนั้น', () => {
    assert.deepEqual(h.dateRange({ from: '2026-11-01', to: '2026-11-20' }), { from: '2026-11-01', to: '2026-11-20' })
  })
  test('dateRange: ไม่ส่ง + defaultToday → วันนี้วันเดียว · ไม่ใช่ defaultToday → ต้นเดือนถึงวันนี้', () => {
    const today = h.todayTh()
    assert.deepEqual(h.dateRange({}, { defaultToday: true }), { from: today, to: today })
    assert.deepEqual(h.dateRange({}), { from: `${today.slice(0, 7)}-01`, to: today })
  })
  test('dateRange: from > to และช่วงเกิน 1 ปี → 400', () => {
    assert.throws(() => h.dateRange({ from: '2026-11-20', to: '2026-11-01' }), (e) => e.status === 400)
    assert.throws(() => h.dateRange({ from: '2024-01-01', to: '2026-01-01' }), (e) => e.status === 400)
  })
})
