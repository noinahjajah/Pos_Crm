import { timingSafeEqual, randomUUID } from 'node:crypto';
import { z } from 'zod';

// ===================== response / error (spec ข้อ 7) =====================
// รูปแบบ response มาตรฐานของทุก service (spec ข้อ 7)
//   สำเร็จ: { "data": ..., "meta": { ... } }
//   ผิดพลาด: { "error": { "code", "message", "details" }, "request_id": "..." }

export class AppError extends Error {
  /**
   * @param {number} status HTTP status
   * @param {string} code   รหัส error เช่น VALIDATION_ERROR, FORBIDDEN
   * @param {string} message ข้อความอ่านง่าย (ภาษาไทยได้)
   * @param {unknown[]} [details]
   */
  constructor(status, code, message, details = []) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const errors = {
  badRequest: (message = 'ข้อมูลไม่ถูกต้อง', details) => new AppError(400, 'VALIDATION_ERROR', message, details),
  unauthorized: (message = 'กรุณาเข้าสู่ระบบ', code = 'UNAUTHORIZED') => new AppError(401, code, message),
  forbidden: (message = 'ไม่มีสิทธิ์ทำรายการนี้', code = 'FORBIDDEN') => new AppError(403, code, message),
  notFound: (message = 'ไม่พบข้อมูล', code = 'NOT_FOUND') => new AppError(404, code, message),
  conflict: (code, message, details) => new AppError(409, code, message, details),
  tooMany: (message = 'เรียกถี่เกินไป กรุณาลองใหม่ภายหลัง') => new AppError(429, 'RATE_LIMITED', message),
  badGateway: (message = 'service ปลายทางไม่ตอบสนอง') => new AppError(502, 'SERVICE_UNAVAILABLE', message),
  gatewayTimeout: (message = 'service ปลายทางตอบช้าเกินกำหนด') => new AppError(504, 'SERVICE_TIMEOUT', message),
};

export function requestIdOf(req) {
  return req.requestId || req.get?.('x-request-id') || null;
}

/** ส่งผลลัพธ์สำเร็จ */
export function ok(res, data, { status = 200, meta } = {}) {
  const body = { data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

/** สร้าง body ของ error ตามรูปแบบมาตรฐาน */
export function errorBody(err, requestId) {
  return {
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'เกิดข้อผิดพลาดภายในระบบ',
      details: err.details || [],
    },
    request_id: requestId ?? null,
  };
}

/** ส่ง error ตามรูปแบบมาตรฐาน */
export function sendError(res, err, requestId) {
  return res.status(err.status || 500).json(errorBody(err, requestId));
}

/** middleware ปลายทาง: path ที่ไม่มี */
export function notFoundHandler(req, res) {
  sendError(res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'), requestIdOf(req));
}

/**
 * middleware จัดการ error ตัวสุดท้ายของทุก service
 * error ที่ไม่ใช่ AppError จะไม่ส่งรายละเอียดภายในออกไป
 */
export function errorHandler({ logger = console } = {}) {
  // eslint-disable-next-line no-unused-vars
  return (err, req, res, _next) => {
    if (err?.type === 'entity.parse.failed') {
      return sendError(res, errors.badRequest('รูปแบบ JSON ไม่ถูกต้อง'), requestIdOf(req));
    }
    if (err?.type === 'entity.too.large') {
      return sendError(res, new AppError(413, 'PAYLOAD_TOO_LARGE', 'ข้อมูลที่ส่งมาใหญ่เกินไป'), requestIdOf(req));
    }
    if (err instanceof AppError) {
      return sendError(res, err, requestIdOf(req));
    }
    logger.error?.(`[${requestIdOf(req) ?? '-'}]`, err);
    return sendError(res, new AppError(500, 'INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ'), requestIdOf(req));
  };
}

/** ห่อ handler แบบ async ให้ส่ง error ต่อไปที่ errorHandler */
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// ===================== validate (zod) =====================
/** แปลง ZodError เป็น details ที่อ่านง่าย */
export function zodDetails(zodError) {
  return zodError.issues.map((i) => ({
    field: i.path.join('.') || null,
    message: i.message,
  }));
}

/**
 * middleware ตรวจ body / query / params ด้วย zod
 * ค่าที่ผ่านการตรวจจะถูกแทนลงใน req.body / req.validQuery / req.params
 *
 * @example
 * router.post('/users', validate({ body: createUserSchema }), handler)
 */
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    for (const [key, schema] of [['body', body], ['query', query], ['params', params]]) {
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        return next(errors.badRequest('ข้อมูลไม่ถูกต้อง', zodDetails(result.error)));
      }
      // Express 5 ทำให้ req.query เป็น getter แก้ไม่ได้ จึงเก็บค่าที่ผ่านแล้วไว้ที่ validQuery
      if (key === 'query') req.validQuery = result.data;
      else req[key] = result.data;
    }
    next();
  };
}

