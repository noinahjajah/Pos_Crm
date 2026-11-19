// อ่าน/เขียนฐานข้อมูล Supabase: ข้อมูลอยู่ใน schema identity · login ด้วย Supabase Auth

import { AppError } from '../shared/index.js';

export function createSupabaseRepo(adminClient) {
  // ชื่อ schema ตั้งได้ใน .env (ค่าเริ่มต้น identity)
  const db = adminClient.schema(process.env.IDENTITY_SCHEMA || 'identity');

  const fail = (error) => {
    if (error?.code === '23505') {
      throw new AppError(409, 'DUPLICATE', 'ข้อมูลซ้ำกับที่มีอยู่แล้ว');
    }
    throw new AppError(500, 'DB_ERROR', 'บันทึกข้อมูลไม่สำเร็จ', [{ message: error?.message }]);
  };

  let roleCache = null;
  async function roles() {
    if (roleCache) return roleCache;
    const { data, error } = await db.from('roles').select('id, name').order('id');
    if (error) fail(error);
    roleCache = data;
    return data;
  }
  const roleIdOf = async (name) => (await roles()).find((r) => r.name === name)?.id;

  const PROFILE_COLS =
    'id, username, full_name, branch_id, is_active, must_change_password, last_login_at, created_at, roles(name)';
  const toProfile = (row) =>
    row && {
      id: row.id,
      username: row.username,
      full_name: row.full_name,
      role: row.roles?.name,
      branch_id: row.branch_id,
      is_active: row.is_active,
      must_change_password: row.must_change_password,
      last_login_at: row.last_login_at,
      created_at: row.created_at,
    };

  async function toRow(data) {
    const row = { ...data };
    if ('role' in row) {
      row.role_id = await roleIdOf(row.role);
      delete row.role;
    }
    return row;
  }

  return {
    kind: 'supabase',

    async listRoles() {
      return roles();
    },

    async listBranches({ id, includeInactive = false } = {}) {
      let q = db.from('branches').select('*').order('code');
      if (id) q = q.eq('id', id);
      if (!includeInactive) q = q.eq('is_active', true);
      const { data, error } = await q;
      if (error) fail(error);
      return data;
    },
    async getBranch(id) {
      const { data, error } = await db.from('branches').select('*').eq('id', id).maybeSingle();
      if (error) fail(error);
      return data;
    },
    async getBranchByCode(code) {
      const { data, error } = await db.from('branches').select('*').eq('code', code).maybeSingle();
      if (error) fail(error);
      return data;
    },
    async createBranch(input) {
      const { data, error } = await db.from('branches').insert(input).select('*').single();
      if (error) fail(error);
      return data;
    },
    async updateBranch(id, patch) {
      const { data, error } = await db.from('branches').update(patch).eq('id', id).select('*').maybeSingle();
      if (error) fail(error);
      return data;
    },
    async countActiveUsersInBranch(branchId) {
      const { count, error } = await db
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('branch_id', branchId)
        .eq('is_active', true);
      if (error) fail(error);
      return count ?? 0;
    },

    async listProfiles({ branchId, role, q, includeInactive = false, page = 1, limit = 20 } = {}) {
      let query = db.from('profiles').select(PROFILE_COLS, { count: 'exact' }).order('username');
      if (branchId) query = query.eq('branch_id', branchId);
      if (role) query = query.eq('role_id', await roleIdOf(role));
      if (!includeInactive) query = query.eq('is_active', true);
      if (q) {
        const safe = q.replace(/[%,()]/g, '');
        query = query.or(`username.ilike.%${safe}%,full_name.ilike.%${safe}%`);
      }
      query = query.range((page - 1) * limit, page * limit - 1);
      const { data, error, count } = await query;
      if (error) fail(error);
      return { items: data.map(toProfile), total: count ?? data.length };
    },
    async getProfile(id) {
      const { data, error } = await db.from('profiles').select(PROFILE_COLS).eq('id', id).maybeSingle();
      if (error) fail(error);
      return toProfile(data);
    },
    async getProfileByUsername(username) {
      const { data, error } = await db.from('profiles').select(PROFILE_COLS).eq('username', username).maybeSingle();
      if (error) fail(error);
      return toProfile(data);
    },
    async createProfile(input) {
      const { data, error } = await db.from('profiles').insert(await toRow(input)).select(PROFILE_COLS).single();
      if (error) fail(error);
      return toProfile(data);
    },
    async updateProfile(id, patch) {
      const { data, error } = await db
        .from('profiles')
        .update(await toRow(patch))
        .eq('id', id)
        .select(PROFILE_COLS)
        .maybeSingle();
      if (error) fail(error);
      return toProfile(data);
    },
  };
}

// username แปลงเป็นอีเมล <username>@pos.local ก่อนส่งให้ Supabase Auth
export function createSupabaseAuth({ anonClient, adminClient, emailOf, repo }) {
  const toSession = (s) => ({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_in: s.expires_in,
    token_type: 'bearer',
  });

  return {
    kind: 'supabase',

    async signIn(userId, password) {
      const profile = await repo.getProfile(userId);
      if (!profile) return null;
      const { data, error } = await anonClient.auth.signInWithPassword({
        email: emailOf(profile.username),
        password,
      });
      if (error || !data.session) return null;
      return toSession(data.session);
    },

    async refresh(refreshToken) {
      const { data, error } = await anonClient.auth.refreshSession({ refresh_token: refreshToken });
      if (error || !data.session) return null;
      return { userId: data.user.id, session: toSession(data.session) };
    },

    async signOut({ accessToken }) {
      if (accessToken) await adminClient.auth.admin.signOut(accessToken, 'global');
    },

    async createUser({ username, password }) {
      const { data, error } = await adminClient.auth.admin.createUser({
        email: emailOf(username),
        password,
        email_confirm: true,
        user_metadata: { username },
      });
      if (error) throw Object.assign(new Error(error.message), { authError: error });
      return data.user.id;
    },

    async setPassword(userId, password) {
      const { error } = await adminClient.auth.admin.updateUserById(userId, { password });
      if (error) throw new Error(error.message);
    },

    revokeSessions() {},

    async setBanned(userId, isBanned) {
      const { error } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: isBanned ? '876000h' : 'none',
      });
      if (error) throw new Error(error.message);
    },

    async deleteUser(userId) {
      await adminClient.auth.admin.deleteUser(userId);
    },
  };
}
