// เทสต์ helpers ของ identity (ไม่ต้องมี DB/network) · รัน: npm test
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { runContract } from '../../_shared-test/contract.js'
import * as h from '../helpers.js'

// identity ไม่มี branchFilter/branchForCreate (จัดการสาขาเอง)
runContract('identity', h, { branch: false })

describe('identity: ตรวจข้อมูลผู้ใช้', () => {
  test('ROLE_NAMES มีแค่ 3 role (staff, manager, owner) ไม่มี waiter/cashier', () => {
    assert.deepEqual(h.ROLE_NAMES, ['staff', 'manager', 'owner'])
  })

  test('username: ตัดช่องว่าง แปลงเป็นตัวเล็ก', () => {
    assert.equal(h.username.parse('  Staff.R01 '), 'staff.r01')
  })
  test('username: สั้น/ยาวเกิน/มีอักขระต้องห้าม ถูกปฏิเสธ', () => {
    for (const bad of ['ab', 'a'.repeat(31), 'มีไทย', 'a b c', 'a@b.com', "x'--", '']) {
      assert.equal(h.username.safeParse(bad).success, false, JSON.stringify(bad))
    }
    for (const good of ['abc', 'a'.repeat(30), 'a.b_c-d9']) assert.equal(h.username.safeParse(good).success, true, good)
  })
  test('password: 6–72 ตัว', () => {
    assert.equal(h.password.safeParse('12345').success, false)
    assert.equal(h.password.safeParse('123456').success, true)
    assert.equal(h.password.safeParse('x'.repeat(72)).success, true)
    assert.equal(h.password.safeParse('x'.repeat(73)).success, false)
  })
  test('fullName: ตัดช่องว่าง ห้ามว่าง ไม่เกิน 100', () => {
    assert.equal(h.fullName.parse('  สมศรี  '), 'สมศรี')
    assert.equal(h.fullName.safeParse('   ').success, false)
    assert.equal(h.fullName.safeParse('x'.repeat(101)).success, false)
  })
})
