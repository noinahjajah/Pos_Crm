// API Gateway: ทางเข้าเดียวของเว็บ ตรวจ token, role, สาขา แล้วส่งต่อให้ service

import { randomUUID } from 'node:crypto';
import dns, { promises as dnsPromises } from 'node:dns';
import http from 'node:http';
import { isIP } from 'node:net';
import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { ALL_ROLES, AppError, HEADERS, assertNotDevSecrets, errorHandler, errors, sendError } from '@pos/shared';
import { compilePermissions, findRule, PERMISSIONS } from './permissions.js';

const env = process.env;

// อ่านค่าจาก .env
export function loadConfig(overrides = {}) {
  const config = {
    port: Number(env.PORT || env.GATEWAY_PORT || 8080),
    internalKey: env.INTERNAL_KEY,
    jwtSecret: env.JWT_SECRET || env.SUPABASE_JWT_SECRET,
    jwksUrl: env.SUPABASE_JWKS_URL || (env.SUPABASE_URL ? `${env.SUPABASE_URL}/auth/v1/.well-known/jwks.json` : undefined),
    jwtIssuer: env.JWT_ISSUER || undefined,
    jwtAudience: env.JWT_AUDIENCE || 'authenticated',
    corsOrigins: (env.CORS_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitPerMin: Number(env.RATE_LIMIT_PER_MIN || 300),
    loginRateLimitPerMin: Number(env.LOGIN_RATE_LIMIT_PER_MIN || 10),
    proxyTimeoutMs: Number(env.PROXY_TIMEOUT_MS || 10_000),
    trustProxy: env.TRUST_PROXY ?? 'loopback',
    logRequests: env.LOG_REQUESTS !== 'false',
    ...overrides,
  };
  const missing = [];
  if (!config.internalKey) missing.push('INTERNAL_KEY');
  if (!config.jwtSecret && !config.jwksUrl) missing.push('JWT_SECRET หรือ SUPABASE_URL/SUPABASE_JWKS_URL');
  if (missing.length) throw new Error(`gateway: ขาด environment variable: ${missing.join(', ')}`);
  assertNotDevSecrets({ INTERNAL_KEY: config.internalKey, JWT_SECRET: config.jwtSecret });
  return config;
}

// service ปลายทาง: /api/v1/<ชื่อ service>/... → URL ของ service
export function buildRoutes(env = process.env) {
  return [
    { name: 'identity', prefix: '/api/v1/identity', target: env.IDENTITY_URL || 'http://identity:3001', public: ['/auth/login', '/auth/refresh'] },
    { name: 'catalog', prefix: '/api/v1/catalog', target: env.CATALOG_URL || 'http://catalog:3002' },
    { name: 'pos', prefix: '/api/v1/pos', target: env.POS_URL || 'http://pos:3003' },
    { name: 'payment', prefix: '/api/v1/payment', target: env.PAYMENT_URL || 'http://payment:3004' },
  ];
}

export function matchRoute(routes, fullPath) {
  for (const route of routes) {
    if (fullPath === route.prefix || fullPath.startsWith(`${route.prefix}/`)) {
      return { route, servicePath: fullPath.slice(route.prefix.length) || '/' };
    }
  }
  return null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (req, res, err) => sendError(res, err, req.gw?.requestId);

// header ที่มีแต่ gateway ใส่ได้ ถ้า client ส่งมาเองจะถูกลบทิ้ง
const TRUSTED_HEADERS = [HEADERS.USER_ID, HEADERS.USER_ROLE, HEADERS.BRANCH_ID, HEADERS.INTERNAL_KEY];

// — middleware ตามลำดับที่ทำงาน (ดู createApp) —
export function requestIdMw() {
  return (req, res, next) => {
    for (const h of TRUSTED_HEADERS) delete req.headers[h];
    const incoming = req.headers[HEADERS.REQUEST_ID];
    const id = typeof incoming === 'string' && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
    req.headers[HEADERS.REQUEST_ID] = id;
    req.gw = { requestId: id, startedAt: process.hrtime.bigint() };
    res.set('X-Request-Id', id);
    next();
  };
}

export function corsMw({ corsOrigins }) {
  return cors({
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes('*') || corsOrigins.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Remaining', 'Retry-After'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });
}

// จำกัดจำนวน request ต่อนาที (login เข้มกว่าปกติ)
export function rateLimitMw({ rateLimitPerMin, loginRateLimitPerMin }) {
  const handler = (req, res) => fail(req, res, errors.tooMany());
  const general = rateLimit({ windowMs: 60_000, limit: rateLimitPerMin, standardHeaders: 'draft-7', legacyHeaders: false, handler });
  const login = rateLimit({
    windowMs: 60_000,
    limit: loginRateLimitPerMin,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (req, res) => fail(req, res, errors.tooMany('พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอ 1 นาที')),
  });
  return [
    general,
    (req, res, next) =>
      req.method === 'POST' && req.path === '/api/v1/identity/auth/login' ? login(req, res, next) : next(),
  ];
}

const notFound = (req, res) => fail(req, res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'));

// ตรวจ JWT (HS256 ของโหมดจำลอง หรือ JWKS ของ Supabase)
export function authMw({ routes, jwtSecret, jwksUrl, jwtIssuer, jwtAudience }) {
  const secretKey = jwtSecret ? new TextEncoder().encode(jwtSecret) : null;
  const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;
  const options = { audience: jwtAudience, ...(jwtIssuer ? { issuer: jwtIssuer } : {}) };

  async function verify(token) {
    const { alg } = decodeProtectedHeader(token);
    if (alg === 'HS256') {
      if (!secretKey) throw new Error('HS256 token แต่ไม่ได้ตั้ง JWT_SECRET');
      return (await jwtVerify(token, secretKey, { ...options, algorithms: ['HS256'] })).payload;
    }
    if (!jwks) throw new Error(`ไม่รองรับ alg ${alg} (ไม่ได้ตั้ง SUPABASE_JWKS_URL)`);
    return (await jwtVerify(token, jwks, options)).payload;
  }

  return async (req, res, next) => {
    if (/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(req.path)) return fail(req, res, errors.badRequest('path ไม่ถูกต้อง'));
    const match = matchRoute(routes, req.path);
    if (!match) return notFound(req, res);
    const { route, servicePath } = match;
    Object.assign(req.gw, { route, servicePath, service: route.name, isPublic: (route.public || []).includes(servicePath) });
    if (req.gw.isPublic) return next();
    const header = req.headers.authorization || '';
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      return fail(req, res, errors.unauthorized('กรุณาเข้าสู่ระบบ', 'TOKEN_MISSING'));
    }
    let claims;
    try {
      claims = await verify(token);
    } catch (e) {
      const expired = e?.code === 'ERR_JWT_EXPIRED';
      return fail(
        req,
        res,
        errors.unauthorized(expired ? 'token หมดอายุ' : 'token ไม่ถูกต้อง', expired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID'),
      );
    }
    if (!ALL_ROLES.includes(claims.user_role)) {
      return fail(req, res, errors.forbidden('บัญชีนี้ยังไม่มีสิทธิ์ใช้งาน', 'NO_ROLE'));
    }
    req.gw.user = { id: claims.sub, role: claims.user_role, branchId: claims.branch_id || null };
    next();
  };
}

// หากฎของ path จากตารางสิทธิ์ · role ต้องอยู่ในกฎ ไม่งั้น 403 · ไม่มีกฎ → 404
export function routeGuardMw({ permissions }) {
  return (req, res, next) => {
    if (req.gw.isPublic) return next();
    const { service, servicePath, user } = req.gw;
    const { rule, methodMismatch } = findRule(permissions, service, req.method, servicePath);
    if (methodMismatch) return fail(req, res, new AppError(405, 'METHOD_NOT_ALLOWED', 'ไม่รองรับ method นี้'));
    if (!rule) return notFound(req, res);
    if (!rule.roles.includes(user.role)) return fail(req, res, errors.forbidden());
    req.gw.rule = rule;
    next();
  };
}

// staff/manager ใช้ได้แค่สาขาตัวเอง · owner ส่ง ?branch_id= เลือกสาขาได้
export function branchScopeMw() {
  return (req, res, next) => {
    const { user } = req.gw;
    if (!user) return next();
    const requested = req.query?.branch_id;
    if (user.role === 'owner') {
      if (requested !== undefined && (typeof requested !== 'string' || !UUID_RE.test(requested))) {
        return fail(req, res, errors.badRequest('branch_id ต้องเป็น uuid', [{ field: 'branch_id', message: 'ต้องเป็น uuid' }]));
      }
      req.gw.branchId = requested || '';
      return next();
    }
    if (!user.branchId) return fail(req, res, errors.forbidden('บัญชีนี้ยังไม่ได้ผูกกับสาขา', 'NO_BRANCH'));
    req.gw.branchId = user.branchId;
    req.gw.dropBranchQuery = requested !== undefined;
    next();
  };
}

// path ขึ้นต้น /internal ตอบ 404 เสมอ (ใช้เฉพาะ service คุยกันเอง)
export function blockInternalMw() {
  return (req, res, next) => {
    const p = req.gw.servicePath;
    if (p === '/internal' || p.startsWith('/internal/')) return notFound(req, res);
    next();
  };
}

// หา IP ด้วย c-ares แทน dns.lookup เพื่อไม่ให้ service ที่ยังไม่มีทำให้ gateway ค้าง
export function fastLookup(hostname, options, callback) {
  if (typeof options === 'function') [callback, options] = [options, {}];
  const family = isIP(hostname);
  if (family || hostname === 'localhost') return dns.lookup(hostname, options, callback);
  let done = false;
  const finish = (err, address) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    if (err) return callback(err);
    if (options?.all) return callback(null, [{ address, family: isIP(address) }]);
    callback(null, address, isIP(address));
  };
  const timer = setTimeout(() => finish(Object.assign(new Error(`DNS timeout ${hostname}`), { code: 'ETIMEDOUT' })), 3000);
  dns.resolve4(hostname, (err4, a4) => {
    if (!err4 && a4.length) return finish(null, a4[0]);
    dns.resolve6(hostname, (err6, a6) => (!err6 && a6.length ? finish(null, a6[0]) : finish(err4 || err6)));
  });
}

const proxyAgent = new http.Agent({ keepAlive: true, lookup: fastLookup });

// ส่งต่อให้ service · ล่ม → 502, ช้าเกิน → 504
export function proxyMw({ internalKey, proxyTimeoutMs }) {
  const rewrite = (_path, req) => {
    const url = new URL(req.originalUrl || req.url, 'http://gateway');
    if (req.gw.dropBranchQuery) url.searchParams.delete('branch_id');
    return req.gw.servicePath + url.search;
  };

  // ใส่ header ภายในก่อนส่งต่อ (ทำที่ req.headers เพราะบาง Node ส่ง header ไปก่อน event proxyReq)
  const setInternalHeaders = (req) => {
    const { user, branchId, requestId } = req.gw;
    req.headers['x-request-id'] = requestId;
    req.headers['x-internal-key'] = internalKey;
    if (user) {
      req.headers['x-user-id'] = user.id;
      req.headers['x-user-role'] = user.role;
      req.headers['x-branch-id'] = branchId ?? '';
    }
  };

  const onProxyReq = (stream) => (proxyReq, req) => {
    if (!stream) {
      const timer = setTimeout(() => {
        req.gw.timedOut = true;
        proxyReq.destroy(new Error('upstream timeout'));
      }, proxyTimeoutMs);
      proxyReq.on('response', () => clearTimeout(timer));
      proxyReq.on('close', () => clearTimeout(timer));
    }
  };

  const onError = (err, req, res) => {
    if (res.headersSent || typeof res.status !== 'function') {
      res.end?.();
      return;
    }
    const e = req.gw?.timedOut ? errors.gatewayTimeout() : errors.badGateway(`service ${req.gw?.service ?? ''} ไม่ตอบสนอง`.trim());
    req.gw.proxyError = err?.code || err?.message;
    sendError(res, e, req.gw?.requestId);
  };

  const make = (stream) =>
    createProxyMiddleware({
      router: (req) => req.gw.route.target,
      target: 'http://placeholder.invalid',
      changeOrigin: true,
      xfwd: true,
      agent: proxyAgent,
      pathRewrite: rewrite,
      logger: { info() {}, warn() {}, error() {} },
      on: { proxyReq: onProxyReq(stream), error: onError },
    });

  const normal = make(false);
  const streaming = make(true);
  return (req, res, next) => {
    setInternalHeaders(req);
    return (req.gw.rule?.stream ? streaming : normal)(req, res, next);
  };
}

export function loggingMw({ logRequests, logger = console }) {
  return (req, res, next) => {
    if (!logRequests) return next();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - req.gw.startedAt) / 1e6;
      logger.log(
        JSON.stringify({
          time: new Date().toISOString(),
          request_id: req.gw.requestId,
          method: req.method,
          path: req.originalUrl.split('?')[0],
          status: res.statusCode,
          ms: Math.round(ms * 10) / 10,
          user_id: req.gw.user?.id ?? null,
          role: req.gw.user?.role ?? null,
          service: req.gw.service ?? null,
          ...(req.gw.proxyError ? { proxy_error: req.gw.proxyError } : {}),
        }),
      );
    });
    next();
  };
}

async function hostResolves(hostname, timeoutMs) {
  if (isIP(hostname) || hostname === 'localhost') return true;
  const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('dns timeout')), timeoutMs));
  try {
    const found = await Promise.race([dnsPromises.resolve4(hostname).catch(() => dnsPromises.resolve6(hostname)), timeout]);
    return found.length > 0;
  } catch {
    return false;
  }
}

