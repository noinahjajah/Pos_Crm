// =====================================================================
// แดชบอร์ดแบบ realtime (Dev 2) — SSE GET /api/v1/payment/reports/stream (manager/owner)
// - payment ส่งสัญญาณ { kind: 'charge' | 'refund' | 'expense', branch_id, at } เมื่อยอดขาย/รายจ่ายเปลี่ยน
//   หน้าแดชบอร์ดได้สัญญาณแล้วโหลดรายงานใหม่เอง
// - เปิดการเชื่อมต่อเส้นเดียวต่อแท็บ ใช้ร่วมกันทุก component ปิดเองเมื่อไม่มีใครฟัง
// - หลุด → ต่อใหม่อัตโนมัติ (รอ 2, 4, 8 … สูงสุด 30 วินาที) · ผู้ใช้ฝั่งหน้าควร poll สำรองเมื่อ live = false
// อ่านด้วย fetch เพราะ EventSource แนบ Authorization ไม่ได้ (แบบเดียวกับ approvalFeed.js)
// =====================================================================

import { useEffect, useRef, useState } from 'react'
import { API_BASE, api, authHeaders } from './client'

const listeners = new Set()
const stateListeners = new Set()
let live = false
let stop = null

function setLive(next) {
  if (live === next) return
  live = next
  stateListeners.forEach((fn) => fn(live))
}

/** ข้อมูลของบล็อก SSE (บรรทัด data:) · comment/heartbeat → null */
function parseBlock(block) {
  const data = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
  }
  if (!data.length) return null
  try {
    return JSON.parse(data.join('\n'))
  } catch {
    return null
  }
}

function startSse() {
  const controller = new AbortController()
  let retry = 2000
  let timer = null

  async function connect() {
    try {
      const res = await fetch(`${API_BASE}/payment/reports/stream`, {
        headers: { Accept: 'text/event-stream', ...authHeaders() },
        signal: controller.signal,
      })
      if (res.status === 401) {
        // token หมดอายุ → ให้ client ขอ token ใหม่ผ่าน request ธรรมดาแล้วค่อยต่อใหม่
        await api.get('/identity/me').catch(() => {})
        throw new Error('unauthorized')
      }
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      setLive(true)
      retry = 2000
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buffer = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += value
        const blocks = buffer.split(/\r?\n\r?\n/)
        buffer = blocks.pop()
        for (const block of blocks) {
          const event = parseBlock(block)
          if (event) listeners.forEach((fn) => fn(event))
        }
      }
      throw new Error('stream closed')
    } catch (err) {
      if (controller.signal.aborted) return
      setLive(false)
      timer = setTimeout(connect, retry)
      retry = Math.min(retry * 2, 30_000)
      if (import.meta.env.DEV) console.debug('[reports] stream ขาด ต่อใหม่ใน', retry / 1000, 'วินาที', err.message)
    }
  }

  connect()
  return () => {
    controller.abort()
    clearTimeout(timer)
    setLive(false)
  }
}

/** ฟังสัญญาณยอดขาย/รายจ่ายเปลี่ยน · คืนฟังก์ชันเลิกฟัง */
export function subscribeReports(fn) {
  listeners.add(fn)
  if (!stop) stop = startSse()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && stop) {
      stop()
      stop = null
    }
  }
}

/**
 * hook: เรียก onEvent({ kind, branch_id, at }) ทุกครั้งที่ยอดขาย/รายจ่ายเปลี่ยน · คืน live (true = ต่อ realtime อยู่)
 * enabled = false → ไม่ต่อ
 */
export function useReportFeed(onEvent, enabled = true) {
  const handler = useRef(onEvent)
  const [isLive, setIsLive] = useState(live)

  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    if (!enabled) return
    stateListeners.add(setIsLive)
    const off = subscribeReports((e) => handler.current?.(e))
    return () => {
      off()
      stateListeners.delete(setIsLive)
    }
  }, [enabled])

  return enabled && isLive
}
