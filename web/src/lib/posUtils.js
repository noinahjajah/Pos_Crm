import { useCallback, useEffect, useRef, useState } from 'react'
import { listBranches } from '../api/identity'
import { useAuth } from '../features/auth/AuthContext'
import { formatBaht } from './format'

// ตัวช่วยของหน้าร้าน Dev 3 (ผังโต๊ะ รับออร์เดอร์)

/** สถานะโต๊ะ (1.8) → ข้อความ + class สี */
export const TABLE_STATUS = {
  available: { label: 'ว่าง', cls: 'is-available' },
  occupied: { label: 'มีลูกค้า', cls: 'is-occupied' },
  waiting_payment: { label: 'รอชำระ', cls: 'is-waiting' },
}

/** 1120 → '1,120 ฿' · มีสตางค์ปัดขึ้น 12.5 → '13 ฿' */
export const thb = (n) => `${formatBaht(n)} ฿`

/** '2026-11-16T18:42:00Z' → '18:42' */
export function hhmm(value) {
  if (!value) return ''
  return new Date(value).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
}

/** → 'จันทร์ 16 พ.ย. 2569 · 19:05' */
export function todayLabel(now = new Date()) {
  const day = now.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })
  return `${day} · ${hhmm(now)}`
}

/** เวลาปัจจุบันที่อัปเดตทุก 30 วินาที (หัวหน้าผังโต๊ะ / เวลาเปิดโต๊ะ) */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** ข้อความแจ้งเตือนมุมล่างที่หายไปเองใน 3 วินาที */
export function useToast() {
  const [toast, setToast] = useState(null)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const notify = useCallback((message, type = 'success') => {
    clearTimeout(timer.current)
    setToast({ message, type })
    timer.current = setTimeout(() => setToast(null), 3000)
  }, [])
  return [toast, notify]
}

/** ชื่อโต๊ะทั้งหมดของบิล → 'T5 + T6' (รองรับบิลจาก payment ที่ส่ง table_no ตัวเดียวด้วย) */
export const tablesText = (order, sep = ' + ') =>
  (order?.tables || []).map((t) => (typeof t === 'string' ? t : t.table_no)).join(sep) || order?.table_no || '-'

/** ชื่อสาขาของผู้ใช้ (/me ไม่ส่งชื่อมา → หาจากรายชื่อสาขา) ใช้หัวใบพิมพ์/QR */
export function useBranchName() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.branch?.name || user?.branch_name || '')
  useEffect(() => {
    if (name || !user?.branch_id) return
    let cancelled = false
    listBranches()
      .then((rows) => {
        const found = (rows || []).find((b) => b.id === user.branch_id)
        if (!cancelled && found) setName(found.name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [name, user?.branch_id])
  return name
}
