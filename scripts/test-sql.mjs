// รันเทสต์ SQL ของ schema pos บน Postgres ชั่วคราวใน Docker (ไม่แตะ Supabase จริง) แล้วลบ container ทิ้งเสมอ
// ใช้: node scripts/test-sql.mjs        (ต้องเปิด Docker Desktop ไว้)
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const NAME = `pos-sql-test-${process.pid}`
const SQL = [
  { file: 'supabase/tests/pos_smoke_test.sql', pass: 'ALL POS TESTS PASSED' },
  { file: 'supabase/tests/pos_vat_test.sql', pass: 'ALL VAT TESTS PASSED' },
]
const STUB = 'supabase/tests/pos_stub.sql'
const MIGRATION = 'supabase/migrations/20261119000300_pos.sql'

// MSYS_NO_PATHCONV กัน Git Bash แปลงพาธ /x.sql ในคำสั่ง docker ให้เพี้ยนบน Windows
const env = { ...process.env, MSYS_NO_PATHCONV: '1', MSYS2_ARG_CONV_EXCL: '*' }
const docker = (args, opts = {}) => spawnSync('docker', args, { encoding: 'utf8', env, cwd: root, ...opts })

function cleanup() {
  docker(['rm', '-f', NAME])
}
process.on('exit', cleanup)
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(130))

const up = docker(['run', '-d', '--name', NAME, '-e', 'POSTGRES_PASSWORD=test', 'postgres:16-alpine'])
if (up.status !== 0) {
  console.error('เปิด Postgres ชั่วคราวไม่ได้ (Docker ทำงานอยู่ไหม?)\n' + (up.stderr || up.error?.message))
  process.exit(2)
}

// รอ Postgres พร้อม (สูงสุด ~30 วินาที) — image นี้รีสตาร์ทหนึ่งรอบหลัง init จึงต้องเจอ ready ติดกัน 2 ครั้ง
let ready = 0
for (let i = 0; i < 60 && ready < 2; i += 1) {
  const r = docker(['exec', NAME, 'psql', '-U', 'postgres', '-tAc', 'select 1'])
  ready = r.status === 0 ? ready + 1 : 0
  if (ready < 2) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500)
}
if (ready < 2) {
  console.error('Postgres ไม่พร้อมใช้งานในเวลาที่กำหนด')
  process.exit(2)
}

let failed = 0
for (const { file, pass } of SQL) {
  const files = [STUB, MIGRATION, file]
  for (const f of files) docker(['cp', f, `${NAME}:/${f.split('/').pop()}`])
  const args = ['exec', NAME, 'psql', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1']
  for (const f of files) args.push('-f', `/${f.split('/').pop()}`)
  const r = docker(args)
  const out = `${r.stdout}\n${r.stderr}`
  const ok = r.status === 0 && out.includes(pass)
  const notices = out.split('\n').filter((l) => /NOTICE:\s+ok /.test(l)).length
  console.log(`${ok ? 'PASS' : 'FAIL'} ${file} (${notices} checks)`)
  if (!ok) {
    failed += 1
    console.log(out.split('\n').filter((l) => /FAIL|ERROR/.test(l)).join('\n') || out.slice(-1500))
  }
}
process.exit(failed ? 1 : 0)
