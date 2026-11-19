import 'dotenv/config'
import { SERVICES } from './access.config.js'
import { createApp } from './app.js'
import { createTokenVerifier } from './verifyToken.js'

const env = process.env
const required = (name) => {
  if (!env[name]) throw new Error(`ยังไม่ได้ตั้ง ${name} ในไฟล์ .env`)
  return env[name]
}

const app = createApp({
  verifyToken: createTokenVerifier({ supabaseUrl: env.SUPABASE_URL, jwtSecret: env.SUPABASE_JWT_SECRET }),
  internalKey: required('INTERNAL_KEY'),
  targets: Object.fromEntries(SERVICES.map((s) => [s.name, env[s.targetEnv] || s.defaultTarget])),
  corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  trustProxy: env.TRUST_PROXY ? (/^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY) : false,
  timeoutMs: Number(env.UPSTREAM_TIMEOUT_MS) || 10_000,
})

const port = Number(env.PORT) || 8080
app.listen(port, () => console.log(`gateway :${port}`))