/** schema ที่ใช้บ่อย */
export const zx = {
  uuid: () => z.string().uuid({ message: 'ต้องเป็น uuid' }),
  idParam: () => z.object({ id: z.string().uuid({ message: 'id ต้องเป็น uuid' }) }),
  page: () =>
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
    }),
  boolString: () =>
    z
      .enum(['true', 'false'])
      .optional()
      .transform((v) => v === 'true'),
};

export { z };

/**
 * กันลืมเปลี่ยนค่าตัวอย่างจาก .env.example ตอนขึ้นระบบจริง (NODE_ENV=production + DATA_MODE=supabase)
 * โหมดจำลอง (DATA_MODE=memory) ใช้ทดสอบเท่านั้น จึงยอมให้ใช้ค่าตัวอย่างได้แม้รันใน docker
 * @param {Record<string, string|undefined>} values ชื่อตัวแปร → ค่า
 */
export function assertNotDevSecrets(values, env = process.env) {
  if (env.NODE_ENV !== 'production' || env.DATA_MODE !== 'supabase' || env.ALLOW_DEV_SECRETS === 'true') return;
  const weak = Object.entries(values)
    .filter(([, v]) => v && (/change-me|dev-only|please-change/i.test(v) || v.length < 32))
    .map(([k]) => k);
  if (weak.length) {
    throw new Error(`ค่า ${weak.join(', ')} ยังเป็นค่าตัวอย่างหรือสั้นเกินไป (ต้องยาว 32 ตัวขึ้นไป) ห้ามใช้ใน production`);
  }
}

// ===================== header X-User-* / สิทธิ์ / สาขา =====================
export const ROLES = Object.freeze({ STAFF: 'staff', MANAGER: 'manager', OWNER: 'owner' });
export const ALL_ROLES = Object.freeze([ROLES.STAFF, ROLES.MANAGER, ROLES.OWNER]);

/** header ที่ gateway ส่งต่อให้ service (spec ข้อ 2) */
export const HEADERS = Object.freeze({
  REQUEST_ID: 'x-request-id',
  USER_ID: 'x-user-id',
  USER_ROLE: 'x-user-role',
  BRANCH_ID: 'x-branch-id',
  INTERNAL_KEY: 'x-internal-key',
});

export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** ใส่ req.requestId (ใช้ค่าจาก gateway ถ้ามี) */
export function requestId() {
  return (req, res, next) => {
    req.requestId = req.get(HEADERS.REQUEST_ID) || randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  };
}

/**
 * service ทุกตัวต้องใช้ middleware นี้
 * - ต้องมี X-Internal-Key ถูกต้อง ไม่งั้นตอบ 401 (service ไม่รับ request จากนอก gateway)
 * - อ่าน X-User-Id / X-User-Role / X-Branch-Id เป็น req.user
 *   (path public เช่น /auth/login จะไม่มี X-User-* → req.user = null)
 *
 * @param {{ internalKey: string, publicPaths?: string[] }} opts
 */
export function internalAuth({ internalKey, publicPaths = ['/health'] }) {
  if (!internalKey) throw new Error('internalAuth: ต้องกำหนด INTERNAL_KEY');
  return (req, _res, next) => {
    if (publicPaths.includes(req.path)) return next();
    if (!safeEqual(req.get(HEADERS.INTERNAL_KEY), internalKey)) {
      return next(errors.unauthorized('ไม่อนุญาตให้เรียก service โดยตรง', 'INTERNAL_KEY_INVALID'));
    }
    const id = req.get(HEADERS.USER_ID);
    const role = req.get(HEADERS.USER_ROLE);
    const branchId = req.get(HEADERS.BRANCH_ID) || null;
    req.user = id && role ? { id, role, branchId } : null;
    next();
  };
}

/** ต้อง login (มี X-User-*) */
export function requireUser() {
  return (req, _res, next) => (req.user ? next() : next(errors.unauthorized()));
}

/** ต้องเป็น role ใด role หนึ่ง — ใช้ซ้ำกับ gateway เพื่อกันพลาด (defense in depth) */
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(errors.forbidden());
    next();
  };
}

/**
 * สาขาที่ request นี้ทำงานได้ (spec ข้อ 2 กติกาสาขา)
 * - staff / manager: ใช้ X-Branch-Id จาก token เสมอ ไม่สนใจ branch_id ที่ client ส่ง
 * - owner: ใช้ branch_id ที่ส่งมา (body/query) ถ้าไม่ส่ง = null (ทุกสาขา)
 *
 * @param {import('express').Request} req
 * @param {string|null|undefined} requested branch_id จาก body หรือ query
 */
export function resolveBranchId(req, requested) {
  if (!req.user) return null;
  if (req.user.role === ROLES.OWNER) return requested || req.user.branchId || null;
  return req.user.branchId;
}

/** สาขาที่ใช้กรองตอนอ่านข้อมูล: null = ไม่กรอง (owner ดูทุกสาขา) */
export function branchFilter(req) {
  return req.user?.branchId || null;
}
