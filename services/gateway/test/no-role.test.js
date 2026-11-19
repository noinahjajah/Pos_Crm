// เทสต์หลักของเฟส 1: token ที่ "จริง" แต่ไม่มี role ที่ระบบกำหนด ต้องใช้ route ไหนไม่ได้เลย
// กันเฟส 2 ที่ลูกค้า login ผ่าน Supabase Auth เดียวกัน (มี JWT ถูกต้องแต่ไม่มี profile พนักงาน)
// ไม่ให้หลุดเข้าหน้า POS โดยบังเอิญ
// วนทุกแถวในตารางสิทธิ์ — เพิ่ม route ใหม่ใน access.config.js แล้วเทสต์นี้ครอบให้อัตโนมัติ

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { allRoutes, IDS, makeToken, startGateway, startUpstream } from './helpers.js'

// token แบบต่าง ๆ ที่ลายเซ็นถูกต้อง แต่ไม่ควรได้สิทธิ์อะไรเลย
const NO_ROLE_TOKENS = {
  'ไม่มี profile (hook ไม่ใส่ user_role)': () => makeToken({ sub: IDS.noProfile }),
  'ลูกค้าเฟส 2 ใส่ role ไว้ใน user_metadata (ผู้ใช้แก้เองได้)': () =>
    makeToken({ sub: IDS.noProfile, user_metadata: { user_role: 'owner', role: 'owner' } }),
  'role อยู่ใน app_metadata แต่ไม่ได้มาจาก hook': () =>
    makeToken({ sub: IDS.noProfile, app_metadata: { user_role: 'owner', provider: 'email' } }),
  'role ที่ระบบไม่รู้จัก (customer)': () => makeToken({ sub: IDS.noProfile, user_role: 'customer', customer_id: IDS.branchB }),
  'role ว่าง': () => makeToken({ sub: IDS.noProfile, user_role: '' }),
  'role เป็น array': () => makeToken({ sub: IDS.noProfile, user_role: ['owner'] }),
  'role ชื่อ property ของ Object (__proto__)': () => makeToken({ sub: IDS.noProfile, user_role: 'constructor' }),
  'staff ไม่มีสาขา': () => makeToken({ sub: IDS.staff, user_role: 'staff' }),
  'manager สาขาไม่ใช่ uuid': () => makeToken({ sub: IDS.manager, user_role: 'manager', branch_id: 'all' }),
  'anon key (role = anon)': () => makeToken({ sub: IDS.owner, role: 'anon', user_role: 'owner' }),
  'service_role key': () => makeToken({ sub: IDS.owner, role: 'service_role', user_role: 'owner' }),
  'sub ไม่ใช่ uuid': () => makeToken({ sub: 'not-a-uuid', user_role: 'owner' }),
}

describe('token ที่ไม่มี role ที่ระบบกำหนด → 403 ทุก route', () => {
  let upstream
  let gw
  before(async () => {
    upstream = await startUpstream()
    gw = await startGateway(upstream.url)
  })
  after(async () => {
    await gw.close()
    await upstream.close()
  })

  const protectedRoutes = allRoutes().filter((r) => !r.isPublic)
  // route ที่ไม่อยู่ในตาราง (deny by default) ก็ต้อง 403 เหมือนกัน
  const unknownRoutes = [
    { method: 'GET', url: '/api/v1/pos/secret-new-endpoint' },
    { method: 'DELETE', url: '/api/v1/pos/orders' },
    { method: 'GET', url: '/api/v1/membership/customers' }, // เฟส 2 ยังไม่มี service → 404
  ]

  test('ตารางสิทธิ์มี route ให้ทดสอบ', () => {
    assert.ok(protectedRoutes.length >= 50, `มีแค่ ${protectedRoutes.length} route`)
  })

  for (const [label, makeBadToken] of Object.entries(NO_ROLE_TOKENS)) {
    test(label, async () => {
      const token = await makeBadToken()
      const hitsBefore = upstream.hits.length

      for (const route of protectedRoutes) {
        const res = await gw.request(route.method, route.url, { token, body: route.method === 'GET' ? undefined : {} })
        const json = await res.json()
        assert.equal(res.status, 403, `${route.method} ${route.url} ควรได้ 403 แต่ได้ ${res.status}`)
        assert.equal(json.error.code, 'NO_ROLE', `${route.method} ${route.url}`)
      }
      for (const route of unknownRoutes) {
        const res = await gw.request(route.method, route.url, { token })
        assert.ok([403, 404].includes(res.status), `${route.method} ${route.url} ได้ ${res.status}`)
      }

      assert.equal(upstream.hits.length, hitsBefore, 'ต้องไม่มี request หลุดไปถึง service เลย')
    })
  }

  test('ปลอม header X-User-Role: owner มาเองก็ไม่ช่วย', async () => {
    const token = await makeToken({ sub: IDS.noProfile })
    const res = await gw.request('GET', '/api/v1/identity/users', {
      token,
      headers: { 'X-User-Role': 'owner', 'X-User-Id': IDS.owner, 'X-Internal-Key': 'guess' },
    })
    assert.equal(res.status, 403)
  })
})
