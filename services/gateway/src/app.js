// API Gateway (Dev 1) — middleware เรียงตามข้อ 2 ในเอกสาร/pos-crm-phase1-spec.md
//
//  1 Request ID → 2 CORS → (หา route) → 7 Block internal → 3 Rate limit
//  → ลบ header ที่ client ปลอม → 4 Auth (JWT + role จากระบบ) → 5 Route guard → 6 Branch scope
//  → 8 Proxy → 9 Error format · 10 Logging (ผูกตอนจบ response)
//
// Block internal ย้ายมาก่อน Auth เพื่อให้ /internal/* ตอบ 404 เสมอ ไม่ว่ามี token หรือไม่
// สิทธิ์และ header ทั้งหมดมาจาก access.config.js ไฟล์นี้แค่เรียกใช้

import { randomUUID } from 'node:crypto'
import express from 'express'
import { rateLimit } from 'express-rate-limit'
import { identityHeaders, principalFromClaims, resolveBranch, TRUSTED_HEADER_PREFIXES } from './access.config.js'
import { errorFormat, GatewayError } from './errors.js'
import { proxyTo } from './proxy.js'
import { buildRouteTable } from './routeTable.js'

const BEARER_RE = /^Bearer\s+(\S+)$/i

/**
 * options:
 *   verifyToken(token) → claims (โยน error ถ้าไม่ผ่าน)
 *   targets            { identity, catalog, pos, payment } URL ของ service
 *   internalKey        X-Internal-Key
 *   corsOrigins        ['http://localhost:5173']
 *   rateLimits         { general: 300, auth: 10, windowMs: 60000 }
 *   timeoutMs          10000
 *   trustProxy         ค่าของ express 'trust proxy'
 *   logger             { info, warn, error } (ส่ง null = ไม่ log)
 */
