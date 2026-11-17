import { randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { SignJWT } from 'jose';

// =====================================================================
// DATA_MODE=memory — ยังไม่ต่อ Supabase: เก็บข้อมูลในหน่วยความจำ + ออก JWT เอง
// =====================================================================

// ข้อมูลตั้งต้นที่ใช้ร่วมกันระหว่าง memory mode, สคริปต์ seed ผู้ใช้ และสคริปต์ออก token ทดสอบ
// id สาขาตรงกับ supabase/seed/identity_branches.sql

export const SEED_BRANCHES = [
  { id: '11111111-1111-4111-8111-111111111111', code: 'RES01', name: 'สาขาร้านอาหาร', branch_type: 'restaurant', address: null, phone: null },
  { id: '22222222-2222-4222-8222-222222222222', code: 'DRK01', name: 'สาขาเครื่องดื่ม', branch_type: 'drinks', address: null, phone: null },
  { id: '33333333-3333-4333-8333-333333333333', code: 'BAR01', name: 'สาขาบาร์', branch_type: 'bar', address: null, phone: null },
];

// ผู้ใช้ทดสอบ 3 role (ส่งมอบสัปดาห์แรก)
export const SEED_USERS = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001', username: 'owner', full_name: 'เจ้าของร้าน (ทดสอบ)', role: 'owner', branch_id: null },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000001', username: 'manager1', full_name: 'ผู้จัดการสาขาร้านอาหาร (ทดสอบ)', role: 'manager', branch_id: SEED_BRANCHES[0].id },
  { id: 'cccccccc-cccc-4ccc-8ccc-000000000001', username: 'staff1', full_name: 'พนักงานสาขาร้านอาหาร (ทดสอบ)', role: 'staff', branch_id: SEED_BRANCHES[0].id },
];

export const ROLE_ROWS = [
  { id: 1, name: 'staff' },
  { id: 2, name: 'manager' },
  { id: 3, name: 'owner' },
];

/**
 * เก็บ branches / roles / profiles ในหน่วยความจำ (DATA_MODE=memory)
 * interface เดียวกับ supabaseRepo — route ไม่ต้องรู้ว่าใช้ตัวไหน
 */
