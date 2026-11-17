import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createMemoryAuth, createMemoryRepo, SEED_BRANCHES, SEED_USERS } from '../src/memory.js';

const KEY = 'test-internal-key';
const [OWNER, MANAGER, STAFF] = SEED_USERS;
const [RES, DRK] = SEED_BRANCHES;

let app;
beforeEach(() => {
  const repo = createMemoryRepo();
  const auth = createMemoryAuth({
    repo,
    jwtSecret: 'test-secret-test-secret-test-secret',
    seedUserIds: SEED_USERS.map((u) => u.id),
    seedPassword: 'password123',
  });
  app = createApp({ repo, auth, internalKey: KEY, logger: { error() {} } });
});

// จำลอง header ที่ gateway ส่งมา
const as = (user, branchId = user?.branch_id) => {
  const h = { 'X-Internal-Key': KEY };
  if (user) Object.assign(h, { 'X-User-Id': user.id, 'X-User-Role': user.role, 'X-Branch-Id': branchId ?? '' });
  return h;
};

test('เรียกโดยไม่มี X-Internal-Key → 401', async () => {
  const res = await request(app).get('/me');
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INTERNAL_KEY_INVALID');
});

test('health ไม่ต้องใช้ key', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
});

test('login สำเร็จ ได้ token และข้อมูลผู้ใช้พร้อมสาขา', async () => {
  const res = await request(app).post('/auth/login').set(as()).send({ username: 'manager1', password: 'password123' });
  assert.equal(res.status, 200);
  assert.ok(res.body.data.access_token);
  assert.ok(res.body.data.refresh_token);
  assert.equal(res.body.data.user.role, 'manager');
  assert.equal(res.body.data.user.branch.code, 'RES01');
});

test('login รหัสผิด → 401 INVALID_CREDENTIALS', async () => {
  const res = await request(app).post('/auth/login').set(as()).send({ username: 'manager1', password: 'nope' });
  assert.equal(res.status, 401);
  assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
});

test('refresh token ใช้ได้ครั้งเดียว', async () => {
  const login = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'password123' });
  const rt = login.body.data.refresh_token;
  const r1 = await request(app).post('/auth/refresh').set(as()).send({ refresh_token: rt });
  assert.equal(r1.status, 200);
  const r2 = await request(app).post('/auth/refresh').set(as()).send({ refresh_token: rt });
  assert.equal(r2.status, 401);
});

test('logout แล้ว refresh ไม่ได้', async () => {
  const login = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'password123' });
  await request(app).post('/auth/logout').set(as(STAFF)).expect(200);
  const r = await request(app).post('/auth/refresh').set(as()).send({ refresh_token: login.body.data.refresh_token });
  assert.equal(r.status, 401);
});

test('GET /me', async () => {
  const res = await request(app).get('/me').set(as(STAFF));
  assert.equal(res.status, 200);
  assert.equal(res.body.data.username, 'staff1');
});

test('staff เห็นสาขาตัวเองสาขาเดียว · owner เห็นทุกสาขา (1.3, 1.4)', async () => {
  const s = await request(app).get('/branches').set(as(STAFF));
  assert.deepEqual(s.body.data.map((b) => b.code), ['RES01']);
  const o = await request(app).get('/branches').set(as(OWNER));
  assert.equal(o.body.data.length, 3);
});

test('staff ดูสาขาอื่นไม่ได้', async () => {
  const res = await request(app).get(`/branches/${DRK.id}`).set(as(STAFF));
  assert.equal(res.status, 403);
});

test('owner เพิ่ม/แก้/ลบสาขา (1.6)', async () => {
  const c = await request(app)
    .post('/branches')
    .set(as(OWNER))
    .send({ code: 'bar02', name: 'บาร์ 2', branch_type: 'bar' });
  assert.equal(c.status, 201);
  assert.equal(c.body.data.code, 'BAR02');
  const dup = await request(app).post('/branches').set(as(OWNER)).send({ code: 'BAR02', name: 'x', branch_type: 'bar' });
  assert.equal(dup.status, 409);
  const p = await request(app).patch(`/branches/${c.body.data.id}`).set(as(OWNER)).send({ phone: '02-000-0000' });
  assert.equal(p.body.data.phone, '02-000-0000');
  const d = await request(app).delete(`/branches/${c.body.data.id}`).set(as(OWNER));
  assert.equal(d.status, 200);
  assert.equal(d.body.data.is_active, false);
});

