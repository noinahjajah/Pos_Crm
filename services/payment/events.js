// แจ้งแดชบอร์ดแบบ realtime ผ่าน SSE — GET /reports/stream (manager/owner)
// ส่งเหตุการณ์ทุกครั้งที่ยอดขาย/รายจ่ายเปลี่ยน: รับเงิน (charge) · คืนเงิน (refund) · เพิ่ม/แก้/ลบรายจ่าย (expense)
// หน้าเว็บได้แค่สัญญาณ แล้วโหลดรายงานใหม่เอง (ไม่ส่งตัวเลขผ่าน stream)
// เก็บผู้ฟังในหน่วยความจำของ process นี้ → ใช้ได้กับ payment ตัวเดียว (เหมือน pos/events.js)

const HEARTBEAT_MS = 20_000
const clients = new Set() // { res, user }

/** owner เห็นทุกสาขา · manager เห็นเฉพาะสาขาตัวเอง */
const canSee = (user, event) => user.role === 'owner' || (user.role === 'manager' && user.branchId === event.branch_id)

/** route handler: เปิด stream ค้างไว้จนผู้ใช้ปิด */
export function reportStream(req, res) {
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

/**
 * แจ้งว่าตัวเลขของสาขานี้เปลี่ยน · kind: 'charge' | 'refund' | 'expense'
 * เรียกหลังบันทึกสำเร็จเท่านั้น · ส่งไม่ได้ (ผู้ฟังหลุด) ไม่กระทบ request หลัก
 */
export function publishReport(kind, branchId) {
  if (!branchId || clients.size === 0) return
  const event = { kind, branch_id: branchId, at: new Date().toISOString() }
  const line = `event: report\ndata: ${JSON.stringify(event)}\n\n`
  for (const c of clients) {
    if (!canSee(c.user, event)) continue
    try {
      c.res.write(line)
    } catch {
      clients.delete(c)
    }
  }
}

export const streamCount = () => clients.size
