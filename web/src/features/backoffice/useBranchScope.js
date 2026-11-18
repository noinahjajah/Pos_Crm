// ผู้ใช้ + สาขาที่กำลังดู + แจ้งเตือน สำหรับหน้าหลังร้าน (ใช้ข้อมูลที่ login ไว้แล้ว ไม่โหลดซ้ำ)

import { useCallback, useState } from 'react'
import { useBranch } from '../../app/providers.jsx'
import { useNotice } from '../../components/ui/Notice.jsx'
import { useAuth } from '../auth/AuthContext.jsx'

/** แจ้งเตือนมุมจอ: notify(ข้อความ, 'success' | 'error') */
export function useNotify() {
  const { toast } = useNotice()
  return useCallback((message, type = 'success') => toast(message, type), [toast])
}

/**
 * ผู้ใช้ปัจจุบัน + สาขาที่กำลังดู
 * - manager/staff: สาขาของตัวเองเสมอ
 * - owner: เลือกสาขาได้ (allowAll = true → มีตัวเลือก "ทุกสาขา" ค่า '')
 */
export function useBranchScope({ allowAll = false } = {}) {
  const { user: me } = useAuth()
  const { branches, selectedBranchId } = useBranch()
  const isOwner = me.role === 'owner'
  const [picked, setPicked] = useState(null)
  const fallback = isOwner ? (allowAll ? '' : selectedBranchId || branches[0]?.id || '') : me.branch_id
  const branchId = picked ?? fallback

  const setBranchId = useCallback((id) => setPicked(id), [])
  const branchName = useCallback((id) => (id ? branches.find((b) => b.id === id)?.name || '' : 'ทุกสาขา'), [branches])

  return {
    me,
    branches,
    branchId,
    setBranchId,
    branchName,
    ready: !isOwner || branches.length > 0,
    error: '',
    isOwner,
    isManager: me.role === 'manager',
    canManage: isOwner || me.role === 'manager',
  }
}
