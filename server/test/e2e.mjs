// ตรวจการเชื่อมต่อจริงทั้งสาย: gateway -> identity -> ฐานข้อมูล (36 รายการ, 3 role) · ต้องเปิด npm run dev ก่อน · สร้างสาขา/ผู้ใช้ทดสอบแล้วลบทิ้งเอง
const BASE = process.argv[2] || 'http://localhost:8080/api/v1';
let pass = 0, fail = 0;
const out = [];
async function call(method, path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}
function check(name, cond, info = '') {
  if (cond) pass++; else { fail++; out.push(`FAIL ${name} ${info}`); }
}
const login = async (u, p = 'password123') => call('POST', '/identity/auth/login', { body: { username: u, password: p } });

const tok = {};
for (const u of ['owner', 'manager1', 'staff1']) {
  const r = await login(u);
  check(`login ${u}`, r.status === 200 && r.json?.data?.access_token, r.status);
  tok[u] = r.json?.data;
}
const T = (u) => tok[u]?.access_token;

check('login wrong pw 401', (await login('owner', 'nope-wrong')).status === 401);
check('login empty 400', (await call('POST', '/identity/auth/login', { body: {} })).status === 400);
check('no token 401', (await call('GET', '/identity/me')).status === 401);
check('bad token 401', (await call('GET', '/identity/me', { token: 'x.y.z' })).status === 401);

for (const u of ['owner', 'manager1', 'staff1']) {
  const r = await call('GET', '/identity/me', { token: T(u) });
  check(`me ${u}`, r.status === 200 && r.json?.data?.username === u, r.status);
}

// branches
const br = await call('GET', '/identity/branches', { token: T('owner') });
check('owner list branches', br.status === 200 && br.json?.data?.length >= 1, br.status);
const firstBranch = br.json?.data?.[0];
check('staff list branches', (await call('GET', '/identity/branches', { token: T('staff1') })).status === 200);
check('get branch by id', (await call('GET', `/identity/branches/${firstBranch?.id}`, { token: T('owner') })).status === 200);
check('manager create branch 403', (await call('POST', '/identity/branches', { token: T('manager1'), body: { code: 'X', name: 'x' } })).status === 403);

const code = 'E2E' + Date.now().toString().slice(-6);
const nb = await call('POST', '/identity/branches', { token: T('owner'), body: { code, name: 'สาขาทดสอบ e2e', branch_type: 'restaurant' } });
check('owner create branch', nb.status === 201, `${nb.status} ${JSON.stringify(nb.json?.error ?? '')}`);
const bid = nb.json?.data?.id;
const ub = await call('PATCH', `/identity/branches/${bid}`, { token: T('owner'), body: { name: 'สาขาทดสอบ e2e (แก้)' } });
check('owner update branch', ub.status === 200, ub.status);

// roles / users
check('manager roles', (await call('GET', '/identity/roles', { token: T('manager1') })).status === 200);
check('staff roles 403', (await call('GET', '/identity/roles', { token: T('staff1') })).status === 403);
const lu = await call('GET', '/identity/users', { token: T('owner') });
check('owner list users', lu.status === 200 && lu.json?.data?.length >= 3, lu.status);
const mu = await call('GET', '/identity/users', { token: T('manager1') });
const mgrBranch = tok.manager1?.user?.branch_id ?? tok.manager1?.user?.branch?.id;
check('manager sees own branch only', mu.status === 200 && mu.json.data.every((x) => (x.branch_id ?? x.branch?.id) === mgrBranch), mu.status);
check('staff users 403', (await call('GET', '/identity/users', { token: T('staff1') })).status === 403);

const uname = 'e2e' + Date.now().toString().slice(-6);
const nu = await call('POST', '/identity/users', {
  token: T('owner'),
  body: { username: uname, password: 'TempPass#123', full_name: 'ผู้ใช้ทดสอบ e2e', role: 'staff', branch_id: bid },
});
check('owner create user', nu.status === 201, `${nu.status} ${JSON.stringify(nu.json?.error ?? '')}`);
const uid = nu.json?.data?.id;
check('get user by id', (await call('GET', `/identity/users/${uid}`, { token: T('owner') })).status === 200);
const nl = await login(uname, 'TempPass#123');
check('new user can login', nl.status === 200, nl.status);
check('new user must change pw flag', nl.json?.data?.user?.must_change_password === true, JSON.stringify(nl.json?.data?.user ?? {}).slice(0, 80));
const cp = await call('POST', '/identity/auth/change-password', { token: nl.json?.data?.access_token, body: { current_password: 'TempPass#123', new_password: 'NewPass#456' } });
check('change password', cp.status === 200, `${cp.status} ${JSON.stringify(cp.json?.error ?? '')}`);
check('login with new pw', (await login(uname, 'NewPass#456')).status === 200);
const upd = await call('PATCH', `/identity/users/${uid}`, { token: T('owner'), body: { full_name: 'ผู้ใช้ทดสอบ e2e (แก้)' } });
check('owner update user', upd.status === 200, upd.status);
check('delete branch with user 409', (await call('DELETE', `/identity/branches/${bid}`, { token: T('owner') })).status === 409);
const du = await call('DELETE', `/identity/users/${uid}`, { token: T('owner') });
check('owner delete user', du.status === 200 || du.status === 204, du.status);
check('deleted user cannot login', (await login(uname, 'NewPass#456')).status === 401);
const db = await call('DELETE', `/identity/branches/${bid}`, { token: T('owner') });
check('owner delete branch', db.status === 200 || db.status === 204, `${db.status} ${JSON.stringify(db.json?.error ?? '')}`);

// gateway guards
check('internal blocked', (await call('GET', '/identity/internal/x', { token: T('owner') })).status === 404);
check('unknown service 404', (await call('GET', '/nope/x', { token: T('owner') })).status === 404);

// session
const rf = await call('POST', '/identity/auth/refresh', { body: { refresh_token: tok.staff1?.refresh_token } });
check('refresh', rf.status === 200 && rf.json?.data?.access_token, rf.status);
const lo = await call('POST', '/identity/auth/logout', { token: rf.json?.data?.access_token });
check('logout', lo.status === 200 || lo.status === 204, lo.status);

console.log(out.join('\n'));
console.log(`PASS ${pass} / ${pass + fail}`);
if (fail) process.exitCode = 1;
