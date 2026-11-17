import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { createApp } from '../src/app.js';

const SECRET = 'test-secret-test-secret-test-secret';
const KEY = 'internal-test-key';
const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';

let upstream;
let upstreamUrl;
let gw;

// service ปลอม: ตอบ path + header ที่ได้รับ
before(async () => {
  const svc = express();
  svc.get('/slow', (_req, res) => setTimeout(() => res.json({ ok: true }), 500));
  svc.use((req, res) => {
    res.json({
      url: req.url,
      method: req.method,
      headers: {
        user: req.get('x-user-id') ?? null,
        role: req.get('x-user-role') ?? null,
        branch: req.get('x-branch-id') ?? null,
        key: req.get('x-internal-key') ?? null,
        rid: req.get('x-request-id') ?? null,
      },
    });
  });
  await new Promise((resolve) => {
    upstream = svc.listen(0, resolve);
  });
  upstreamUrl = `http://127.0.0.1:${upstream.address().port}`;

  const routes = [
    { name: 'identity', prefix: '/api/v1/identity', target: upstreamUrl },
    { name: 'catalog', prefix: '/api/v1/catalog', target: upstreamUrl },
    { name: 'pos', prefix: '/api/v1/pos', target: 'http://127.0.0.1:1' }, // ล่ม
    { name: 'payment', prefix: '/api/v1/payment', target: upstreamUrl },
  ];
  const permissions = {
    identity: [
      { method: 'POST', path: '/auth/login', roles: 'public' },
      { method: 'GET', path: '/me', roles: ['staff', 'manager', 'owner'] },
      { method: 'GET', path: '/users', roles: ['manager', 'owner'] },
      { method: 'POST', path: '/users', roles: ['owner'] },
      { method: 'GET', path: '/slow', roles: ['owner'] },
    ],
    catalog: [{ method: 'GET', path: '/menus', roles: ['staff', 'manager', 'owner'] }],
    pos: [{ method: 'GET', path: '/tables', roles: ['staff', 'manager', 'owner'] }],
    payment: [],
  };
  gw = createApp(
    {
      internalKey: KEY,
      jwtSecret: SECRET,
      jwtAudience: 'authenticated',
      corsOrigins: ['http://localhost:5173'],
      rateLimitPerMin: 1000,
      loginRateLimitPerMin: 3,
      proxyTimeoutMs: 200,
      trustProxy: false,
      logRequests: false,
    },
    { routes, permissions, logger: { log() {}, error() {} } },
  );
});

after(() => upstream.close());

