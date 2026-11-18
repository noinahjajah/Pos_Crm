// ของกลางที่ทุก service ใช้ร่วมกัน: รูปแบบ response/error, ตรวจข้อมูลด้วย zod, อ่านผู้ใช้จาก header ของ gateway

import { timingSafeEqual, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

// error ที่ส่งให้ client ได้ (มี status, code, ข้อความ)
export class AppError extends Error {
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

function requestIdOf(req) {
  return req.requestId || req.get?.('x-request-id') || null;
}

// ตอบกลับสำเร็จ: { data, meta }
export function ok(res, data, { status = 200, meta } = {}) {
  const body = { data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
}

function errorBody(err, requestId) {
  return {
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'เกิดข้อผิดพลาดภายในระบบ',
      details: err.details || [],
    },
    request_id: requestId ?? null,
  };
}

export function sendError(res, err, requestId) {
  return res.status(err.status || 500).json(errorBody(err, requestId));
}

export function notFoundHandler(req, res) {
  sendError(res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'), requestIdOf(req));
}

// ตัวจับ error สุดท้ายของทุก service · error ที่ไม่คาดคิดจะไม่เผยรายละเอียดภายใน
export function errorHandler({ logger = console } = {}) {
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

export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function zodDetails(zodError) {
  return zodError.issues.map((i) => ({
    field: i.path.join('.') || null,
    message: i.message,
  }));
}

// ตรวจ body / query / params ด้วย zod (query ที่ผ่านแล้วอยู่ที่ req.validQuery เพราะ Express 5 แก้ req.query ไม่ได้)
export function validate({ body, query, params } = {}) {
  return (req, _res, next) => {
    for (const [key, schema] of [['body', body], ['query', query], ['params', params]]) {
      if (!schema) continue;
      const result = schema.safeParse(req[key] ?? {});
      if (!result.success) {
        return next(errors.badRequest('ข้อมูลไม่ถูกต้อง', zodDetails(result.error)));
      }
      if (key === 'query') req.validQuery = result.data;
      else req[key] = result.data;
    }
    next();
  };
}

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

// SUPABASE_URL ให้อยู่ในรูป https://xxx.supabase.co เสมอ (ตัดช่องว่าง เครื่องหมายคำพูด / ท้าย · ใส่ https:// หรือแปลง project ref ให้)
export function supabaseUrl(raw) {
  let v = String(raw ?? '').trim().replace(/^['"]|['"]$/g, '').trim().replace(/\/+$/, '');
  if (!v) return undefined;
  if (/^[a-z0-9]{20}$/.test(v)) v = `${v}.supabase.co`;
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`;
  const url = new URL(v);
  return url.origin;
}

// กันลืมเปลี่ยนรหัสตัวอย่างตอนขึ้นระบบจริง (ตรวจเฉพาะ production)
export function assertNotDevSecrets(values, env = process.env) {
  if (env.NODE_ENV !== 'production' || env.ALLOW_DEV_SECRETS === 'true') return;
  const weak = Object.entries(values)
    .filter(([, v]) => v && (/change-me|dev-only|please-change/i.test(v) || v.length < 32))
    .map(([k]) => k);
  if (weak.length) {
    throw new Error(`ค่า ${weak.join(', ')} ยังเป็นค่าตัวอย่างหรือสั้นเกินไป (ต้องยาว 32 ตัวขึ้นไป) ห้ามใช้ใน production`);
  }
}

// role และชื่อ header ที่ gateway ส่งต่อให้ service
const ROLES = Object.freeze({ STAFF: 'staff', MANAGER: 'manager', OWNER: 'owner' });
export const ALL_ROLES = Object.freeze([ROLES.STAFF, ROLES.MANAGER, ROLES.OWNER]);

export const HEADERS = Object.freeze({
  REQUEST_ID: 'x-request-id',
  USER_ID: 'x-user-id',
  USER_ROLE: 'x-user-role',
  BRANCH_ID: 'x-branch-id',
  INTERNAL_KEY: 'x-internal-key',
});

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function requestId() {
  return (req, res, next) => {
    req.requestId = req.get(HEADERS.REQUEST_ID) || randomUUID();
    res.set('X-Request-Id', req.requestId);
    next();
  };
}

// ทุก service ต้องใช้: รับเฉพาะ request จาก gateway (X-Internal-Key) แล้วอ่าน X-User-* เป็น req.user
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

export function requireUser() {
  return (req, _res, next) => (req.user ? next() : next(errors.unauthorized()));
}

// ตรวจ role ซ้ำในตัว service อีกชั้น เผื่อ gateway ตั้งค่าพลาด
export function requireRole(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(errors.unauthorized());
    if (!roles.includes(req.user.role)) return next(errors.forbidden());
    next();
  };
}

// ===================== ชื่อสั้นที่ catalog / payment ใช้ =====================
export const { badRequest, forbidden, notFound, conflict } = errors;
export const send = ok;
export const allow = requireRole;
/** ตรวจ X-Internal-Key แล้วอ่าน X-User-* เป็น req.user */
export const checkInternalKey = (internalKey) => internalAuth({ internalKey });

/** ต่อ Supabase ด้วย service_role key (ฝั่ง server เท่านั้น) */
export function serviceClient(env = process.env) {
  const url = supabaseUrl(env.SUPABASE_URL);
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) throw new Error('ยังไม่ได้ใส่ SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY ใน services/.env');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ===================== ตรวจข้อมูล (zod) =====================
/** ตรวจข้อมูลตาม schema ไม่ผ่าน → 400 พร้อมบอกว่าช่องไหนผิด */
export function parse(schema, data) {
  const result = schema.safeParse(data ?? {})
  if (!result.success) {
    throw badRequest(
      'ข้อมูลไม่ถูกต้อง',
      result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message })),
    )
  }
  return result.data
}

export const uuid = z.string().uuid('ต้องเป็น uuid')
export const idParam = z.object({ id: uuid })
export const name = z.string().trim().min(1, 'กรุณากรอกชื่อ').max(100)
/** เงิน: ไม่ติดลบ ปัดทศนิยม 2 ตำแหน่ง */
export const money = z
  .number({ error: 'ต้องเป็นตัวเลข' })
  .min(0, 'ต้องไม่ติดลบ')
  .max(999999.99)
  .transform((v) => Math.round(v * 100) / 100)
export const atLeastOne = (v) => Object.keys(v).length > 0

// ===================== สาขา =====================
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * สาขาที่ใช้กรองตอนอ่านข้อมูล
 * staff/manager = สาขาตัวเองเสมอ · owner = ?branch_id= ที่ส่งมา (ไม่ส่ง = ทุกสาขา → null)
 */
export function branchFilter(req) {
  if (req.user?.role !== 'owner') return req.user?.branchId || null
  const fromQuery = typeof req.query.branch_id === 'string' && UUID_RE.test(req.query.branch_id) ? req.query.branch_id : null
  return req.user.branchId || fromQuery
}

/** สาขาที่ใช้ตอนสร้างข้อมูล: staff/manager = สาขาตัวเอง · owner ต้องส่ง branch_id */
export function branchForCreate(req, requested) {
  const branchId = req.user.role === 'owner' ? requested || branchFilter(req) : req.user.branchId
  if (!branchId) throw badRequest('owner ต้องระบุ branch_id', [{ field: 'branch_id', message: 'กรุณาเลือกสาขา' }])
  return branchId
}

/** ข้อมูลของสาขาอื่น → 403 (owner ผ่านทุกสาขา) */
export function mustBeMyBranch(req, branchId) {
  if (req.user.role === 'owner') return
  if (req.user.branchId !== branchId) throw forbidden('ข้อมูลนี้เป็นของสาขาอื่น', 'FORBIDDEN_BRANCH')
}

// ===================== เงินและวันที่ (เวลาไทย) =====================
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export const todayTh = () => new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10)

export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'รูปแบบ YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'วันที่ไม่ถูกต้อง')

/** ช่วงวันที่ from..to (ค่าเริ่มต้น: ต้นเดือนถึงวันนี้ หรือวันนี้วันเดียวถ้า defaultToday) */
export function dateRange(query, { defaultToday = false } = {}) {
  const today = todayTh()
  const { from, to } = parse(z.object({ from: dateString.optional(), to: dateString.optional() }), query)
  const range = {
    from: from ?? (to || (defaultToday ? today : `${today.slice(0, 7)}-01`)),
    to: to ?? (from && from > today ? from : today),
  }
  if (range.from > range.to) throw badRequest('from ต้องไม่เกิน to', [{ field: 'from', message: 'from ต้องไม่เกิน to' }])
  if ((Date.parse(range.to) - Date.parse(range.from)) / 86_400_000 > 366) throw badRequest('ช่วงวันที่ยาวเกิน 1 ปี')
  return range
}

/** ช่วงเวลาของวันที่ from..to ตามเวลาไทย → [เริ่ม, ก่อน) แบบ ISO ใช้กรอง timestamptz */
export function dayRangeIso(from, to) {
  const start = new Date(`${from}T00:00:00+07:00`)
  const end = new Date(Date.parse(`${to}T00:00:00+07:00`) + 86_400_000)
  return [start.toISOString(), end.toISOString()]
}
