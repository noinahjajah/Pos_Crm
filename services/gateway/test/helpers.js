// ตัวช่วยเทสต์: service ปลอมที่ตอบ header ที่ได้รับกลับมา + สร้าง token แบบ Supabase

import http from 'node:http'
import { SignJWT } from 'jose'
import { createApp } from '../src/app.js'
import { SERVICES } from '../src/access.config.js'
import { createTokenVerifier } from '../src/verifyToken.js'

export const SECRET = 'test-secret-at-least-32-characters-long!!'
export const SUPABASE_URL = 'https://test-project.supabase.co'
export const INTERNAL_KEY = 'internal-test-key'

export const IDS = {
  staff: '11111111-1111-4111-8111-111111111111',
  manager: '22222222-2222-4222-8222-222222222222',
  owner: '33333333-3333-4333-8333-333333333333',
  noProfile: '44444444-4444-4444-8444-444444444444',
  branchA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  branchB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

/** สร้าง JWT แบบที่ Supabase ออก (role = authenticated) + claim เพิ่มเติม */
export async function makeToken(claims = {}, { secret = SECRET, expiresIn = '1h', issuer = `${SUPABASE_URL}/auth/v1` } = {}) {
  const { sub = IDS.noProfile, ...rest } = claims
  return new SignJWT({ role: 'authenticated', aud: 'authenticated', ...rest })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuer(issuer)
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(new TextEncoder().encode(secret))
}

/** token ของพนักงานที่มี profile (hook ใส่ user_role + branch_id ให้แล้ว) */
export const tokenFor = {
  staff: () => makeToken({ sub: IDS.staff, user_role: 'staff', branch_id: IDS.branchA }),
  manager: () => makeToken({ sub: IDS.manager, user_role: 'manager', branch_id: IDS.branchA }),
  owner: () => makeToken({ sub: IDS.owner, user_role: 'owner', branch_id: null }),
}

/** เปิด service ปลอม 1 ตัว ตอบ { service, method, url, headers } · นับจำนวนครั้งที่ถูกเรียก */
export async function startUpstream({ delayMs = 0 } = {}) {
  const hits = []
  const server = http.createServer((req, res) => {
    hits.push({ method: req.method, url: req.url, headers: req.headers })
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: { method: req.method, url: req.url, headers: req.headers, body } }))
      }, delayMs)
    })
  })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { url: `http://127.0.0.1:${server.address().port}`, hits, close: () => new Promise((r) => server.close(r)) }
}

/** เปิด gateway ที่ทุก service ชี้ไป upstream ตัวเดียวกัน */
export async function startGateway(upstreamUrl, overrides = {}) {
  const app = createApp({
    verifyToken: createTokenVerifier({ supabaseUrl: SUPABASE_URL, jwtSecret: SECRET }),
    internalKey: INTERNAL_KEY,
    targets: Object.fromEntries(SERVICES.map((s) => [s.name, upstreamUrl])),
    rateLimits: { general: 100_000, auth: 100_000 },
    logger: null,
    ...overrides,
  })
  const server = await new Promise((r) => {
    const s = app.listen(0, '127.0.0.1', () => r(s))
  })
  const base = `http://127.0.0.1:${server.address().port}`
  return {
    base,
    request: (method, path, { token, headers = {}, body } = {}) =>
      fetch(base + path, {
        method,
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      }),
    close: () => new Promise((r) => server.close(r)),
  }
}

/** ทุกแถวในตารางสิทธิ์ เป็น { method, url, roles, isPublic } (แทน :param ด้วย uuid) */
export function allRoutes() {
  const fill = (path) => path.replace(/:[^/]+/g, IDS.branchB)
  return SERVICES.flatMap((s) => [
    ...(s.public || []).map(([method, path]) => ({ method, url: s.prefix + fill(path), roles: [], isPublic: true })),
    ...s.routes.map(([method, path, roles]) => ({ method, url: s.prefix + fill(path), roles, isPublic: false })),
  ])
}
