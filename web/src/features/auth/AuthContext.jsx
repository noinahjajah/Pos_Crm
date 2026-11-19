import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { hasToken, onSessionExpired } from '../../api/client'
import * as identity from '../../api/identity'

// เก็บผู้ใช้ที่ login อยู่ (จาก GET /me) ให้ทุกหน้าใช้ — 1.2
// status: 'loading' (กำลังเช็ก token เดิม) | 'authenticated' | 'guest'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState(hasToken() ? 'loading' : 'guest')

  // เปิดเว็บมาแล้วมี token เดิม → ดึงข้อมูลตัวเอง
  useEffect(() => {
    if (!hasToken()) return
    let cancelled = false
    identity
      .getMe()
      .then((me) => {
        if (cancelled) return
        setUser(me)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setUser(null)
        setStatus('guest')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // refresh token ไม่ผ่าน → กลับไปหน้า login
  useEffect(
    () =>
      onSessionExpired(() => {
        setUser(null)
        setStatus('guest')
      }),
    [],
  )

  const login = useCallback(async (username, password) => {
    await identity.login(username, password)
    const me = await identity.getMe()
    setUser(me)
    setStatus('authenticated')
    return me
  }, [])

  const logout = useCallback(async () => {
    try {
      await identity.logout()
    } catch {
      /* ออกจากเครื่องนี้ต่อแม้ server ตอบไม่ได้ */
    }
    setUser(null)
    setStatus('guest')
  }, [])

  const value = useMemo(() => {
    const role = user?.role
    return {
      user,
      status,
      role,
      branchId: user?.branch_id ?? null,
      isOwner: role === 'owner',
      isManager: role === 'manager',
      isStaff: role === 'staff',
      login,
      logout,
    }
  }, [user, status, login, logout])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องใช้ภายใน <AuthProvider>')
  return ctx
}
