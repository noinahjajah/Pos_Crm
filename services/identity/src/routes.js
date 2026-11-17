import { Router } from 'express';
import {
  AppError,
  asyncHandler,
  branchFilter,
  errors,
  ok,
  requireRole,
  requireUser,
  validate,
  z,
  zx,
} from '@pos/shared';

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,32}$/, 'username ใช้ a-z 0-9 . _ - ยาว 3–32 ตัว');
const password = z
  .string()
  .min(8, 'รหัสผ่านอย่างน้อย 8 ตัวอักษร')
  .max(72, 'รหัสผ่านยาวไม่เกิน 72 ตัวอักษร')
  .regex(/[A-Za-z]/, 'รหัสผ่านต้องมีตัวอักษรภาษาอังกฤษอย่างน้อย 1 ตัว')
  .regex(/[0-9]/, 'รหัสผ่านต้องมีตัวเลขอย่างน้อย 1 ตัว');
const role = z.enum(['staff', 'manager', 'owner']);
const branchType = z.enum(['restaurant', 'drinks', 'bar']);
const optionalText = z.string().trim().max(255).nullish().transform((v) => (v ? v : null));

export const loginSchema = z.object({
  username,
  password: z.string().min(1, 'กรุณากรอกรหัสผ่าน'),
});

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'กรุณากรอกรหัสผ่านปัจจุบัน'),
    new_password: password,
  })
  .refine((v) => v.current_password !== v.new_password, {
    path: ['new_password'],
    message: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม',
  });

export const refreshSchema = z.object({
  refresh_token: z.string().min(1),
});

export const createBranchSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, 'รหัสสาขาใช้ A-Z 0-9 _ - ยาว 2–20 ตัว'),
  name: z.string().trim().min(1).max(100),
  branch_type: branchType,
  address: optionalText,
  phone: optionalText,
});

