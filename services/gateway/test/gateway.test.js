// เทสต์ gateway: ตรวจ JWT, ตารางสิทธิ์ตาม role, branch scope, header ที่ส่งต่อ, internal, timeout

import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { SERVICES } from '../src/access.config.js'
import { allRoutes, IDS, INTERNAL_KEY, makeToken, startGateway, startUpstream, tokenFor } from './helpers.js'

let upstream
let gw
const tokens = {}

before(async () => {
  upstream = await startUpstream()
  gw = await startGateway(upstream.url)
  for (const role of ['staff', 'manager', 'owner']) tokens[role] = await tokenFor[role]()
})
after(async () => {
  await gw.close()
  await upstream.close()
})

describe('ตารางสิทธิ์ (role × route)', () => {
  test('ทุก role ในตารางเป็น role ที่ระบบรู้จัก และไม่มีแถวซ้ำ', () => {
    const seen = new Set()
    for (const s of SERVICES) {
      for (const [method, path, roles] of s.routes) {
        const key = `${method} ${s.prefix}${path}`
        assert.ok(!seen.has(key), `แถวซ้ำ: ${key}`)
        seen.add(key)
        for (const r of roles) assert.ok(['staff', 'manager', 'owner'].includes(r), `${key} มี role แปลก: ${r}`)
      }
    }
  })

  for (const role of ['staff', 'manager', 'owner']) {
    test(`${role}: เข้าได้เฉพาะ route ที่มี role นี้`, async () => {
      for (const route of allRoutes().filter((r) => !r.isPublic)) {
        const res = await gw.request(route.method, route.url, { token: tokens[role], body: route.method === 'GET' ? undefined : {} })
        await res.arrayBuffer()
        const expected = route.roles.includes(role) ? 200 : 403
        assert.equal(res.status, expected, `${role} ${route.method} ${route.url}`)
      }
    })
  }

  test('route ที่ไม่อยู่ในตาราง → 403 แม้เป็น owner', async () => {
    const res = await gw.request('GET', '/api/v1/pos/not-in-table', { token: tokens.owner })
    assert.equal(res.status, 403)
    assert.equal((await res.json()).error.code, 'FORBIDDEN')
  })

  test('prefix ที่ไม่มี service → 404', async () => {
    const res = await gw.request('GET', '/api/v1/unknown/x', { token: tokens.owner })
    assert.equal(res.status, 404)
  })
})

describe('ตรวจ JWT', () => {
  test('ไม่มี token → 401', async () => {
    const res = await gw.request('GET', '/api/v1/identity/me')
    assert.equal(res.status, 401)
    assert.equal((await res.json()).error.code, 'UNAUTHORIZED')
  })

  test('ทุก route ที่ไม่ใช่ public ต้องมี token', async () => {
    for (const route of allRoutes().filter((r) => !r.isPublic)) {
      const res = await gw.request(route.method, route.url)
      await res.arrayBuffer()
      assert.equal(res.status, 401, `${route.method} ${route.url}`)
    }
  })

  test('ลายเซ็นผิด → 401', async () => {
    const token = await makeToken({ sub: IDS.owner, user_role: 'owner' }, { secret: 'another-secret-another-secret-123456' })
    assert.equal((await gw.request('GET', '/api/v1/identity/me', { token })).status, 401)
  })

  test('หมดอายุ → 401', async () => {
    const token = await makeToken({ sub: IDS.owner, user_role: 'owner' }, { expiresIn: '-1m' })
    assert.equal((await gw.request('GET', '/api/v1/identity/me', { token })).status, 401)
  })

  test('issuer ของโปรเจกต์อื่น → 401', async () => {
    const token = await makeToken({ sub: IDS.owner, user_role: 'owner' }, { issuer: 'https://other.supabase.co/auth/v1' })
    assert.equal((await gw.request('GET', '/api/v1/identity/me', { token })).status, 401)
  })

  test('alg none → 401', async () => {
    const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    const token = `${enc({ alg: 'none' })}.${enc({ sub: IDS.owner, role: 'authenticated', user_role: 'owner' })}.`
    assert.equal((await gw.request('GET', '/api/v1/identity/me', { token })).status, 401)
  })

  test('login / refresh เป็น public ไม่ต้องมี token', async () => {
    for (const path of ['/api/v1/identity/auth/login', '/api/v1/identity/auth/refresh']) {
      const res = await gw.request('POST', path, { body: { username: 'a', password: 'b' } })
      const json = await res.json()
      assert.equal(res.status, 200, path)
      assert.equal(json.data.headers['x-internal-key'], INTERNAL_KEY)
      assert.equal(json.data.headers['x-user-role'], undefined, 'public ต้องไม่มี header ผู้ใช้')
    }
  })
})

