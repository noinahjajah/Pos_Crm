// หน้า login และหน้าบัญชีของฉัน (เปลี่ยนรหัสผ่าน)

import { useEffect, useState } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth, useNotice } from '../providers.jsx'
import { clearLogoutReason, PASSWORD_RULES, passwordOk, peekLogoutReason } from '../api.js'
import { Alert, Badge, Button, Card, Field, HOME_BY_ROLE, PageHeader, ROLE_LABEL, ROLE_TONE, TextInput, useForm } from '../ui.jsx'

// บัญชีทดสอบ แสดงเฉพาะตอนพัฒนา
const TEST_ACCOUNTS = [
  { username: 'owner', role: 'owner', dest: 'แดชบอร์ดรวมทุกสาขา' },
  { username: 'manager1', role: 'manager', dest: 'แดชบอร์ดสาขาร้านอาหาร' },
  { username: 'staff1', role: 'staff', dest: 'หน้าโต๊ะ / รับออร์เดอร์' },
]
const SHOW_TEST_ACCOUNTS = import.meta.env.DEV || import.meta.env.VITE_SHOW_TEST_ACCOUNTS === 'true'

const LOGOUT_MESSAGE = {
  expired: 'session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
  disabled: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อเจ้าของร้าน',
}

function loginErrorText(err) {
  if (err.code === 'INVALID_CREDENTIALS') {
    const left = err.details?.[0]?.attempts_left
    return left != null && left <= 3
      ? `${err.message} (ใส่ผิดได้อีก ${left} ครั้ง ก่อนบัญชีถูกล็อกชั่วคราว)`
      : err.message
  }
  if (err.code === 'VALIDATION_ERROR') return 'กรุณากรอกชื่อผู้ใช้และรหัสผ่านให้ถูกรูปแบบ'
  return err.message
}

function PasswordInput({ value, onChange, autoComplete, invalid, autoFocus }) {
  const [show, setShow] = useState(false)
  const [caps, setCaps] = useState(false)
  const detectCaps = (e) => setCaps(Boolean(e.getModifierState?.('CapsLock')))
  return (
    <>
      <div className="pw-wrap">
        <TextInput
          type={show ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          onKeyUp={detectCaps}
          onKeyDown={detectCaps}
          onBlur={() => setCaps(false)}
          autoComplete={autoComplete}
          invalid={invalid}
          autoFocus={autoFocus}
          required
        />
        <button type="button" className="pw-toggle" onClick={() => setShow((v) => !v)} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
          {show ? 'ซ่อน' : 'แสดง'}
        </button>
      </div>
      {caps && <em className="hint warn">Caps Lock เปิดอยู่</em>}
    </>
  )
}

// หน้า login
export function LoginPage() {
  const { login, user } = useAuth()
  const { toast } = useNotice()
  const navigate = useNavigate()
  const location = useLocation()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice] = useState(() => LOGOUT_MESSAGE[peekLogoutReason()] || '')
  const [busy, setBusy] = useState(false)
  useEffect(() => clearLogoutReason(), [])

  if (user) return <Navigate to={user.must_change_password ? '/account' : HOME_BY_ROLE[user.role] || '/'} replace />

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const u = await login(username.trim().toLowerCase(), password)
      toast(`ยินดีต้อนรับ ${u.full_name}`)
      const target = u.must_change_password ? '/account' : location.state?.from || HOME_BY_ROLE[u.role] || '/'
      navigate(target, { replace: true })
    } catch (err) {
      setError(loginErrorText(err))
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login">
      <section className="login-hero">
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div className="brand-mark" style={{ background: '#fff', color: '#2e6b5a' }}>
            ค
          </div>
          <div>
            <b style={{ fontSize: 20 }}>ครัวโอทอป</b>
            <div style={{ fontSize: 12, opacity: 0.75 }}>ระบบหลังบ้าน</div>
          </div>
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
        <form className="login-card" onSubmit={submit} noValidate>
          <div>
            <h1>ยินดีต้อนรับกลับ</h1>
            <p className="muted" style={{ margin: '4px 0 0' }}>
              เข้าสู่ระบบด้วยชื่อผู้ใช้และรหัสผ่าน
            </p>
          </div>
          {notice && !error && <Alert tone="info">{notice}</Alert>}
          <Alert>{error}</Alert>
          <Field label="ชื่อผู้ใช้ (username)">
            <TextInput
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
              autoFocus
            />
          </Field>
          <Field label="รหัสผ่าน">
            <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </Field>
          <Button type="submit" block disabled={busy || !username.trim() || !password}>
            {busy ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบ'}
          </Button>
          <p className="muted" style={{ margin: 0, fontSize: 12, textAlign: 'center' }}>
            ลืมรหัสผ่าน? ติดต่อเจ้าของร้าน (Owner) เพื่อรีเซ็ตรหัสผ่าน
          </p>

          {SHOW_TEST_ACCOUNTS && (
            <div className="test-accounts">
              <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>บัญชีทดสอบ (โหมดจำลอง) · รหัสผ่าน password123</div>
              {TEST_ACCOUNTS.map((a) => (
                <button
                  type="button"
                  key={a.username}
                  className="test-row"
                  onClick={() => {
                    setUsername(a.username)
                    setPassword('password123')
                  }}
                >
                  <Badge tone={ROLE_TONE[a.role]}>{ROLE_LABEL[a.role]}</Badge>
                  <b>{a.username}</b>
                  <span className="muted">→ {a.dest}</span>
                </button>
              ))}
            </div>
          )}
        </form>
      </div>
    </div>
  )
}

