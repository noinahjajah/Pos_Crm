import { useCallback, useEffect, useState } from 'react'
import { api } from '../../api/client'
import { formatBaht } from '../../lib/format'

// ของที่หน้าหลังร้านของ Dev 2 ใช้ร่วมกัน (สต็อก รายจ่าย รายงาน หมวดหมู่)

/** แปลง error จาก API เป็นข้อความอ่านง่าย (รวมรายละเอียดรายช่องถ้ามี) */
export function errorText(err) {
  if (!err) return ''
  const fields = (err.details || [])
    .map((d) => d.message && (d.field ? `${d.field}: ${d.message}` : d.message))
    .filter(Boolean)
  return fields.length ? `${err.message} — ${fields.join(', ')}` : err.message || 'เกิดข้อผิดพลาด'
}


/** 1234 → '1,234' · มีสตางค์ปัดขึ้น → '1,235' */
export const baht = formatBaht

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
export function todayTh() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)
}

/** '2026-11-17' → '17 พ.ย. 2569' */
export function thaiDate(value) {
  if (!value) return ''
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString('th-TH', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** ข้อความแจ้งเตือนมุมล่างที่หายไปเองใน 3 วินาที */
export function useToast() {
  const [toast, setToast] = useState(null)
  const notify = useCallback((message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }, [])
  return [toast, notify]
}

/**
 * ผู้ใช้ปัจจุบัน + สาขาที่กำลังดู
 * - manager/staff: สาขาของตัวเองเสมอ
 * - owner: เลือกสาขาได้ (allowAll = true → มีตัวเลือก "ทุกสาขา" ค่า '')
 */
export function useBranchScope({ allowAll = false } = {}) {
  const [state, setState] = useState({ me: null, branches: [], branchId: '', ready: false, error: '' })

  useEffect(() => {
    let cancelled = false
    Promise.all([api.get('/identity/me'), api.get('/identity/branches')])
      .then(([meRes, branchRes]) => {
        if (cancelled) return
        const me = meRes.data
        const branches = branchRes.data || []
        const branchId = me.role === 'owner' ? (allowAll ? '' : branches[0]?.id || '') : me.branch_id
        setState({ me, branches, branchId, ready: true, error: '' })
      })
      .catch((err) => !cancelled && setState((s) => ({ ...s, ready: true, error: errorText(err) })))
    return () => {
      cancelled = true
    }
  }, [allowAll])

  const setBranchId = useCallback((branchId) => setState((s) => ({ ...s, branchId })), [])
  const branchName = useCallback(
    (id) => (id ? state.branches.find((b) => b.id === id)?.name || '' : 'ทุกสาขา'),
    [state.branches],
  )

  const role = state.me?.role
  return {
    ...state,
    setBranchId,
    branchName,
    isOwner: role === 'owner',
    isManager: role === 'manager',
    canManage: role === 'owner' || role === 'manager',
  }
}
