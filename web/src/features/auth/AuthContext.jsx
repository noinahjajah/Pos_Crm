// ผู้ใช้ที่ login อยู่ · ใช้ผ่าน useAuth()

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSession, onSessionChange, setSession } from '../../api/client.js'
import { identityApi } from '../../api/identity.js'

const AuthContext = createContext(null)

// ผู้ใช้ที่ login อยู่
export function AuthProvider({ children }) {
  const [session, setLocal] = useState(getSession)

  useEffect(() => onSessionChange(setLocal), [])

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

  const logout = useCallback(() => identityApi.logout(), [])

  const changePassword = useCallback(async (current, next) => {
    const { data } = await identityApi.changePassword(current, next)
    setSession(data)
    return data.user
  }, [])

  const value = useMemo(
    () => ({ user: session?.user ?? null, isAuthenticated: Boolean(session?.access_token), login, logout, changePassword }),
    [session, login, logout, changePassword],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth ต้องอยู่ใน AuthProvider')
  return ctx
}