export function createMemoryRepo({ seed = true } = {}) {
  const now = () => new Date().toISOString();
  const branches = new Map();
  const profiles = new Map();

  if (seed) {
    for (const b of SEED_BRANCHES) branches.set(b.id, { ...b, is_active: true, created_at: now() });
    for (const u of SEED_USERS) profiles.set(u.id, { ...u, is_active: true, created_at: now() });
  }

  const clone = (o) => (o ? structuredClone(o) : null);

  return {
    kind: 'memory',

    // ---------- roles ----------
    async listRoles() {
      return ROLE_ROWS.map((r) => ({ ...r }));
    },

    // ---------- branches ----------
    async listBranches({ id, includeInactive = false } = {}) {
      return [...branches.values()]
        .filter((b) => (id ? b.id === id : true))
        .filter((b) => includeInactive || b.is_active)
        .sort((a, b) => a.code.localeCompare(b.code))
        .map(clone);
    },
    async getBranch(id) {
      return clone(branches.get(id));
    },
    async getBranchByCode(code) {
      return clone([...branches.values()].find((b) => b.code === code));
    },
    async createBranch(data) {
      const row = { id: randomUUID(), address: null, phone: null, ...data, is_active: true, created_at: now() };
      branches.set(row.id, row);
      return clone(row);
    },
    async updateBranch(id, patch) {
      const row = branches.get(id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
    async countActiveUsersInBranch(branchId) {
      return [...profiles.values()].filter((p) => p.branch_id === branchId && p.is_active).length;
    },

    // ---------- profiles ----------
    async listProfiles({ branchId, role, q, includeInactive = false, page = 1, limit = 20 } = {}) {
      const needle = q?.toLowerCase();
      const all = [...profiles.values()]
        .filter((p) => (branchId ? p.branch_id === branchId : true))
        .filter((p) => (role ? p.role === role : true))
        .filter((p) => includeInactive || p.is_active)
        .filter((p) => (needle ? p.username.includes(needle) || p.full_name.toLowerCase().includes(needle) : true))
        .sort((a, b) => a.username.localeCompare(b.username));
      const items = all.slice((page - 1) * limit, page * limit).map(clone);
      return { items, total: all.length };
    },
    async getProfile(id) {
      return clone(profiles.get(id));
    },
    async getProfileByUsername(username) {
      return clone([...profiles.values()].find((p) => p.username === username));
    },
    async createProfile(data) {
      const row = { ...data, is_active: true, created_at: now() };
      profiles.set(row.id, row);
      return clone(row);
    },
    async updateProfile(id, patch) {
      const row = profiles.get(id);
      if (!row) return null;
      Object.assign(row, patch);
      return clone(row);
    },
  };
}

/**
 * ระบบ login จำลอง (DATA_MODE=memory) — ไม่ต่อ Supabase
 * ออก access token แบบ HS256 ที่มี claim เหมือน Supabase + custom access token hook
 * (sub, role=authenticated, aud=authenticated, user_role, branch_id)
 * gateway จึงตรวจได้ด้วย JWT_SECRET ตัวเดียวกัน
 */
export function createMemoryAuth({ repo, jwtSecret, accessTokenTtlSec = 900, refreshTokenTtlSec = 604800, seedUserIds = [], seedPassword }) {
  const key = new TextEncoder().encode(jwtSecret);
  const passwords = new Map(); // userId -> hash
  const refreshTokens = new Map(); // token -> { userId, expiresAt }
  const banned = new Set();

  const hash = (password) => {
    const salt = randomBytes(16);
    return `${salt.toString('hex')}:${scryptSync(password, salt, 32).toString('hex')}`;
  };
  const verify = (password, stored) => {
    if (!stored) return false;
    const [saltHex, hashHex] = stored.split(':');
    const actual = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
    return timingSafeEqual(actual, Buffer.from(hashHex, 'hex'));
  };

  async function issueSession(userId) {
    const profile = await repo.getProfile(userId);
    const active = profile?.is_active;
    const accessToken = await new SignJWT({
      role: 'authenticated',
      user_role: active ? profile.role : null,
      branch_id: active ? profile.branch_id : null,
      username: profile?.username,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(userId)
      .setAudience('authenticated')
      .setIssuer('pos-crm-identity-mock')
      .setIssuedAt()
      .setExpirationTime(`${accessTokenTtlSec}s`)
      .sign(key);
    const refreshToken = randomBytes(32).toString('base64url');
    refreshTokens.set(refreshToken, { userId, expiresAt: Date.now() + refreshTokenTtlSec * 1000 });
    return { access_token: accessToken, refresh_token: refreshToken, expires_in: accessTokenTtlSec, token_type: 'bearer' };
  }

  const auth = {
    kind: 'memory',

    async signIn(userId, password) {
      if (banned.has(userId) || !verify(password, passwords.get(userId))) return null;
      return issueSession(userId);
    },

    async refresh(refreshToken) {
      const entry = refreshTokens.get(refreshToken);
      refreshTokens.delete(refreshToken); // ใช้ได้ครั้งเดียว (rotation)
      if (!entry || entry.expiresAt < Date.now() || banned.has(entry.userId)) return null;
      return { userId: entry.userId, session: await issueSession(entry.userId) };
    },

    async signOut({ userId }) {
      auth.revokeSessions(userId);
    },

    async createUser({ password }) {
      const id = randomUUID();
      passwords.set(id, hash(password));
      return id;
    },

    async setPassword(userId, password) {
      passwords.set(userId, hash(password));
    },

    revokeSessions(userId) {
      for (const [token, entry] of refreshTokens) if (entry.userId === userId) refreshTokens.delete(token);
    },

    async setBanned(userId, isBanned) {
      if (isBanned) {
        banned.add(userId);
        auth.revokeSessions(userId);
      } else banned.delete(userId);
    },

    async deleteUser(userId) {
      passwords.delete(userId);
      auth.revokeSessions(userId);
    },
  };

  // ตั้งรหัสผ่านของผู้ใช้ทดสอบ
  if (seedPassword) for (const id of seedUserIds) passwords.set(id, hash(seedPassword));

  return auth;
}
