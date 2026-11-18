// เทสต์ gateway: สิทธิ์ สาขา header ปลอม และทดสอบรวมกับ identity จริง

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import { SignJWT } from 'jose';
import { makeKeys } from '../../identity/test/keys.js';
import { createApp } from '../app.js';

const KEYS = await makeKeys();
const OTHER_KEYS = await makeKeys();
const KEY = 'internal-test-key';
const BRANCH_A = '11111111-1111-4111-8111-111111111111';
const BRANCH_B = '22222222-2222-4222-8222-222222222222';

let upstream;
let upstreamUrl;
let gw;

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
    { name: 'identity', prefix: '/api/v1/identity', target: upstreamUrl, public: ['/auth/login'] },
    { name: 'catalog', prefix: '/api/v1/catalog', target: upstreamUrl },
    { name: 'pos', prefix: '/api/v1/pos', target: 'http://127.0.0.1:1' },
    { name: 'payment', prefix: '/api/v1/payment', target: upstreamUrl },
  ];
  const permissions = {
    identity: [
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
      jwks: KEYS.jwks,
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

async function token(role, branchId, { expired = false, keys = KEYS } = {}) {
  return new SignJWT({ role: 'authenticated', user_role: role, branch_id: branchId })
    .setProtectedHeader({ alg: 'ES256', kid: 'test' })
    .setSubject(`user-${role}`)
    .setAudience('authenticated')
    .setIssuedAt()
    .setExpirationTime(expired ? Math.floor(Date.now() / 1000) - 10 : '5m')
    .sign(keys.privateKey);
}
const bearer = async (...a) => ({ Authorization: `Bearer ${await token(...a)}` });

test('ไม่มี token → 401 TOKEN_MISSING พร้อม request_id', async () => {
  const res = await request(gw).get('/api/v1/identity/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'TOKEN_MISSING');
  assert.ok(res.body.request_id);
  assert.equal(res.headers['x-request-id'], res.body.request_id);
});

test('token เซ็นด้วย key อื่น → 401, หมดอายุ → TOKEN_EXPIRED', async () => {
  const bad = await request(gw).get('/api/v1/identity/me').set(await bearer('staff', BRANCH_A, { keys: OTHER_KEYS }));
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

test('/internal/* ตอบ 404 เสมอ แม้เป็น owner (ไม่มี token ถูกกันที่ Auth ก่อน)', async () => {
  const anon = await request(gw).post('/api/v1/catalog/internal/stocks/deduct');
  assert.equal(anon.status, 401);
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

test('path แปลก (.. / %2F) → 400 ไม่ส่งต่อให้ service', async () => {
  const a = await request(gw).get('/api/v1/identity/users/..').set(await bearer('owner', null));
  assert.equal(a.status, 400);
  const b = await request(gw).get('/api/v1/identity/users/x%2F..%2Finternal').set(await bearer('owner', null));
  assert.equal(b.status, 400);
});

import { PERMISSIONS } from '../permissions.js';
import { createApp as createIdentityApp } from '../../identity/app.js';
import { createMemoryAuth, createMemoryRepo, SEED_USERS, SEED_BRANCHES } from '../../identity/test/fake-supabase.js';

async function startStack() {
  const repo = createMemoryRepo();
  const auth = createMemoryAuth({ repo, signingKey: KEYS.privateKey, seedUserIds: SEED_USERS.map((u) => u.id), seedPassword: 'password123' });
  const identity = createIdentityApp({ repo, auth, internalKey: KEY, logger: { error() {} } });
  const server = await new Promise((resolve) => {
    const s = identity.listen(0, () => resolve(s));
  });
  const target = `http://127.0.0.1:${server.address().port}`;
  const app = createApp(
    {
      internalKey: KEY,
      jwks: KEYS.jwks,
      jwtAudience: 'authenticated',
      corsOrigins: ['*'],
      rateLimitPerMin: 10_000,
      loginRateLimitPerMin: 10_000,
      proxyTimeoutMs: 5000,
      trustProxy: false,
      logRequests: false,
    },
    {
      routes: [{ name: 'identity', prefix: '/api/v1/identity', target, public: ['/auth/login', '/auth/refresh'] }],
      permissions: { identity: PERMISSIONS.identity },
      logger: { log() {}, error() {} },
    },
  );
  return { app, server };
}

const loginVia = async (app, username) => {
  const res = await request(app).post('/api/v1/identity/auth/login').send({ username, password: 'password123' });
  assert.equal(res.status, 200, `login ${username}`);
  return { Authorization: `Bearer ${res.body.data.access_token}` };
};

test('integration: ทุก endpoint ในตารางสิทธิ์ของ identity มีอยู่จริง และ role ที่ไม่มีสิทธิ์ได้ 403', async () => {
  const { app, server } = await startStack();
  try {
    const tokens = {
      owner: await loginVia(app, 'owner'),
      manager: await loginVia(app, 'manager1'),
      staff: await loginVia(app, 'staff1'),
    };
    const sampleId = SEED_BRANCHES[0].id;
    for (const rule of PERMISSIONS.identity) {
      if (rule.path === '/auth/logout' || rule.method === 'DELETE') continue;
      const path = `/api/v1/identity${rule.path.replace(':id', sampleId)}`;
      for (const role of ['owner', 'manager', 'staff']) {
        const res = await request(app)[rule.method.toLowerCase()](path).set(tokens[role]).send({});
        const label = `${rule.method} ${rule.path} as ${role}`;
        assert.notEqual(res.body?.error?.code, 'ROUTE_NOT_FOUND', `${label}: service ไม่มี route นี้`);
        if (rule.roles.includes(role)) {
          assert.notEqual(res.body?.error?.code, 'FORBIDDEN', `${label}: gateway ให้ผ่านแต่ service ปฏิเสธ`);
        } else {
          assert.equal(res.status, 403, `${label}: ควรได้ 403`);
        }
      }
    }
  } finally {
    server.close();
  }
});

test('integration: flow ผู้ใช้ใหม่ผ่าน gateway — สร้าง → login → เปลี่ยนรหัส → ใช้ token ใหม่', async () => {
  const { app, server } = await startStack();
  try {
    const owner = await loginVia(app, 'owner');
    const created = await request(app)
      .post('/api/v1/identity/users')
      .set(owner)
      .send({ username: 'flow1', password: 'temp1234', full_name: 'ทดสอบ', role: 'manager', branch_id: SEED_BRANCHES[1].id });
    assert.equal(created.status, 201);

    const l = await request(app).post('/api/v1/identity/auth/login').send({ username: 'flow1', password: 'temp1234' });
    assert.equal(l.body.data.user.must_change_password, true);
    const changed = await request(app)
      .post('/api/v1/identity/auth/change-password')
      .set({ Authorization: `Bearer ${l.body.data.access_token}` })
      .send({ current_password: 'temp1234', new_password: 'flow2026x' });
    assert.equal(changed.status, 200);

    const users = await request(app)
      .get('/api/v1/identity/users')
      .set({ Authorization: `Bearer ${changed.body.data.access_token}` });
    assert.equal(users.status, 200);
    assert.ok(users.body.data.every((u) => u.branch_id === SEED_BRANCHES[1].id));
  } finally {
    server.close();
  }
});
