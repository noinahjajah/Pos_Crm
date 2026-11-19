// ทดสอบ SSE แจ้งเตือนอนุมัติ ผ่าน gateway จริง (stack ต้องรันอยู่: docker compose up) — อ่านอย่างเดียว ไม่เขียนข้อมูล
// ส่วนที่ test/e2e.mjs และ events.test.js ครอบคลุมไม่ถึง: gateway ต้องไม่ตัด stream ตาม timeout 10 วินาที,
// ต้องไม่ buffer ข้อความ และต้องกัน role ที่ไม่มีสิทธิ์
//
// รัน (ตั้ง env ก่อน ไม่ฝังรหัสผ่านในไฟล์):
//   GATEWAY=http://localhost:8080 POS_MANAGER_USER=... POS_MANAGER_PASS=... POS_OWNER_USER=... POS_OWNER_PASS=... \
//   POS_STAFF_USER=... POS_STAFF_PASS=... node services/pos/test/sse-gateway.live.mjs
const GW = process.env.GATEWAY || 'http://localhost:8080'
const need = ['POS_MANAGER_USER', 'POS_MANAGER_PASS', 'POS_OWNER_USER', 'POS_OWNER_PASS', 'POS_STAFF_USER', 'POS_STAFF_PASS']
const missing = need.filter((k) => !process.env[k])
if (missing.length) {
  console.error('ขาด env: ' + missing.join(', '))
  process.exit(2)
}

let failed = 0
const check = (cond, name, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : '  ' + extra}`)
}

async function login(username, password) {
  const r = await fetch(`${GW}/api/v1/identity/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  const j = await r.json()
  const token = j.data?.access_token || j.data?.session?.access_token || j.data?.token
  if (!token) throw new Error(`login ${username} ไม่สำเร็จ (${r.status})`)
  return token
}

/** เปิด stream แล้วเก็บข้อความไว้ · คืน { res, text(), close() } */
async function openStream(token) {
  const ac = new AbortController()
  const res = await fetch(`${GW}/api/v1/pos/approvals/stream`, {
    headers: { authorization: `Bearer ${token}`, accept: 'text/event-stream' },
    signal: ac.signal,
  })
  let text = ''
  let ended = false
  if (res.ok && res.body) {
    ;(async () => {
      try {
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) text += chunk
      } catch {
        /* abort */
      }
      ended = true
    })()
  }
  return { res, text: () => text, ended: () => ended, close: () => ac.abort() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const staff = await login(process.env.POS_STAFF_USER, process.env.POS_STAFF_PASS)
const manager = await login(process.env.POS_MANAGER_USER, process.env.POS_MANAGER_PASS)
const owner = await login(process.env.POS_OWNER_USER, process.env.POS_OWNER_PASS)

// สิทธิ์
check((await fetch(`${GW}/api/v1/pos/approvals/stream`)).status === 401, 'ไม่มี token → 401')
const s = await fetch(`${GW}/api/v1/pos/approvals/stream`, { headers: { authorization: `Bearer ${staff}` } })
check(s.status === 403, 'staff เปิด stream → 403', String(s.status))
await s.body?.cancel()

// manager + owner เปิด stream ได้ ได้ header SSE และได้ข้อความแรกทันที (ไม่ถูก buffer)
const m = await openStream(manager)
const o = await openStream(owner)
check(m.res.status === 200 && /text\/event-stream/.test(m.res.headers.get('content-type') || ''), 'manager: 200 + text/event-stream', `${m.res.status} ${m.res.headers.get('content-type')}`)
check(o.res.status === 200, 'owner: 200', String(o.res.status))
await sleep(1000)
check(m.text().includes(': connected'), 'manager ได้ข้อความแรกทันที (gateway ไม่ buffer)', JSON.stringify(m.text()))
check(o.text().includes(': connected'), 'owner ได้ข้อความแรกทันที')

// gateway ตัด request ทั่วไปที่ 10 วินาที — stream ต้องอยู่เกินนั้น
console.log('  รอ 12 วินาที เพื่อดูว่า gateway ไม่ตัด stream ...')
await sleep(12_000)
check(!m.ended() && !o.ended(), 'stream ยังเปิดอยู่หลังเกิน 10 วินาที (ไม่ถูก timeout/504)')

m.close()
o.close()
console.log(failed ? `\n${failed} FAILED` : '\nALL LIVE SSE TESTS PASSED')
process.exit(failed ? 1 : 0)
