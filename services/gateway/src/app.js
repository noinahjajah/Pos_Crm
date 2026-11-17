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

// config
const env = process.env;

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

// service ปลายทาง

export function buildRoutes(env = process.env) {
  return [
    { name: 'identity', prefix: '/api/v1/identity', target: env.IDENTITY_URL || 'http://identity:3001' },
    { name: 'catalog', prefix: '/api/v1/catalog', target: env.CATALOG_URL || 'http://catalog:3002' },
    { name: 'pos', prefix: '/api/v1/pos', target: env.POS_URL || 'http://pos:3003' },
    { name: 'payment', prefix: '/api/v1/payment', target: env.PAYMENT_URL || 'http://payment:3004' },
  ];
}

/** หา service จาก path เต็ม → { route, servicePath } */
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

// header ที่ client ห้ามส่งเอง (gateway เป็นคนใส่เท่านั้น)
const TRUSTED_HEADERS = [HEADERS.USER_ID, HEADERS.USER_ROLE, HEADERS.BRANCH_ID, HEADERS.INTERNAL_KEY];

// 1. Request ID
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

// 2. CORS
export function corsMw({ corsOrigins }) {
  return cors({
    origin: (origin, cb) => cb(null, !origin || corsOrigins.includes('*') || corsOrigins.includes(origin)),
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key', 'X-Request-Id'],
    exposedHeaders: ['X-Request-Id', 'RateLimit-Remaining', 'Retry-After'],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  });
}

// 3. Rate limit
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

// (ก่อน 4) หา service และ rule จากตารางสิทธิ์
export function resolveRouteMw({ routes, permissions }) {
  return (req, res, next) => {
    if (/(^|\/)\.\.?(\/|$)|%2e|%2f|%5c|\\/i.test(req.path)) {
      return fail(req, res, errors.badRequest('path ไม่ถูกต้อง'));
    }
    const match = matchRoute(routes, req.path);
    if (!match) return fail(req, res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'));
    const { route, servicePath } = match;
    if (servicePath === '/internal' || servicePath.startsWith('/internal/')) {
      return fail(req, res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'));
    }
    const { rule, methodMismatch } = findRule(permissions, route.name, req.method, servicePath);
    if (methodMismatch) return fail(req, res, new AppError(405, 'METHOD_NOT_ALLOWED', 'ไม่รองรับ method นี้'));
    if (!rule) return fail(req, res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'));
    Object.assign(req.gw, { route, servicePath, rule, service: route.name });
    next();
  };
}

// 4. Auth
export function authMw({ jwtSecret, jwksUrl, jwtIssuer, jwtAudience }) {
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
    if (req.gw.rule.roles === 'public') return next();
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

// 5. Route guard
export function routeGuardMw() {
  return (req, res, next) => {
    const { rule, user } = req.gw;
    if (rule.roles === 'public') return next();
    if (!rule.roles.includes(user.role)) return fail(req, res, errors.forbidden());
    next();
  };
}

// 6. Branch scope
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

// DNS ที่ไม่ใช้ thread pool
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

// 8. Proxy + 9. Error format (service ล่ม → 502, ช้า → 504)
export function proxyMw({ internalKey, proxyTimeoutMs }) {
  const rewrite = (_path, req) => {
    const url = new URL(req.originalUrl || req.url, 'http://gateway');
    if (req.gw.dropBranchQuery) url.searchParams.delete('branch_id');
    return req.gw.servicePath + url.search;
  };

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
    return (req.gw.rule.stream ? streaming : normal)(req, res, next);
  };
}

// 10. Logging
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

// health รวมสถานะทุก service
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

// express app
export function createApp(config, { routes = buildRoutes(), permissions = PERMISSIONS, logger = console } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  const compiled = compilePermissions(permissions);

  app.use(requestIdMw());
  app.use(loggingMw({ logRequests: config.logRequests, logger }));
  app.use(corsMw(config));
  app.get('/health', healthHandler({ routes }));
  app.use(rateLimitMw(config));
  app.use(resolveRouteMw({ routes, permissions: compiled }));
  app.use(authMw(config));
  app.use(routeGuardMw());
  app.use(branchScopeMw());
  app.use(proxyMw(config));

  app.use((req, res) => sendError(res, errors.notFound('ไม่พบ endpoint นี้', 'ROUTE_NOT_FOUND'), req.gw?.requestId));
  app.use(errorHandler({ logger }));
  return app;
}
