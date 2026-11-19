// แจ้งจอครัวและคำขออนุมัติแบบทันที (SSE) · ทุกการเปลี่ยนแปลงผ่าน pos service จึงแจ้งจากที่นี่ได้เลย
import { EventEmitter } from 'node:events'

const bus = new EventEmitter()
bus.setMaxListeners(0)

/** ส่งเหตุการณ์ เช่น publish('ticket', { branch_id, id, status }) */
export const publish = (type, payload) => bus.emit('event', { type, ...payload })

/**
 * เปิด SSE ให้ client · accept(event) = true ถ้าควรส่งเหตุการณ์นี้ให้ผู้ใช้คนนี้
 * client ได้รับแค่ "มีอะไรเปลี่ยน" แล้วไปดึงรายละเอียดเองผ่าน gateway
 */
export function openStream(req, res, accept) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  res.flushHeaders()
  res.write('retry: 3000\n\n')
  const listener = (event) => {
    if (accept(event)) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
  }
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000)
  bus.on('event', listener)
  req.on('close', () => {
    clearInterval(ping)
    bus.off('event', listener)
  })
}
