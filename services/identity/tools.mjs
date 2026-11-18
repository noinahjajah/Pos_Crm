// เครื่องมือ: npm run tokens (login จริงกับ Supabase ได้ token 3 role) · npm run seed:users (สร้างผู้ใช้ทดสอบใน Supabase)

import { existsSync, readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { supabaseUrl } from '../shared/index.js';

const envFile = new URL('./.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

// ผู้ใช้ทดสอบ 3 role (สาขาอ้างด้วยรหัสใน supabase/seed.sql)
const TEST_USERS = [
  { username: 'owner', full_name: 'เจ้าของร้าน (ทดสอบ)', role: 'owner', branch: null },
  { username: 'manager1', full_name: 'ผู้จัดการสาขาร้านอาหาร (ทดสอบ)', role: 'manager', branch: 'RES01' },
  { username: 'staff1', full_name: 'พนักงานสาขาร้านอาหาร (ทดสอบ)', role: 'staff', branch: 'RES01' },
];

const env = process.env;
const domain = env.USERNAME_EMAIL_DOMAIN || 'pos.local';
const password = env.SEED_PASSWORD || 'password123';
const need = (...names) => {
  const missing = names.filter((n) => !env[n]);
  if (missing.length) {
    console.error(`ต้องตั้ง ${missing.join(', ')} ใน services/identity/.env`);
    process.exit(1);
  }
};

const command = process.argv[2] || 'tokens';
if (command === 'tokens') await makeTokens();
else if (command === 'seed-users') await seedUsers();
else {
  console.error(`ไม่รู้จักคำสั่ง ${command} (ใช้ tokens หรือ seed-users)`);
  process.exit(1);
}

async function makeTokens() {
  need('SUPABASE_URL', 'SUPABASE_ANON_KEY');
  const client = createClient(supabaseUrl(env.SUPABASE_URL), env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  console.log('# token จริงจาก Supabase (อายุตามที่ตั้งในโปรเจกต์ ปกติ 1 ชั่วโมง)\n');
  for (const u of TEST_USERS) {
    const { data, error } = await client.auth.signInWithPassword({ email: `${u.username}@${domain}`, password });
    if (error) {
      console.error(`# ${u.username}: login ไม่ได้ (${error.message})`);
      continue;
    }
    console.log(`# ${u.role} (${u.username})`);
    console.log(`export TOKEN_${u.role.toUpperCase()}="${data.session.access_token}"\n`);
  }
  console.log('# ตัวอย่าง:');
  console.log('# curl -H "Authorization: Bearer $TOKEN_STAFF" http://localhost:8080/api/v1/identity/me');
}

async function seedUsers() {
  need('SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY');
  const admin = createClient(supabaseUrl(env.SUPABASE_URL), env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const db = admin.schema('identity');
  const { data: roles, error: rolesErr } = await db.from('roles').select('id, name');
  if (rolesErr) throw rolesErr;
  const { data: branches, error: brErr } = await db.from('branches').select('id, code');
  if (brErr) throw brErr;
  const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));
  const branchId = Object.fromEntries(branches.map((b) => [b.code, b.id]));

  for (const u of TEST_USERS) {
    const email = `${u.username}@${domain}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username: u.username },
    });
    if (error) {
      console.warn(`ข้าม ${u.username}: ${error.message}`);
      continue;
    }
    const { error: pErr } = await db.from('profiles').insert({
      id: data.user.id,
      username: u.username,
      full_name: u.full_name,
      role_id: roleId[u.role],
      branch_id: u.branch ? branchId[u.branch] : null,
      must_change_password: false,
    });
    if (pErr) {
      await admin.auth.admin.deleteUser(data.user.id);
      console.error(`สร้าง profile ${u.username} ไม่สำเร็จ: ${pErr.message}`);
      continue;
    }
    console.log(`สร้าง ${u.username} (${u.role}) แล้ว → ${email}`);
  }
}
