// แจ้งเตือนมุมขวาบน (toast) และกล่องยืนยันก่อนลบ · ใช้ผ่าน useNotice()

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

const NoticeContext = createContext(null)

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
