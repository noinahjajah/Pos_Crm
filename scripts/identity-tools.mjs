#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { SignJWT } from 'jose';
import { SEED_USERS } from '../services/identity/src/memory.js';

const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const command = process.argv[2] || 'tokens';
if (command === 'tokens') await makeTokens();
else if (command === 'seed-users') await seedUsers();
else {
  console.error(`ไม่รู้จักคำสั่ง ${command} (ใช้ tokens หรือ seed-users)`);
  process.exit(1);
}

async function makeTokens() {
  const secret = process.env.JWT_SECRET || process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    console.error('ต้องตั้ง JWT_SECRET (ดู .env.example)');
    process.exit(1);
  }
  const hoursArg = process.argv.indexOf('--hours');
  const hours = hoursArg > -1 ? Number(process.argv[hoursArg + 1]) : 12;
  const key = new TextEncoder().encode(secret);

  console.log(`# token ทดสอบ อายุ ${hours} ชั่วโมง (เซ็นด้วย JWT_SECRET)\n`);
  for (const u of SEED_USERS) {
    const token = await new SignJWT({ role: 'authenticated', user_role: u.role, branch_id: u.branch_id, username: u.username })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(u.id)
      .setAudience('authenticated')
      .setIssuer('pos-crm-test-token')
      .setIssuedAt()
      .setExpirationTime(`${hours}h`)
      .sign(key);
    console.log(`# ${u.role} (${u.username}) branch_id=${u.branch_id ?? 'null (ทุกสาขา)'}`);
    console.log(`export TOKEN_${u.role.toUpperCase()}="${token}"\n`);
  }
  console.log('# ตัวอย่าง:');
  console.log('# curl -H "Authorization: Bearer $TOKEN_STAFF" http://localhost:8080/api/v1/identity/me');
}

async function seedUsers() {
  const { createClient } = await import('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const password = process.env.SEED_PASSWORD;
  const domain = process.env.USERNAME_EMAIL_DOMAIN || 'pos.local';
  if (!url || !serviceKey || !password) {
    console.error('ต้องตั้ง SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY และ SEED_PASSWORD');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const db = admin.schema('identity');
  const { data: roles, error: rolesErr } = await db.from('roles').select('id, name');
  if (rolesErr) throw rolesErr;
  const roleId = Object.fromEntries(roles.map((r) => [r.name, r.id]));

  for (const u of SEED_USERS) {
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
      branch_id: u.branch_id,
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