test('ปิดสาขาที่ยังมีผู้ใช้ไม่ได้', async () => {
  const res = await request(app).delete(`/branches/${RES.id}`).set(as(OWNER));
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'BRANCH_HAS_ACTIVE_USERS');
});

test('manager เพิ่มสาขาไม่ได้ → 403', async () => {
  const res = await request(app).post('/branches').set(as(MANAGER)).send({ code: 'X1', name: 'x', branch_type: 'bar' });
  assert.equal(res.status, 403);
});

test('GET /roles: manager ได้ staff ไม่ได้', async () => {
  assert.equal((await request(app).get('/roles').set(as(MANAGER))).status, 200);
  assert.equal((await request(app).get('/roles').set(as(STAFF))).status, 403);
});

test('manager เห็นผู้ใช้เฉพาะสาขาตัวเอง (1.3, 1.5)', async () => {
  const res = await request(app).get('/users').set(as(MANAGER));
  assert.equal(res.status, 200);
  assert.ok(res.body.data.every((u) => u.branch_id === RES.id));
  const ownerView = await request(app).get(`/users/${OWNER.id}`).set(as(MANAGER));
  assert.equal(ownerView.status, 404);
});

test('manager เพิ่มผู้ใช้ไม่ได้ (1.5)', async () => {
  const res = await request(app)
    .post('/users')
    .set(as(MANAGER))
    .send({ username: 'new1', password: 'password123', full_name: 'x', role: 'staff', branch_id: RES.id });
  assert.equal(res.status, 403);
});

test('owner เพิ่มผู้ใช้ → login ได้ → ลบ → login ไม่ได้ (1.5)', async () => {
  const c = await request(app)
    .post('/users')
    .set(as(OWNER))
    .send({ username: 'Staff2', password: 'password123', full_name: 'พนักงาน 2', role: 'staff', branch_id: DRK.id });
  assert.equal(c.status, 201);
  assert.equal(c.body.data.username, 'staff2');
  assert.equal(c.body.data.branch.code, 'DRK01');

  const l = await request(app).post('/auth/login').set(as()).send({ username: 'staff2', password: 'password123' });
  assert.equal(l.status, 200);

  const d = await request(app).delete(`/users/${c.body.data.id}`).set(as(OWNER));
  assert.equal(d.status, 200);
  assert.equal(d.body.data.is_active, false);

  const l2 = await request(app).post('/auth/login').set(as()).send({ username: 'staff2', password: 'password123' });
  assert.equal(l2.status, 401);
  const r = await request(app).post('/auth/refresh').set(as()).send({ refresh_token: l.body.data.refresh_token });
  assert.equal(r.status, 401);
});

test('staff ต้องมีสาขา · username ซ้ำ → 409', async () => {
  const noBranch = await request(app)
    .post('/users')
    .set(as(OWNER))
    .send({ username: 'nob', password: 'password123', full_name: 'x', role: 'staff' });
  assert.equal(noBranch.status, 400);
  assert.equal(noBranch.body.error.details[0].field, 'branch_id');
  const dup = await request(app)
    .post('/users')
    .set(as(OWNER))
    .send({ username: 'staff1', password: 'password123', full_name: 'x', role: 'staff', branch_id: RES.id });
  assert.equal(dup.status, 409);
});

test('owner ย้ายสาขา/เปลี่ยน role ได้ และ owner ไม่มีสาขา', async () => {
  const move = await request(app).patch(`/users/${STAFF.id}`).set(as(OWNER)).send({ branch_id: DRK.id });
  assert.equal(move.body.data.branch.code, 'DRK01');
  const promote = await request(app).patch(`/users/${STAFF.id}`).set(as(OWNER)).send({ role: 'owner', branch_id: DRK.id });
  assert.equal(promote.body.data.role, 'owner');
  assert.equal(promote.body.data.branch_id, null);
});

test('owner ลบตัวเองหรือลด role ตัวเองไม่ได้', async () => {
  assert.equal((await request(app).delete(`/users/${OWNER.id}`).set(as(OWNER))).status, 409);
  const demote = await request(app).patch(`/users/${OWNER.id}`).set(as(OWNER)).send({ role: 'manager', branch_id: RES.id });
  assert.equal(demote.status, 409);
});

test('รีเซ็ตรหัสผ่านแล้ว login ด้วยรหัสใหม่', async () => {
  await request(app).patch(`/users/${STAFF.id}`).set(as(OWNER)).send({ password: 'newpass123' }).expect(200);
  const l = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'newpass123' });
  assert.equal(l.status, 200);
});

// ระบบ login เพิ่มเติม