// /health รวมสถานะทุก service (cache 5 วินาที)
export function healthHandler({ routes, cacheMs = 5000, timeoutMs = 2000 }) {
  let cached = null;
  let cachedAt = 0;
  let inflight = null;

  async function check() {
    const results = await Promise.all(
      routes.map(async (r) => {
        if (!(await hostResolves(new URL(r.target).hostname, timeoutMs))) return [r.name, 'down'];
        try {
          const resp = await fetch(`${r.target}/health`, { signal: AbortSignal.timeout(timeoutMs) });
          return [r.name, resp.ok ? 'ok' : `http_${resp.status}`];
        } catch {
          return [r.name, 'down'];
        }
      }),
    );
    return Object.fromEntries(results);
  }

  return async (_req, res) => {
    if (!cached || Date.now() - cachedAt > cacheMs) {
      inflight ??= check().finally(() => {
        inflight = null;
      });
      cached = await inflight;
      cachedAt = Date.now();
    }
    const allOk = Object.values(cached).every((s) => s === 'ok');
    res.status(allOk ? 200 : 503).json({ status: allOk ? 'ok' : 'degraded', gateway: 'ok', services: cached });
  };
}

// ประกอบ gateway: ลำดับ middleware สำคัญ ห้ามสลับ
export function createApp(config, { routes = buildRoutes(), permissions = PERMISSIONS, logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const compiled = compilePermissions(permissions);

  app.use(requestIdMw()); // 1. Request ID
  app.use(loggingMw({ logRequests: config.logRequests, logger })); // 10. Logging (เริ่มจับเวลาตั้งแต่ต้น บันทึกตอนตอบเสร็จ)
  app.use(corsMw(config)); // 2. CORS
  app.get('/health', healthHandler({ routes }));
  app.use(rateLimitMw(config)); // 3. Rate limit
  app.use(authMw({ ...config, routes })); // 4. Auth
  app.use(routeGuardMw({ permissions: compiled })); // 5. Route guard
  app.use(branchScopeMw()); // 6. Branch scope
  app.use(blockInternalMw()); // 7. Block internal
  app.use(proxyMw(config)); // 8. Proxy + 9. Error format

  app.use((req, res) => sendError(res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'), req.gw?.requestId));
  app.use(errorHandler({ logger }));
  return app;
}
