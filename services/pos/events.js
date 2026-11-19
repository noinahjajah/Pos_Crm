// แจ้งเตือนคำขออนุมัติแบบ realtime ผ่าน SSE (1.29) — GET /approvals/stream
// เก็บผู้ฟังในหน่วยความจำของ process นี้ → ใช้ได้กับ pos ตัวเดียว
// ถ้าจะรันหลายตัว ให้เปลี่ยนเป็น Postgres LISTEN/NOTIFY หรือ Supabase Realtime (ตาราง approvals เปิด publication ไว้แล้ว)

const HEARTBEAT_MS = 20_000
const clients = new Set() // { res, user }

/** ผู้ใช้คนนี้ควรเห็นคำขอนี้ไหม: owner ทุกสาขา · manager สาขาตัวเอง */
const canSee = (user, approval) => user.role === 'owner' || (user.role === 'manager' && user.branchId === approval.branch_id)

/** route handler: เปิด stream ค้างไว้จนผู้ใช้ปิด */
export function approvalStream(req, res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // กัน proxy (nginx) เก็บข้อความไว้ก่อนส่ง
  })
  res.flushHeaders?.()
  res.write(': connected\n\n')

  const client = { res, user: req.user }
  clients.add(client)
  const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  req.on('close', () => {
    clearInterval(beat)
    clients.delete(client)
  })
}

/** ส่งคำขอใหม่/เปลี่ยนสถานะให้ทุกคนที่มีสิทธิ์เห็น */
export function publishApproval(approval) {
  const line = `event: approval\ndata: ${JSON.stringify({ approval })}\n\n`
  for (const c of clients) {
    if (canSee(c.user, approval)) c.res.write(line)
  }
}

export const streamCount = () => clients.size