describe('header ที่ส่งต่อให้ service', () => {
  test('staff: ใส่ X-User-*, X-Branch-Id จาก JWT และตัด prefix', async () => {
    const res = await gw.request('GET', '/api/v1/catalog/menus?category_id=x', { token: tokens.staff })
    const { data } = await res.json()
    assert.equal(data.url, '/menus?category_id=x')
    assert.equal(data.headers['x-user-id'], IDS.staff)
    assert.equal(data.headers['x-user-role'], 'staff')
    assert.equal(data.headers['x-branch-id'], IDS.branchA)
    assert.equal(data.headers['x-internal-key'], INTERNAL_KEY)
    assert.ok(data.headers['x-request-id'])
  })

  test('header ปลอมจาก client ถูกลบทิ้งและแทนด้วยค่าจริง', async () => {
    const res = await gw.request('GET', '/api/v1/catalog/menus', {
      token: tokens.staff,
      headers: {
        'X-User-Role': 'owner',
        'X-User-Id': IDS.owner,
        'X-Branch-Id': IDS.branchB,
        'X-Internal-Key': 'guess',
        'X-Customer-Id': IDS.branchB,
        'X-User-Extra': 'x',
      },
    })
    const { data } = await res.json()
    assert.equal(data.headers['x-user-role'], 'staff')
    assert.equal(data.headers['x-user-id'], IDS.staff)
    assert.equal(data.headers['x-branch-id'], IDS.branchA)
    assert.equal(data.headers['x-internal-key'], INTERNAL_KEY)
    assert.equal(data.headers['x-customer-id'], undefined)
    assert.equal(data.headers['x-user-extra'], undefined)
  })

  test('staff/manager ส่ง ?branch_id= สาขาอื่น → ยังได้สาขาตัวเอง (1.3)', async () => {
    const res = await gw.request('GET', `/api/v1/catalog/menus?branch_id=${IDS.branchB}`, { token: tokens.manager })
    const { data } = await res.json()
    assert.equal(data.headers['x-branch-id'], IDS.branchA)
  })

  test('owner ส่ง ?branch_id= → X-Branch-Id สาขานั้น · ไม่ส่ง = ว่าง (ทุกสาขา) (1.4)', async () => {
    let { data } = await (await gw.request('GET', `/api/v1/payment/expenses?branch_id=${IDS.branchB}`, { token: tokens.owner })).json()
    assert.equal(data.headers['x-branch-id'], IDS.branchB)
    ;({ data } = await (await gw.request('GET', '/api/v1/payment/expenses', { token: tokens.owner })).json())
    assert.equal(data.headers['x-branch-id'], '')
    ;({ data } = await (await gw.request('GET', '/api/v1/payment/expenses?branch_id=not-uuid', { token: tokens.owner })).json())
    assert.equal(data.headers['x-branch-id'], '')
  })

  test('body ส่งต่อครบ', async () => {
    const res = await gw.request('POST', '/api/v1/pos/orders', { token: tokens.staff, body: { table_ids: ['a'], guest_count: 2 } })
    const { data } = await res.json()
    assert.deepEqual(JSON.parse(data.body), { table_ids: ['a'], guest_count: 2 })
  })
})

describe('internal และ path แปลก', () => {
  test('/internal/* → 404 เสมอ ทั้งมีและไม่มี token', async () => {
    const hits = upstream.hits.length
    for (const url of ['/api/v1/catalog/internal/stocks/deduct', '/api/v1/pos/internal/orders/x/mark-paid', '/api/v1/pos/internal']) {
      assert.equal((await gw.request('POST', url)).status, 404, url)
      assert.equal((await gw.request('POST', url, { token: tokens.owner })).status, 404, url)
    }
    assert.equal(upstream.hits.length, hits)
  })

  test('path มี .. หรือ %2F → 400', async () => {
    for (const url of ['/api/v1/catalog/menus/..%2Finternal', '/api/v1/catalog/menus/%2E%2E/x', '/api/v1/catalog/menus/a%2Fb']) {
      const res = await gw.request('GET', url, { token: tokens.owner })
      assert.ok([400, 403].includes(res.status), `${url} ได้ ${res.status}`)
    }
  })
})

describe('service ล่ม / ช้า', () => {
  test('ต่อ service ไม่ได้ → 502', async () => {
    const dead = await startGateway('http://127.0.0.1:1')
    const res = await dead.request('GET', '/api/v1/identity/me', { token: tokens.owner })
    assert.equal(res.status, 502)
    assert.equal((await res.json()).error.code, 'UPSTREAM_UNAVAILABLE')
    await dead.close()
  })

  test('service ตอบช้าเกิน timeout → 504', async () => {
    const slow = await startUpstream({ delayMs: 300 })
    const g = await startGateway(slow.url, { timeoutMs: 50 })
    const res = await g.request('GET', '/api/v1/identity/me', { token: tokens.owner })
    assert.equal(res.status, 504)
    await g.close()
    await slow.close()
  })
})

describe('rate limit', () => {
  test('login เกินกำหนด → 429', async () => {
    const g = await startGateway(upstream.url, { rateLimits: { general: 1000, auth: 2 } })
    const codes = []
    for (let i = 0; i < 3; i++) {
      const res = await g.request('POST', '/api/v1/identity/auth/login', { body: {} })
      await res.arrayBuffer()
      codes.push(res.status)
    }
    assert.deepEqual(codes, [200, 200, 429])
    await g.close()
  })
})