const dateTime = (iso) => (iso ? new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' }) : '—')

// บัญชีของฉัน: ดูข้อมูล + เปลี่ยนรหัสผ่าน
export function AccountPage() {
  const { user, changePassword } = useAuth()
  const navigate = useNavigate()
  const forced = user.must_change_password
  const { toast } = useNotice()
  const { form, set, errors, setErrors, error, setError, busy, submit: send, reset } = useForm({ current: '', next: '', confirm: '' })
  const mismatch = form.confirm && form.next !== form.confirm

  async function submit(e) {
    e.preventDefault()
    setError('')
    setErrors({})
    if (!passwordOk(form.next)) return setErrors({ new_password: 'รหัสผ่านใหม่ยังไม่ตรงตามเงื่อนไข' })
    if (mismatch) return setErrors({ confirm: 'ยืนยันรหัสผ่านไม่ตรงกัน' })
    await send(
      async () => {
        const u = await changePassword(form.current, form.next)
        reset()
        toast('เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะต้องเข้าใหม่')
        if (forced) navigate(HOME_BY_ROLE[u.role] || '/', { replace: true })
      },
      (err) => {
        const left = err.details?.[0]?.attempts_left
        return left != null ? `${err.message} (ใส่ผิดได้อีก ${left} ครั้ง)` : err.message
      },
    )
  }

  return (
    <>
      <PageHeader title="บัญชีของฉัน" subtitle="ข้อมูลผู้ใช้และการเปลี่ยนรหัสผ่าน" />
      <div className="content account">
        {forced && (
          <Alert tone="warning">
            <b>ต้องตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</b> — รหัสที่ได้รับจากเจ้าของร้านเป็นรหัสชั่วคราว
          </Alert>
        )}
        <div className="account-grid">
          <Card title="ข้อมูลผู้ใช้">
            <dl className="info">
              <dt>ชื่อ-นามสกุล</dt>
              <dd>{user.full_name}</dd>
              <dt>ชื่อผู้ใช้</dt>
              <dd>{user.username}</dd>
              <dt>Role</dt>
              <dd>
                <Badge tone={ROLE_TONE[user.role]}>{ROLE_LABEL[user.role]}</Badge>
              </dd>
              <dt>สาขา</dt>
              <dd>{user.branch ? `${user.branch.name} (${user.branch.code})` : 'ทุกสาขา'}</dd>
              <dt>เข้าใช้ล่าสุด</dt>
              <dd>{dateTime(user.last_login_at)}</dd>
            </dl>
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              ต้องการแก้ชื่อ role หรือสาขา ติดต่อเจ้าของร้าน (Owner)
            </p>
          </Card>

          <Card title="เปลี่ยนรหัสผ่าน">
            <form onSubmit={submit} className="stack" noValidate>
              <Alert>{error}</Alert>
              <Field label="รหัสผ่านปัจจุบัน" error={errors.current_password}>
                <PasswordInput value={form.current} onChange={set('current')} autoComplete="current-password" invalid={!!errors.current_password} autoFocus={forced} />
              </Field>
              <Field label="รหัสผ่านใหม่" error={errors.new_password}>
                <PasswordInput value={form.next} onChange={set('next')} autoComplete="new-password" invalid={!!errors.new_password} />
              </Field>
              <ul className="rules">
                {PASSWORD_RULES.map((r) => (
                  <li key={r.label} className={r.test(form.next) ? 'ok' : ''}>
                    {r.test(form.next) ? '✓' : '○'} {r.label}
                  </li>
                ))}
              </ul>
              <Field label="ยืนยันรหัสผ่านใหม่" error={errors.confirm || (mismatch ? 'ยืนยันรหัสผ่านไม่ตรงกัน' : '')}>
                <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" invalid={Boolean(mismatch)} />
              </Field>
              <Button type="submit" disabled={busy || !form.current || !passwordOk(form.next) || form.next !== form.confirm}>
                {busy ? 'กำลังบันทึก…' : 'บันทึกรหัสผ่านใหม่'}
              </Button>
            </form>
          </Card>
        </div>
      </div>
    </>
  )
}