export const updateBranchSchema = createBranchSchema
  .partial()
  .extend({ is_active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'ต้องส่งอย่างน้อย 1 ช่อง');

export const listBranchesQuery = z.object({
  include_inactive: zx.boolString(),
});

export const createUserSchema = z
  .object({
    username,
    password,
    full_name: z.string().trim().min(1).max(100),
    role,
    branch_id: zx.uuid().nullish(),
  })
  .superRefine((v, ctx) => {
    if (v.role !== 'owner' && !v.branch_id) {
      ctx.addIssue({ code: 'custom', path: ['branch_id'], message: 'staff และ manager ต้องระบุสาขา' });
    }
  });

export const updateUserSchema = z
  .object({
    full_name: z.string().trim().min(1).max(100).optional(),
    role: role.optional(),
    branch_id: zx.uuid().nullish(),
    password: password.optional(),
    is_active: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'ต้องส่งอย่างน้อย 1 ช่อง');

export const listUsersQuery = zx.page().extend({
  role: role.optional(),
  q: z.string().trim().max(50).optional(),
  include_inactive: zx.boolString(),
});

export function presentBranchRef(branch) {
  return branch ? { id: branch.id, code: branch.code, name: branch.name, branch_type: branch.branch_type } : null;
}

export async function presentUser(repo, profile, branchCache) {
  let branch = null;
  if (profile.branch_id) {
    branch = branchCache?.get(profile.branch_id) ?? (await repo.getBranch(profile.branch_id));
  }
  return {
    id: profile.id,
    username: profile.username,
    full_name: profile.full_name,
    role: profile.role,
    branch_id: profile.branch_id,
    branch: presentBranchRef(branch),
    is_active: profile.is_active,
    must_change_password: Boolean(profile.must_change_password),
    last_login_at: profile.last_login_at ?? null,
    created_at: profile.created_at,
  };
}

export async function presentUsers(repo, profiles) {
  const branches = await repo.listBranches({ includeInactive: true });
  const cache = new Map(branches.map((b) => [b.id, b]));
  return Promise.all(profiles.map((p) => presentUser(repo, p, cache)));
}

export function createLoginGuard({ maxAttempts = 5, lockMinutes = 15, now = () => Date.now() } = {}) {
  const state = new Map();
  return {
    maxAttempts,
    lockedFor(username) {
      const s = state.get(username);
      if (!s?.lockedUntil) return 0;
      if (s.lockedUntil > now()) return Math.ceil((s.lockedUntil - now()) / 1000);
      state.delete(username);
      return 0;
    },
    fail(username) {
      const s = state.get(username) ?? { failed: 0 };
      s.failed += 1;
      if (s.failed >= maxAttempts) {
        s.failed = 0;
        s.lockedUntil = now() + lockMinutes * 60_000;
      }
      state.set(username, s);
      return s.lockedUntil ? 0 : maxAttempts - s.failed;
    },
    reset(username) {
      state.delete(username);
    },
  };
}

const lockedError = (seconds) =>
  new AppError(
    429,
    'ACCOUNT_LOCKED',
    `ใส่รหัสผ่านผิดหลายครั้ง บัญชีถูกล็อกชั่วคราว ลองใหม่ใน ${Math.ceil(seconds / 60)} นาที`,
    [{ retry_after_sec: seconds }],
  );

export function authRoutes({ repo, auth, loginGuard }) {
  const r = Router();

  const wrongPassword = (username, field) => {
    const left = loginGuard.fail(username);
    if (left === 0) return lockedError(loginGuard.lockedFor(username));
    const details = [{ attempts_left: left, ...(field ? { field, message: 'รหัสผ่านไม่ถูกต้อง' } : {}) }];
    return field
      ? new AppError(400, 'WRONG_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง', details)
      : new AppError(401, 'INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง', details);
  };

  r.post(
    '/login',
    validate({ body: loginSchema }),
    asyncHandler(async (req, res) => {
      const { username, password } = req.body;
      const wait = loginGuard.lockedFor(username);
      if (wait) throw lockedError(wait);

      const profile = await repo.getProfileByUsername(username);
      const session = profile?.is_active ? await auth.signIn(profile.id, password) : null;
      if (!session) throw wrongPassword(username);

      loginGuard.reset(username);
      const updated = (await repo.updateProfile(profile.id, { last_login_at: new Date().toISOString() })) ?? profile;
      ok(res, { ...session, user: await presentUser(repo, updated) });
    }),
  );

  r.post(
    '/refresh',
    validate({ body: refreshSchema }),
    asyncHandler(async (req, res) => {
      const result = await auth.refresh(req.body.refresh_token);
      if (!result) throw errors.unauthorized('session หมดอายุ กรุณาเข้าสู่ระบบใหม่', 'REFRESH_TOKEN_INVALID');
      const profile = await repo.getProfile(result.userId);
      if (!profile?.is_active) throw errors.unauthorized('บัญชีนี้ถูกปิดใช้งาน', 'ACCOUNT_DISABLED');
      ok(res, { ...result.session, user: await presentUser(repo, profile) });
    }),
  );

  r.post(
    '/logout',
    requireUser(),
    asyncHandler(async (req, res) => {
      const accessToken = req.get('authorization')?.replace(/^Bearer\s+/i, '');
      await auth.signOut({ userId: req.user.id, accessToken });
      ok(res, { logged_out: true });
    }),
  );

  r.post(
    '/change-password',
    requireUser(),
    validate({ body: changePasswordSchema }),
    asyncHandler(async (req, res) => {
      const profile = await repo.getProfile(req.user.id);
      if (!profile?.is_active) throw errors.unauthorized('บัญชีนี้ถูกปิดใช้งาน', 'ACCOUNT_DISABLED');
      const wait = loginGuard.lockedFor(profile.username);
      if (wait) throw lockedError(wait);

      const { current_password, new_password } = req.body;
      if (!(await auth.signIn(profile.id, current_password))) {
        throw wrongPassword(profile.username, 'current_password');
      }
      loginGuard.reset(profile.username);
      await auth.setPassword(profile.id, new_password);
      await auth.signOut({ userId: profile.id, accessToken: req.get('authorization')?.replace(/^Bearer\s+/i, '') });
      const updated = await repo.updateProfile(profile.id, { must_change_password: false });
      const session = await auth.signIn(profile.id, new_password);
      ok(res, { ...session, user: await presentUser(repo, updated) });
    }),
  );

  return r;
}

export function meRoutes({ repo }) {
  const r = Router();
  r.get(
    '/',
    requireUser(),
    asyncHandler(async (req, res) => {
      const profile = await repo.getProfile(req.user.id);
      if (!profile?.is_active) throw errors.unauthorized('บัญชีนี้ถูกปิดใช้งาน', 'ACCOUNT_DISABLED');
      ok(res, await presentUser(repo, profile));
    }),
  );
  return r;
}

export function branchRoutes({ repo }) {
  const r = Router();
  const owner = requireRole('owner');

  r.get(
    '/',
    requireUser(),
    validate({ query: listBranchesQuery }),
    asyncHandler(async (req, res) => {
      const own = req.user.role === 'owner' ? null : req.user.branchId;
      const includeInactive = req.user.role === 'owner' && req.validQuery.include_inactive;
      const items = await repo.listBranches({ id: own ?? undefined, includeInactive });
      ok(res, items, { meta: { total: items.length } });
    }),
  );

  r.get(
    '/:id',
    requireUser(),
    validate({ params: zx.idParam() }),
    asyncHandler(async (req, res) => {
      const scope = req.user.role === 'owner' ? null : branchFilter(req);
      if (scope && scope !== req.params.id) throw errors.forbidden('ดูได้เฉพาะสาขาของตัวเอง', 'BRANCH_FORBIDDEN');
      const branch = await repo.getBranch(req.params.id);
      if (!branch || (!branch.is_active && req.user.role !== 'owner')) throw errors.notFound('ไม่พบสาขา');
      ok(res, branch);
    }),
  );

  r.post(
    '/',
    owner,
    validate({ body: createBranchSchema }),
    asyncHandler(async (req, res) => {
      if (await repo.getBranchByCode(req.body.code)) {
        throw errors.conflict('BRANCH_CODE_TAKEN', `รหัสสาขา ${req.body.code} ถูกใช้แล้ว`);
      }
      ok(res, await repo.createBranch(req.body), { status: 201 });
    }),
  );

  r.patch(
    '/:id',
    owner,
    validate({ params: zx.idParam(), body: updateBranchSchema }),
    asyncHandler(async (req, res) => {
      const current = await repo.getBranch(req.params.id);
      if (!current) throw errors.notFound('ไม่พบสาขา');
      if (req.body.code && req.body.code !== current.code) {
        const taken = await repo.getBranchByCode(req.body.code);
        if (taken) throw errors.conflict('BRANCH_CODE_TAKEN', `รหัสสาขา ${req.body.code} ถูกใช้แล้ว`);
      }
      if (req.body.is_active === false) await assertNoActiveUsers(repo, current.id);
      ok(res, await repo.updateBranch(current.id, req.body));
    }),
  );

  r.delete(
    '/:id',
    owner,
    validate({ params: zx.idParam() }),
    asyncHandler(async (req, res) => {
      const current = await repo.getBranch(req.params.id);
      if (!current || !current.is_active) throw errors.notFound('ไม่พบสาขา');
      await assertNoActiveUsers(repo, current.id);
      ok(res, await repo.updateBranch(current.id, { is_active: false }));
    }),
  );

  return r;
}

async function assertNoActiveUsers(repo, branchId) {
  const count = await repo.countActiveUsersInBranch(branchId);
  if (count > 0) {
    throw errors.conflict('BRANCH_HAS_ACTIVE_USERS', `ยังมีผู้ใช้ ${count} คนในสาขานี้ ย้ายหรือลบผู้ใช้ก่อนปิดสาขา`, [
      { active_users: count },
    ]);
  }
}

export function roleRoutes({ repo }) {
  const r = Router();
  r.get(
    '/',
    requireRole('manager', 'owner'),
    asyncHandler(async (_req, res) => {
      ok(res, await repo.listRoles());
    }),
  );
  return r;
}

export function userRoutes({ repo, auth, loginGuard }) {
  const r = Router();
  const owner = requireRole('owner');

  async function assertBranchUsable(branchId) {
    const branch = await repo.getBranch(branchId);
    if (!branch || !branch.is_active) {
      throw errors.badRequest('ข้อมูลไม่ถูกต้อง', [{ field: 'branch_id', message: 'ไม่พบสาขา หรือสาขาถูกปิดแล้ว' }]);
    }
  }

  function assertCanView(req, profile) {
    if (req.user.role === 'manager' && profile.branch_id !== req.user.branchId) {
      throw errors.notFound('ไม่พบผู้ใช้');
    }
  }

  r.get(
    '/',
    requireRole('manager', 'owner'),
    validate({ query: listUsersQuery }),
    asyncHandler(async (req, res) => {
      const { page, limit, role, q, include_inactive } = req.validQuery;
      const branchId = req.user.branchId || undefined;
      const { items, total } = await repo.listProfiles({
        branchId,
        role,
        q,
        includeInactive: req.user.role === 'owner' && include_inactive,
        page,
        limit,
      });
      ok(res, await presentUsers(repo, items), { meta: { page, limit, total } });
    }),
  );

  r.get(
    '/:id',
    requireRole('manager', 'owner'),
    validate({ params: zx.idParam() }),
    asyncHandler(async (req, res) => {
      const profile = await repo.getProfile(req.params.id);
      if (!profile) throw errors.notFound('ไม่พบผู้ใช้');
      assertCanView(req, profile);
      ok(res, await presentUser(repo, profile));
    }),
  );

  r.post(
    '/',
    owner,
    validate({ body: createUserSchema }),
    asyncHandler(async (req, res) => {
      const { username, password, full_name, role } = req.body;
      const branchId = role === 'owner' ? null : req.body.branch_id;
      if (branchId) await assertBranchUsable(branchId);
      if (await repo.getProfileByUsername(username)) {
        throw errors.conflict('USERNAME_TAKEN', `username ${username} ถูกใช้แล้ว`);
      }

      let userId;
      try {
        userId = await auth.createUser({ username, password });
      } catch (e) {
        throw new AppError(409, 'USERNAME_TAKEN', `สร้างบัญชี ${username} ไม่สำเร็จ`, [{ message: e.message }]);
      }
      try {
        const profile = await repo.createProfile({
          id: userId,
          username,
          full_name,
          role,
          branch_id: branchId,
          must_change_password: true,
        });
        ok(res, await presentUser(repo, profile), { status: 201 });
      } catch (e) {
        await auth.deleteUser(userId).catch(() => {});
        throw e;
      }
    }),
  );

  r.patch(
    '/:id',
    owner,
    validate({ params: zx.idParam(), body: updateUserSchema }),
    asyncHandler(async (req, res) => {
      const current = await repo.getProfile(req.params.id);
      if (!current) throw errors.notFound('ไม่พบผู้ใช้');
      const isSelf = current.id === req.user.id;
      const { full_name, role, password, is_active } = req.body;

      if (isSelf && role && role !== 'owner') {
        throw errors.conflict('CANNOT_CHANGE_OWN_ROLE', 'เปลี่ยน role ของตัวเองไม่ได้');
      }
      if (isSelf && is_active === false) {
        throw errors.conflict('CANNOT_DISABLE_SELF', 'ปิดบัญชีของตัวเองไม่ได้');
      }

      const nextRole = role ?? current.role;
      let nextBranch = 'branch_id' in req.body ? req.body.branch_id ?? null : current.branch_id;
      if (nextRole === 'owner') nextBranch = null;
      if (nextRole !== 'owner') {
        if (!nextBranch) {
          throw errors.badRequest('ข้อมูลไม่ถูกต้อง', [{ field: 'branch_id', message: 'staff และ manager ต้องระบุสาขา' }]);
        }
        if (nextBranch !== current.branch_id || (is_active === true && !current.is_active)) {
          await assertBranchUsable(nextBranch);
        }
      }

      const patch = {};
      if (full_name !== undefined) patch.full_name = full_name;
      if (nextRole !== current.role) patch.role = nextRole;
      if (nextBranch !== current.branch_id) patch.branch_id = nextBranch;
      if (is_active !== undefined && is_active !== current.is_active) patch.is_active = is_active;

      if (password) {
        await auth.setPassword(current.id, password);
        patch.must_change_password = true;
        loginGuard?.reset(current.username);
      }
      if (patch.is_active !== undefined) await auth.setBanned(current.id, !patch.is_active);
      const updated = Object.keys(patch).length ? await repo.updateProfile(current.id, patch) : current;

      if (patch.role || 'branch_id' in patch || password) auth.revokeSessions(current.id);

      ok(res, await presentUser(repo, updated));
    }),
  );

  r.delete(
    '/:id',
    owner,
    validate({ params: zx.idParam() }),
    asyncHandler(async (req, res) => {
      const current = await repo.getProfile(req.params.id);
      if (!current || !current.is_active) throw errors.notFound('ไม่พบผู้ใช้');
      if (current.id === req.user.id) throw errors.conflict('CANNOT_DELETE_SELF', 'ลบบัญชีของตัวเองไม่ได้');
      const updated = await repo.updateProfile(current.id, { is_active: false });
      await auth.setBanned(current.id, true);
      ok(res, await presentUser(repo, updated));
    }),
  );

  return r;
}
