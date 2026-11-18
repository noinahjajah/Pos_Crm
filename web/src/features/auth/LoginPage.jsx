import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { HOME_BY_ROLE } from '../../lib/constants'
import { errorText } from '../../lib/format'
import { useAuth } from './AuthContext'
import './auth.css'

// หน้า login ด้วย username + password (1.2)
// สำเร็จ → กลับหน้าที่ตั้งใจจะเข้า ถ้าไม่มีไปหน้าแรกของ role

export default function LoginPage() {
  const { status, role, login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [form, setForm] = useState({ username: '', password: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const from = location.state?.from?.pathname
  if (status === 'authenticated') return <Navigate to={from || HOME_BY_ROLE[role] || '/'} replace />

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const username = form.username.trim()
    if (!username || !form.password) return setError('กรุณากรอกชื่อผู้ใช้และรหัสผ่าน')
    setSubmitting(true)
    setError('')
    try {
      const me = await login(username, form.password)
      navigate(from || HOME_BY_ROLE[me.role] || '/', { replace: true })
    } catch (err) {
      setError(
        err.status === 401
          ? 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'
          : err.status === 429
            ? 'ลองเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 1 นาที'
            : errorText(err),
      )
      setSubmitting(false)
    }
  }

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit} noValidate>
        <div className="auth-brand" aria-hidden="true">
          POS
        </div>
        <h1 className="auth-title">เข้าสู่ระบบ</h1>
        <p className="auth-subtitle">ระบบขายหน้าร้าน · ใช้บัญชีที่ได้รับจากเจ้าของร้าน</p>

        <label className="auth-field">
          <span>ชื่อผู้ใช้</span>
          <input
            className="auth-input"
            value={form.username}
            onChange={set('username')}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            disabled={submitting}
          />
        </label>

        <label className="auth-field">
          <span>รหัสผ่าน</span>
          <div className="auth-password">
            <input
              className="auth-input"
              type={showPassword ? 'text' : 'password'}
              value={form.password}
              onChange={set('password')}
              autoComplete="current-password"
              disabled={submitting}
            />
            <button
              type="button"
              className="auth-toggle"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
            >
              {showPassword ? 'ซ่อน' : 'แสดง'}
            </button>
          </div>
        </label>

        {error && (
          <div className="auth-alert" role="alert">
            {error}
          </div>
        )}

        <button className="auth-submit" disabled={submitting}>
          {submitting ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
        </button>
      </form>
    </main>
  )
}
