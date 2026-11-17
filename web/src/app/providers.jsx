// state ที่ใช้ทั้งเว็บ: ผู้ใช้ที่ login, สาขาที่เลือก, ตัวแจ้งเตือน

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { getSession, identityApi, onSessionChange, setSession } from '../api.js'

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

export const BRANCH_TYPE_LABEL = { restaurant: 'ร้านอาหาร', drinks: 'เครื่องดื่ม', bar: 'บาร์' }

const NoticeContext = createContext(null)

// แจ้งเตือนมุมขวาบน (toast) และกล่องยืนยันก่อนลบ · ใช้ผ่าน useNotice()
export function NoticeProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [ask, setAsk] = useState(null)

  const dismiss = useCallback((id) => setToasts((list) => list.filter((t) => t.id !== id)), [])
  const toast = useCallback(
    (message, tone = 'success') => {
      const id = `${Date.now()}-${Math.random()}`
      setToasts((list) => [...list.slice(-3), { id, message, tone }])
      setTimeout(() => dismiss(id), tone === 'error' ? 6000 : 3500)
    },
    [dismiss],
  )
  const confirm = useCallback(
    (opts) => new Promise((resolve) => setAsk({ confirmLabel: 'ยืนยัน', danger: true, ...opts, resolve })),
    [],
  )
  const answer = (ok) => {
    ask?.resolve(ok)
    setAsk(null)
  }

  useEffect(() => {
    if (!ask) return
    const onKey = (e) => e.key === 'Escape' && answer(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])
  return (
    <NoticeContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`}>
            <span>{t.message}</span>
            <button type="button" className="icon-close" onClick={() => dismiss(t.id)} aria-label="ปิด">
              ✕
            </button>
          </div>
        ))}
      </div>
      {ask && (
        <div className="dialog-backdrop" onClick={() => answer(false)}>
          <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dialog-title" onClick={(e) => e.stopPropagation()}>
            <h3 id="dialog-title">{ask.title}</h3>
            {ask.message && <p>{ask.message}</p>}
            <div className="dialog-actions">
              <button type="button" className="btn btn-secondary" onClick={() => answer(false)}>
                ยกเลิก
              </button>
              <button type="button" className={`btn ${ask.danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => answer(true)} autoFocus>
                {ask.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}
    </NoticeContext.Provider>
  )
}

export function useNotice() {
  const ctx = useContext(NoticeContext)
  if (!ctx) throw new Error('useNotice ต้องอยู่ใน NoticeProvider')
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
