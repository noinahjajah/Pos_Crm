// รันเทสต์อัตโนมัติทั้งระบบ (ไม่ใช้ Supabase จริง): unit ของทุก service + gateway + SQL ของ pos
// ใช้: node scripts/test-all.mjs          ทุกอย่าง
//      node scripts/test-all.mjs --no-sql  ข้าม SQL (ถ้าไม่ได้เปิด Docker)
// (เทสต์ที่ยิง stack จริง/ต้องมีรหัสผ่านอยู่แยก: services/pos/test/sse-gateway.live.mjs, services/pos/test/e2e.mjs)
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const skipSql = process.argv.includes('--no-sql')
const results = []

function step(name, cmd, args, cwd) {
  console.log(`\n=== ${name}`)
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' })
  results.push([name, r.status === 0])
}

for (const svc of ['gateway', 'identity', 'catalog', 'payment', 'pos']) {
  const dir = `${root}services/${svc}`
  if (!existsSync(`${dir}/node_modules`)) {
    console.log(`\n=== ${svc}: ยังไม่ได้ติดตั้ง dependency → รัน npm ci ก่อน`)
    spawnSync('npm', ['ci', '--silent'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' })
  }
  step(`${svc} (unit)`, 'npm', ['test', '--silent'], dir)
}
if (!skipSql) step('pos (SQL บน Postgres ชั่วคราว)', 'node', ['scripts/test-sql.mjs'], root)

console.log('\n=== สรุป')
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
process.exit(results.every(([, ok]) => ok) ? 0 : 1)