export function createApp(options) {
  const {
    verifyToken,
    targets = {},
    internalKey,
    corsOrigins = [],
    rateLimits = {},
    timeoutMs = 10_000,
    trustProxy = false,
    logger = defaultLogger,
  } = options
  if (typeof verifyToken !== 'function') throw new Error('createApp: ต้องส่ง verifyToken')
  if (!internalKey) throw new Error('createApp: ต้องส่ง internalKey')

  const table = buildRouteTable(targets)
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', trustProxy)

  // 1) Request ID + 10) Logging
  app.use((req, res, next) => {
    const incoming = req.get('x-request-id')
    req.id = incoming && /^[\w-]{1,100}$/.test(incoming) ? incoming : randomUUID()
    res.setHeader('X-Request-Id', req.id)
    req.log = logger || silentLogger
    const started = process.hrtime.bigint()
    res.on('finish', () => {
      req.log.info({
        request_id: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - started) / 1_000_000n),
        user_id: req.principal?.userId,
        role: req.principal?.role,
      })
    })
    next()
  })

  // 2) CORS — อนุญาตเฉพาะโดเมนเว็บแอป
  const allowed = new Set(corsOrigins)
  app.use((req, res, next) => {
    const origin = req.get('origin')
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id')
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE')
        res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type,Idempotency-Key,X-Request-Id')
        res.setHeader('Access-Control-Max-Age', '600')
        return res.status(204).end()
      }
    }
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })

  // health ของ gateway รวมสถานะ service
  app.get('/health', async (req, res) => {
    const results = await Promise.all(
      table.services.map(async (s) => {
        try {
          const r = await fetch(`${s.target}/health`, { signal: AbortSignal.timeout(2000) })
          return [s.name, r.ok ? 'up' : 'down']
        } catch {
          return [s.name, 'down']
        }
      }),
    )
    const services = Object.fromEntries(results)
    res.status(Object.values(services).every((v) => v === 'up') ? 200 : 503).json({ status: 'ok', services })
  })

  // หา service + แถวในตารางสิทธิ์
  app.use((req, res, next) => {
    const pathname = req.path
    // กัน path แปลก ๆ (../, %2F) ที่อาจทำให้ service ตีความต่างจาก gateway
    if (/(^|\/)\.\.?(\/|$)|%2f|%5c|\\/i.test(req.originalUrl.split('?')[0])) {
      return next(new GatewayError(400, 'BAD_PATH', 'path ไม่ถูกต้อง'))
    }
    const found = table.match(req.method, pathname)
    if (!found.service) return next(new GatewayError(404, 'NOT_FOUND', 'ไม่พบ API นี้'))

    // 7) Block internal — /internal/* ห้ามเรียกจากข้างนอกเสมอ
    if (found.path === '/internal' || found.path.startsWith('/internal/')) {
      return next(new GatewayError(404, 'NOT_FOUND', 'ไม่พบ API นี้'))
    }
    req.gw = { ...found }
    next()
  })

  // 3) Rate limit — ทั่วไป 300/นาที/IP · login/refresh 10/นาที/IP
  const windowMs = rateLimits.windowMs ?? 60_000
  const limitHandler = (req, res, next, opts) =>
    next(new GatewayError(opts.statusCode, 'RATE_LIMITED', 'เรียกถี่เกินไป กรุณารอสักครู่'))
  const generalLimiter = rateLimit({ windowMs, limit: rateLimits.general ?? 300, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler })
  const authLimiter = rateLimit({ windowMs, limit: rateLimits.auth ?? 10, standardHeaders: 'draft-7', legacyHeaders: false, handler: limitHandler })
  app.use((req, res, next) => (req.gw.rule?.options.rateLimit === 'auth' ? authLimiter : generalLimiter)(req, res, next))

  // ลบ header ที่ gateway เป็นคนใส่ ถ้า client ส่งมาเอง (กันปลอมตัวเป็น owner ด้วย X-User-Role)
  app.use((req, res, next) => {
    for (const key of Object.keys(req.headers)) {
      if (TRUSTED_HEADER_PREFIXES.some((p) => key.startsWith(p))) delete req.headers[key]
    }
    next()
  })

  // 4) Auth — JWT ต้องถูกต้อง และต้องมี role ที่ระบบกำหนด
  app.use(async (req, res, next) => {
    if (req.gw.rule?.isPublic) return next()

    const token = BEARER_RE.exec(req.get('authorization') || '')?.[1]
    if (!token) return next(new GatewayError(401, 'UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'))

    let claims
    try {
      claims = await verifyToken(token)
    } catch {
      return next(new GatewayError(401, 'TOKEN_INVALID', 'token ไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่'))
    }

    const principal = principalFromClaims(claims)
    if (!principal) {
      // token จริง แต่ไม่มี role ที่ระบบกำหนด (ไม่มี profile / role ไม่รู้จัก / ไม่มีสาขา) → 403 ทุก route
      return next(new GatewayError(403, 'NO_ROLE', 'บัญชีนี้ไม่มีสิทธิ์ใช้งานระบบ'))
    }
    req.principal = principal
    next()
  })

  // 5) Route guard — ไม่อยู่ในตาราง หรือ role ไม่อยู่ในแถวนั้น → 403
  app.use((req, res, next) => {
    const { rule } = req.gw
    if (rule?.isPublic) return next()
    if (!rule || !rule.roles.includes(req.principal.role)) {
      return next(new GatewayError(403, 'FORBIDDEN', 'คุณไม่มีสิทธิ์ทำรายการนี้'))
    }
    next()
  })

  // 6) Branch scope + สร้าง header ที่ส่งต่อ
  app.use((req, res, next) => {
    const branchId = req.principal ? resolveBranch(req.principal, req.query) : ''
    req.gw.forwardHeaders = {
      'X-Request-Id': req.id,
      'X-Internal-Key': internalKey,
      ...identityHeaders(req.principal, branchId),
    }
    next()
  })

  // 8) Proxy
  app.use(proxyTo({ timeoutMs }))

  // 9) Error format
  app.use(errorFormat)

  return app
}

const silentLogger = { info() {}, warn() {}, error() {} }
const defaultLogger = {
  info: (o) => console.log(JSON.stringify(o)),
  warn: (o) => console.warn(JSON.stringify(o)),
  error: (e) => console.error(e),
}
