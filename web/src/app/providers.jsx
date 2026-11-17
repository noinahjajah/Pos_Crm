/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSession, identityApi, onSessionChange, setSession } from '../lib/api.js'

// ===================== Auth: session ผู้ใช้ =====================
const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setLocal] = useState(getSession)

  useEffect(() => onSessionChange(setLocal), [])

  // โหลดข้อมูลตัวเองใหม่ตอนเปิดเว็บ (role/สาขาอาจถูกเปลี่ยนโดย owner)
  useEffect(() => {
    if (!getSession()) return
    identityApi
      .me()
      .then(({ data }) => {
        const s = getSession()
        if (s) setSession({ ...s, user: data })
      })
      .catch(() => {})
  }, [])

  const login = useCallback(async (username, password) => {
    const { data } = await identityApi.login(username, password)
    setSession(data)
    return data.user
  }, [])

  const logout = useCallback(async () => {
    try {
      await identityApi.logout()
    } catch {
      /* ออกจากระบบฝั่งเว็บต่อแม้เรียก API ไม่สำเร็จ */
    }
    setSession(null)
  }, [])

  const value = useMemo(
    () => ({ user: session?.user ?? null, isAuthenticated: Boolean(session?.access_token), login, logout }),
    [session, login, logout],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องอยู่ใน AuthProvider')
  return ctx
}

// ===================== สาขาที่เลือก (owner) =====================
// owner เห็นได้ทุกสาขา และเลือกดูทีละสาขาได้ (1.4)
// staff / manager ถูกล็อกที่สาขาตัวเองโดย gateway อยู่แล้ว
const BranchContext = createContext(null)
const KEY = 'pos.selectedBranch'

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
    const t = setTimeout(reload, 0) // โหลดหลัง render (ไม่ setState ใน effect ตรง ๆ)
    return () => clearTimeout(t)
  }, [reload])

  const select = useCallback((id) => {
    setSelected(id)
    try {
      localStorage.setItem(KEY, id)
    } catch {
      /* ignore */
    }
  }, [])

  const isOwner = user?.role === 'owner'
  // สาขาที่เลือกถูกปิดไปแล้ว → กลับไปดูทุกสาขา
  const visible = useMemo(() => (user ? branches : []), [user, branches])
  const validSelected = isOwner && visible.some((b) => b.id === selected) ? selected : ''

  const value = useMemo(
    () => ({
      branches: visible,
      reload,
      /** branch_id ที่ส่งไปกับ query ('' = ทุกสาขา) — มีผลเฉพาะ owner */
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

export const BRANCH_TYPE_LABEL = { restaurant: 'ร้านอาหาร', drinks: 'เครื่องดื่ม', bar: 'บาร์' }

export function Providers({ children }) {
  return (
    <AuthProvider>
      <BranchProvider>{children}</BranchProvider>
    </AuthProvider>
  )
}
