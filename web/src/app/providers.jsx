// ตั้งค่าแอปทั้งระบบ: แจ้งเตือน, ผู้ใช้ที่ login, สาขาที่เลือก

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { identityApi } from '../api/identity.js'
import { NoticeProvider } from '../components/ui/Notice.jsx'
import { AuthProvider, useAuth } from '../features/auth/AuthContext.jsx'

const BranchContext = createContext(null)
const KEY = 'pos.selectedBranch'

// สาขาที่กำลังดู (owner เลือกได้ · staff/manager เป็นสาขาตัวเองเสมอ)
export function BranchProvider({ children }) {
  const { user } = useAuth()
  const [branches, setBranches] = useState([])
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem(KEY) || ''
    } catch {
      return ''
    }
  })

  const reload = useCallback(async () => {
    if (!user) return
    try {
      const { data } = await identityApi.listBranches()
      setBranches(data)
    } catch {
      setBranches([])
    }
  }, [user])

  useEffect(() => {
    const t = setTimeout(reload, 0)
    return () => clearTimeout(t)
  }, [reload])

  const select = useCallback((id) => {
    setSelected(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
    }
  }, [])

  const isOwner = user?.role === 'owner'
  const visible = useMemo(() => (user ? branches : []), [user, branches])
  const validSelected = isOwner && visible.some((b) => b.id === selected) ? selected : ''

  const value = useMemo(
    () => ({
      branches: visible,
      reload,
      selectedBranchId: isOwner ? validSelected : user?.branch_id || '',
      selectBranch: select,
      canSwitch: isOwner,
    }),
    [visible, reload, isOwner, validSelected, user, select],
  )
  return <BranchContext.Provider value={value}>{children}</BranchContext.Provider>
}

export function useBranch() {
  const ctx = useContext(BranchContext)
  if (!ctx) throw new Error('useBranch ต้องอยู่ใน BranchProvider')
  return ctx
}

export function Providers({ children }) {
  return (
    <NoticeProvider>
      <AuthProvider>
        <BranchProvider>{children}</BranchProvider>
      </AuthProvider>
    </NoticeProvider>
  )
}