async function token(role, branchId, { expired = false, secret = SECRET } = {}) {
  return new SignJWT({ role: 'authenticated', user_role: role, branch_id: branchId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(`user-${role}`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 10 : '5m')
    .sign(new TextEncoder().encode(secret));
}
const bearer = async (...a) => ({ Authorization: `Bearer ${await token(...a)}` });

test('ไม่มี token → 401 TOKEN_MISSING พร้อม request_id', async () => {
  const res = await request(gw).get('/api/v1/identity/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'TOKEN_MISSING');
  assert.ok(res.body.request_id);
  assert.equal(res.headers['x-request-id'], res.body.request_id);
});

test('token ผิด secret → 401, หมดอายุ → TOKEN_EXPIRED', async () => {
  const bad = await request(gw).get('/api/v1/identity/me').set(await bearer('staff', BRANCH_A, { secret: 'x'.repeat(40) }));
  assert.equal(bad.body.error.code, 'TOKEN_INVALID');
  const exp = await request(gw).get('/api/v1/identity/me').set(await bearer('staff', BRANCH_A, { expired: true }));
  assert.equal(exp.body.error.code, 'TOKEN_EXPIRED');
});

test('token ที่ไม่มี user_role → 403 NO_ROLE', async () => {
  const res = await request(gw).get('/api/v1/identity/me').set(await bearer(null, null));
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'NO_ROLE');
});

test('public route ไม่ต้องมี token และตัด prefix ก่อนส่งต่อ', async () => {
  const res = await request(gw).post('/api/v1/identity/auth/login').send({ username: 'a', password: 'b' });
  assert.equal(res.status, 200);
  assert.equal(res.body.url, '/auth/login');
  assert.equal(res.body.headers.key, KEY);
  assert.equal(res.body.headers.user, null);
});

test('ส่งต่อ X-User-* และ X-Internal-Key', async () => {
  const res = await request(gw).get('/api/v1/identity/me').set(await bearer('manager', BRANCH_A));
  assert.equal(res.status, 200);
  assert.deepEqual(
    { ...res.body.headers, rid: undefined },
    { user: 'user-manager', role: 'manager', branch: BRANCH_A, key: KEY, rid: undefined },
  );
  assert.ok(res.body.headers.rid);
});

test('client ปลอม header X-User-* / X-Internal-Key ไม่ได้', async () => {
  const res = await request(gw)
    .get('/api/v1/identity/me')
    .set(await bearer('staff', BRANCH_A))
    .set('X-User-Role', 'owner')
    .set('X-Branch-Id', BRANCH_B)
    .set('X-Internal-Key', 'hacked');
  assert.equal(res.body.headers.role, 'staff');
  assert.equal(res.body.headers.branch, BRANCH_A);
  assert.equal(res.body.headers.key, KEY);
});

test('route guard: staff เรียก GET /users → 403 (1.2)', async () => {
  const res = await request(gw).get('/api/v1/identity/users').set(await bearer('staff', BRANCH_A));
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
});

test('route guard: manager POST /users → 403, owner ผ่าน', async () => {
  assert.equal((await request(gw).post('/api/v1/identity/users').set(await bearer('manager', BRANCH_A))).status, 403);
  assert.equal((await request(gw).post('/api/v1/identity/users').set(await bearer('owner', null))).status, 200);
});

test('branch scope: staff ส่ง ?branch_id= สาขาอื่น → ใช้สาขาตัวเองและตัด query ทิ้ง (1.3)', async () => {
  const res = await request(gw).get(`/api/v1/catalog/menus?branch_id=${BRANCH_B}&q=x`).set(await bearer('staff', BRANCH_A));
  assert.equal(res.body.headers.branch, BRANCH_A);
  assert.equal(res.body.url, '/menus?q=x');
});

test('branch scope: owner เลือกสาขา หรือไม่ส่ง = ทุกสาขา (1.4)', async () => {
  const one = await request(gw).get(`/api/v1/catalog/menus?branch_id=${BRANCH_B}`).set(await bearer('owner', null));
  assert.equal(one.body.headers.branch, BRANCH_B);
  const all = await request(gw).get('/api/v1/catalog/menus').set(await bearer('owner', null));
  assert.equal(all.body.headers.branch, '');
  const bad = await request(gw).get('/api/v1/catalog/menus?branch_id=abc').set(await bearer('owner', null));
  assert.equal(bad.status, 400);
});

test('staff ที่ไม่มีสาขาใน token → 403 NO_BRANCH', async () => {
  const res = await request(gw).get('/api/v1/catalog/menus').set(await bearer('staff', null));
  assert.equal(res.body.error.code, 'NO_BRANCH');
});

test('/internal/* ตอบ 404 เสมอ แม้เป็น owner', async () => {
  const anon = await request(gw).post('/api/v1/catalog/internal/stocks/deduct');
  assert.equal(anon.status, 404);
  const owner = await request(gw).post('/api/v1/catalog/internal/stocks/deduct').set(await bearer('owner', null));
  assert.equal(owner.status, 404);
});

test('endpoint ที่ไม่อยู่ในตารางสิทธิ์ → 404, method ผิด → 405', async () => {
  assert.equal((await request(gw).get('/api/v1/identity/secret').set(await bearer('owner', null))).status, 404);
  assert.equal((await request(gw).delete('/api/v1/identity/me').set(await bearer('owner', null))).status, 405);
  assert.equal((await request(gw).get('/api/v1/unknown/x')).status, 404);
});

test('service ล่ม → 502 SERVICE_UNAVAILABLE', async () => {
  const res = await request(gw).get('/api/v1/pos/tables').set(await bearer('staff', BRANCH_A));
  assert.equal(res.status, 502);
  assert.equal(res.body.error.code, 'SERVICE_UNAVAILABLE');
});

test('service ตอบช้าเกิน timeout → 504 SERVICE_TIMEOUT', async () => {
  const res = await request(gw).get('/api/v1/identity/slow').set(await bearer('owner', null));
  assert.equal(res.status, 504);
  assert.equal(res.body.error.code, 'SERVICE_TIMEOUT');
});

test('CORS อนุญาตเฉพาะโดเมนเว็บแอป', async () => {
  const okRes = await request(gw).options('/api/v1/identity/me').set('Origin', 'http://localhost:5173').set('Access-Control-Request-Method', 'GET');
  assert.equal(okRes.headers['access-control-allow-origin'], 'http://localhost:5173');
  const no = await request(gw).options('/api/v1/identity/me').set('Origin', 'http://evil.example').set('Access-Control-Request-Method', 'GET');
  assert.equal(no.headers['access-control-allow-origin'], undefined);
});

test('rate limit /auth/login → 429 RATE_LIMITED', async () => {
  let last;
  for (let i = 0; i < 5; i++) {
    last = await request(gw).post('/api/v1/identity/auth/login').send({});
  }
  assert.equal(last.status, 429);
  assert.equal(last.body.error.code, 'RATE_LIMITED');
});
