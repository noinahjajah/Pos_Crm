// บัญชีของฉัน: ดูข้อมูล + เปลี่ยนรหัสผ่าน

import { useNavigate } from 'react-router-dom'
import { passwordOk } from '../../api/identity.js'
import { PageHeader } from '../../components/layout/Topbar.jsx'
import { useNotice } from '../../components/ui/Notice.jsx'
import { Alert, Badge, Button, Card, Field } from '../../components/ui/index.jsx'
import { useAuth } from './AuthContext.jsx'
import { PasswordInput, PasswordRules } from './LoginPage.jsx'
import { useForm } from '../../hooks/useForm.js'
import { HOME_BY_ROLE, ROLE_LABEL, ROLE_TONE } from '../../lib/constants.js'
import { dateTime } from '../../lib/format.js'

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
              <PasswordRules value={form.next} />
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
