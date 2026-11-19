// เทสต์ helpers ของ catalog (ไม่ต้องมี DB/network) · รัน: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runContract } from '../../_shared-test/contract.js'
import * as h from '../helpers.js'

runContract('catalog', h)

const quiet = (fn) => {
  const o = console.error
  console.error = () => {}
  try {
    return fn()
  } finally {
    console.error = o
  }
}

describe('catalog: dbError แปลงรหัสจากฐานข้อมูล', () => {
  test('CATALOG:* → ข้อผิดพลาดที่ถูกต้อง', () => {
    assert.equal(h.dbError({ message: 'CATALOG:NOT_FOUND' }).status, 404)
    assert.equal(h.dbError({ message: 'CATALOG:SAME_BRANCH' }).code, 'SAME_BRANCH')
    assert.equal(h.dbError({ message: 'CATALOG:NEGATIVE_STOCK' }).code, 'NEGATIVE_STOCK')
    assert.equal(h.dbError({ message: 'CATALOG:GROUP_BRANCH_MISMATCH' }).status, 400)
  })
  test('23505 ซ้ำ → 409 · 23503 อ้างถึงไม่มี → 400', () => {
    assert.equal(h.dbError({ code: '23505' }).code, 'DUPLICATE')
    assert.equal(h.dbError({ code: '23503' }).status, 400)
  })
  test('เปิดขายตอนสต็อก 0 (stocks_open_needs_quantity) → 409 STOCK_EMPTY (1.15)', () => {
    const e = h.dbError({ code: '23514', message: 'violates check constraint "stocks_open_needs_quantity"' })
    assert.deepEqual([e.status, e.code], [409, 'STOCK_EMPTY'])
  })
  test('error อื่น → 500 DB_ERROR', () => {
    const e = quiet(() => h.dbError({ message: 'boom' }))
    assert.deepEqual([e.status, e.code], [500, 'DB_ERROR'])
  })
})

describe('catalog: money', () => {
  test('ปัด 2 ตำแหน่ง ไม่ติดลบ ไม่เกิน 999,999.99', () => {
    assert.equal(h.money.parse(12.345), 12.35)
    assert.equal(h.money.parse(0), 0)
    assert.equal(h.money.safeParse(-0.01).success, false)
    assert.equal(h.money.safeParse(1_000_000).success, false)
    assert.equal(h.money.safeParse('50').success, false) // ต้องเป็นตัวเลข
  })
})