test('ใส่รหัสผิดบอกจำนวนครั้งที่เหลือ และครั้งที่ 5 ถูกล็อก', async () => {
  let res;
  for (let i = 1; i <= 4; i++) {
    res = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'wrong' });
    assert.equal(res.body.error.code, 'INVALID_CREDENTIALS');
    assert.equal(res.body.error.details[0].attempts_left, 5 - i);
  }
  res = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'wrong' });
  assert.equal(res.status, 429);
  assert.equal(res.body.error.code, 'ACCOUNT_LOCKED');
  const ok = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'password123' });
  assert.equal(ok.body.error.code, 'ACCOUNT_LOCKED');
});

test('username ที่ไม่มีอยู่ถูกล็อกเหมือนกัน (เดาไม่ได้ว่ามีบัญชีไหน)', async () => {
  let res;
  for (let i = 0; i < 5; i++) res = await request(app).post('/auth/login').set(as()).send({ username: 'ghost', password: 'x' });
  assert.equal(res.body.error.code, 'ACCOUNT_LOCKED');
});

test('owner รีเซ็ตรหัส → ปลดล็อก และบังคับเปลี่ยนรหัส', async () => {
  for (let i = 0; i < 5; i++) await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'wrong' });
  await request(app).patch(`/users/${STAFF.id}`).set(as(OWNER)).send({ password: 'temp1234' }).expect(200);
  const l = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'temp1234' });
  assert.equal(l.status, 200);
  assert.equal(l.body.data.user.must_change_password, true);
});

test('login สำเร็จบันทึก last_login_at', async () => {
  const l = await request(app).post('/auth/login').set(as()).send({ username: 'staff1', password: 'password123' });
  assert.ok(l.body.data.user.last_login_at);
  assert.equal(l.body.data.user.must_change_password, false);
});

test('ผู้ใช้ใหม่ต้องเปลี่ยนรหัสเอง → เปลี่ยนแล้ว flag หาย ได้ token ใหม่ และ refresh เดิมใช้ไม่ได้', async () => {
  const c = await request(app)
    .post('/users')
    .set(as(OWNER))
    .send({ username: 'newbie', password: 'temp1234', full_name: 'มือใหม่', role: 'staff', branch_id: RES.id });
  assert.equal(c.body.data.must_change_password, true);
  const newbie = { id: c.body.data.id, role: 'staff', branch_id: RES.id };

  const l = await request(app).post('/auth/login').set(as()).send({ username: 'newbie', password: 'temp1234' });
  assert.equal(l.body.data.user.must_change_password, true);

  const wrong = await request(app)
    .post('/auth/change-password')
    .set(as(newbie))
    .send({ current_password: 'nope', new_password: 'mypass123' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, 'WRONG_PASSWORD');

  const same = await request(app)
    .post('/auth/change-password')
    .set(as(newbie))
    .send({ current_password: 'temp1234', new_password: 'temp1234' });
  assert.equal(same.status, 400);

  const done = await request(app)
    .post('/auth/change-password')
    .set(as(newbie))
    .send({ current_password: 'temp1234', new_password: 'mypass123' });
  assert.equal(done.status, 200);
  assert.equal(done.body.data.user.must_change_password, false);
  assert.ok(done.body.data.access_token);

  const old = await request(app).post('/auth/refresh').set(as()).send({ refresh_token: l.body.data.refresh_token });
  assert.equal(old.status, 401);
  const relog = await request(app).post('/auth/login').set(as()).send({ username: 'newbie', password: 'mypass123' });
  assert.equal(relog.status, 200);
});

test('รหัสผ่านต้องมีตัวอักษรและตัวเลข', async () => {
  const res = await request(app)
    .post('/users')
    .set(as(OWNER))
    .send({ username: 'weak1', password: '12345678', full_name: 'x', role: 'staff', branch_id: RES.id });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'password');
});

test('เปิดบัญชีที่ลบไปแล้วกลับมาในสาขาที่ปิดแล้วไม่ได้', async () => {
  const c = await request(app)
    .post('/users')
    .set(as(OWNER))
    .send({ username: 'back1', password: 'temp1234', full_name: 'x', role: 'staff', branch_id: DRK.id });
  await request(app).delete(`/users/${c.body.data.id}`).set(as(OWNER)).expect(200);
  await request(app).delete(`/branches/${DRK.id}`).set(as(OWNER)).expect(200);
  const res = await request(app).patch(`/users/${c.body.data.id}`).set(as(OWNER)).send({ is_active: true });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.details[0].field, 'branch_id');
});
