// ตรวจ JWT ของ Supabase (ลายเซ็น วันหมดอายุ issuer audience)
// - มี SUPABASE_JWT_SECRET → HS256 (JWT secret แบบเก่า)
// - ไม่มี → JWKS ของโปรเจกต์ (signing key แบบใหม่ RS256/ES256)
// ไฟล์นี้ตอบแค่ว่า token จริงไหม — เรื่อง role/สิทธิ์อยู่ที่ access.config.js

import { createRemoteJWKSet, jwtVerify } from 'jose'

export function createTokenVerifier({ supabaseUrl, jwtSecret, issuer, audience = 'authenticated' }) {
  const iss = issuer ?? (supabaseUrl ? `${supabaseUrl.replace(/\/$/, '')}/auth/v1` : undefined)

  if (jwtSecret) {
    const key = new TextEncoder().encode(jwtSecret)
    return async (token) => (await jwtVerify(token, key, { algorithms: ['HS256'], issuer: iss, audience })).payload
  }
  if (!supabaseUrl) throw new Error('ต้องตั้ง SUPABASE_URL (ใช้ JWKS) หรือ SUPABASE_JWT_SECRET')

  const jwks = createRemoteJWKSet(new URL(`${iss}/.well-known/jwks.json`))
  return async (token) => (await jwtVerify(token, jwks, { algorithms: ['RS256', 'ES256'], issuer: iss, audience })).payload
}
