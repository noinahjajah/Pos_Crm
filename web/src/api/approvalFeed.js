// =====================================================================
// แจ้งเตือนคำขออนุมัติแบบ realtime (1.29) — Dev 3
// - SSE GET /api/v1/pos/approvals/stream (manager/owner) อ่านด้วย fetch เพราะ EventSource แนบ Authorization ไม่ได้
// - เปิดการเชื่อมต่อเส้นเดียวต่อแท็บ ใช้ร่วมกันทุก component (กระดิ่ง + หน้ารออนุมัติ) ปิดเองเมื่อไม่มีใครฟัง
// - หลุด → ต่อใหม่อัตโนมัติ (รอ 2, 4, 8 … สูงสุด 30 วินาที) · ผู้ใช้ฝั่งหน้าควร poll สำรองเมื่อ live = false
// - VITE_POS_MODE=mock → ฟังเหตุการณ์จาก posMock (แท็บเดียวกัน + แท็บอื่นผ่าน localStorage)
//
// เหตุการณ์ที่ส่งให้ listener: { approval } — approval ที่สร้างใหม่หรือเปลี่ยนสถานะ (อาจเป็น null ถ้า server ส่งแค่สัญญาณ)
// =====================================================================

import { useEffect, useRef, useState } from 'react'
import { API_BASE, api, authHeaders } from './client'
import { POS_MOCK } from './pos'
import { MOCK_EVENT } from './posMock'

const listeners = new Set()
const stateListeners = new Set()
let live = false
let stop = null

function setLive(next) {
  if (live === next) return
  live = next
  stateListeners.forEach((fn) => fn(live))
}
const emit = (event) => listeners.forEach((fn) => fn(event))

/** แยกข้อความ SSE เป็นเหตุการณ์ (บล็อกคั่นด้วยบรรทัดว่าง) */
function parseBlock(block) {
  let name = 'message'
  const data = []
  for (const line of block.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) continue // comment = heartbeat
    const i = line.indexOf(':')
    const field = i === -1 ? line : line.slice(0, i)
    const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '')
    if (field === 'event') name = value
    else if (field === 'data') data.push(value)
  }
  if (!data.length) return null
  const text = data.join('\n')
  try {
    return { name, data: JSON.parse(text) }
  } catch {
    return { name, data: text }
  }
}

function startSse() {
  const controller = new AbortController()
  let retry = 2000
  let timer = null

  async function connect() {
    try {
      const res = await fetch(`${API_BASE}/pos/approvals/stream`, {
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
          const ev = parseBlock(block)
          if (!ev) continue
          const approval = ev.data && typeof ev.data === 'object' ? ev.data.approval || ev.data : null
          emit({ approval })
        }
      }
      throw new Error('stream closed')
    } catch (err) {
      if (controller.signal.aborted) return
      setLive(false)
      timer = setTimeout(connect, retry)
      retry = Math.min(retry * 2, 30_000)
      if (import.meta.env.DEV) console.debug('[approvals] stream ขาด ต่อใหม่ใน', retry / 1000, 'วินาที', err.message)
    }
  }

  connect()
  return () => {
    controller.abort()
    clearTimeout(timer)
    setLive(false)
  }
}

function startMock() {
  const onEvent = (e) => emit({ approval: e.detail || null })
  window.addEventListener(MOCK_EVENT, onEvent)
  setLive(true)
  return () => {
    window.removeEventListener(MOCK_EVENT, onEvent)
    setLive(false)
  }
}

/** ฟังเหตุการณ์คำขอ · คืนฟังก์ชันเลิกฟัง */
export function subscribeApprovals(fn) {
  listeners.add(fn)
  if (!stop) stop = POS_MOCK ? startMock() : startSse()
  return () => {
    listeners.delete(fn)
    if (listeners.size === 0 && stop) {
      stop()
      stop = null
    }
  }
}

/**
 * hook: เรียก onEvent ทุกครั้งที่มีคำขอใหม่/เปลี่ยนสถานะ · คืน live (true = ต่อ realtime อยู่)
 * enabled = false → ไม่ต่อ (เช่น staff ที่ไม่มีสิทธิ์ฟัง)
 */
export function useApprovalFeed(onEvent, enabled = true) {
  const handler = useRef(onEvent)
  const [isLive, setIsLive] = useState(live)

  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    if (!enabled) return
    stateListeners.add(setIsLive) // ฟังสถานะก่อน เพราะการต่อครั้งแรกอาจเปลี่ยน live ทันที
    const off = subscribeApprovals((e) => handler.current?.(e))
    return () => {
      off()
      stateListeners.delete(setIsLive)
    }
  }, [enabled])

  return enabled && isLive
}
