import { useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../app/providers.jsx'
import { Alert, Button, Field, HOME_BY_ROLE, TextInput } from '../components/ui.jsx'

const SHOW_TEST_ACCOUNTS = import.meta.env.DEV || import.meta.env.VITE_SHOW_TEST_ACCOUNTS === 'true'

export function LoginPage() {
  const { login, user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={HOME_BY_ROLE[user.role] || '/'} replace />

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const u = await login(username.trim(), password)
      // ระบบอ่าน role จาก token แล้วพาไปหน้าที่ตรงสิทธิ์
      navigate(location.state?.from || HOME_BY_ROLE[u.role] || '/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-hero">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="brand-mark" style={{ background: '#fff', color: '#2e6b5a' }}>
            P
          </div>
          <b style={{ fontSize: 20 }}>POS CRM</b>
        </div>
        <h2>
          จัดการร้านทั้ง 3 สาขา
          <br />
          ได้ในที่เดียว
        </h2>
        <p>เข้าสู่ระบบครั้งเดียว ระบบจะอ่านสิทธิ์จาก Token แล้วพาไปหน้าที่ตรงกับ Role ของคุณ</p>
        <div className="role-row">
          <b>Owner</b>เห็นทุกสาขา จัดการสาขาและผู้ใช้ อนุมัติคำขอ
        </div>
        <div className="role-row">
          <b>Manager</b>ดูแลเฉพาะสาขาตัวเอง อนุมัติคำขอของสาขา
        </div>
        <div className="role-row">
          <b>Staff</b>พนักงานหน้าร้าน (เสิร์ฟ + แคชเชียร์) รับออร์เดอร์และรับเงิน
        </div>
        <footer>เฟส 1 · Identity &amp; Gateway</footer>
      </section>

      <div className="login-form-area">
        <form className="login-card" onSubmit={submit}>
          <div>
            <h1>ยินดีต้อนรับกลับ</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน
            </p>
          </div>
          <Alert>{error}</Alert>
          <Field label="ชื่อผู้ใช้ (username)">
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              required
              autoFocus
            />
          </Field>
          <Field label="รหัสผ่าน">
            <TextInput
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </Field>
          <Button type="submit" block disabled={busy}>
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </Button>

          {SHOW_TEST_ACCOUNTS && (
            <div className="alert alert-info">
              <b>บัญชีทดสอบ (โหมดจำลอง)</b>
              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                {['owner', 'manager1', 'staff1'].map((u) => (
                  <Button
                    key={u}
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setUsername(u)
                      setPassword('password123')
                    }}
                  >
                    {u}
                  </Button>
                ))}
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  )
}
