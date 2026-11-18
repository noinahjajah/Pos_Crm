// หน้าสมัครสมาชิกของพนักงานใหม่: ได้ role staff และรอเจ้าของร้านอนุมัติก่อนเข้าใช้

import { useEffect, useState } from 'react'
import { Link, Navigate } from 'react-router-dom'
import { identityApi, passwordOk } from '../../api/identity.js'
import { Alert, BranchOptions, Button, Field, Select, TextInput } from '../../components/ui/index.jsx'
import { useForm } from '../../hooks/useForm.js'
import { useAuth } from './AuthContext.jsx'
import { AuthHero, PasswordInput, PasswordRules } from './LoginPage.jsx'

export function RegisterPage() {
  const { user } = useAuth()
  const [branches, setBranches] = useState([])
  const [done, setDone] = useState(null)
  const { form, set, errors, setErrors, error, setError, busy, submit } = useForm({
    username: '',
    full_name: '',
    branch_id: '',
    password: '',
    confirm: '',
  })
  const mismatch = form.confirm && form.password !== form.confirm

  useEffect(() => {
    identityApi
      .publicBranches()
      .then((res) => setBranches(res.data))
      .catch((e) => setError(e.message))
  }, [setError])

  if (user) return <Navigate to="/" replace />

  async function onSubmit(e) {
    e.preventDefault()
    setErrors({})
    if (!passwordOk(form.password)) return setErrors({ password: 'รหัสผ่านยังไม่ตรงตามเงื่อนไข' })
    if (mismatch) return setErrors({ confirm: 'ยืนยันรหัสผ่านไม่ตรงกัน' })
    await submit(async () => {
      const { username, full_name, branch_id, password } = form
      const res = await identityApi.register({ username: username.trim().toLowerCase(), full_name, branch_id, password })
      setDone(res.data.user)
    })
  }

  const branchName = branches.find((b) => b.id === done?.branch_id)?.name

  return (
    <div className="login">
      <AuthHero />
      <div className="login-form-area">
        {done ? (
          <div className="login-card">
            <h1>สมัครเรียบร้อย</h1>
            <Alert tone="info">
              บัญชี <b>{done.username}</b> ({branchName}) รอเจ้าของร้านอนุมัติ เมื่ออนุมัติแล้วเข้าสู่ระบบได้ทันที
            </Alert>
            <Link className="btn btn-primary btn-block" to="/login">
              กลับไปหน้าเข้าสู่ระบบ
            </Link>
          </div>
        ) : (
          <form className="login-card" onSubmit={onSubmit} noValidate>
            <div>
              <h1>สมัครสมาชิก</h1>
              <p className="muted" style={{ margin: '4px 0 0' }}>
                สำหรับพนักงานใหม่ · เจ้าของร้านต้องอนุมัติก่อนเข้าใช้งาน
              </p>
            </div>
            <Alert>{error}</Alert>
            <Field label="ชื่อผู้ใช้ (username)" hint="a-z 0-9 . _ - ยาว 3–32 ตัว" error={errors.username}>
              <TextInput value={form.username} onChange={set('username')} autoComplete="username" autoCapitalize="none" spellCheck={false} invalid={Boolean(errors.username)} autoFocus />
            </Field>
            <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
              <TextInput value={form.full_name} onChange={set('full_name')} autoComplete="name" invalid={Boolean(errors.full_name)} />
            </Field>
            <Field label="สาขาที่ทำงาน" error={errors.branch_id}>
              <Select value={form.branch_id} onChange={set('branch_id')}>
                <option value="">เลือกสาขา</option>
                <BranchOptions branches={branches} />
              </Select>
            </Field>
            <Field label="รหัสผ่าน" error={errors.password}>
              <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" invalid={Boolean(errors.password)} />
            </Field>
            <PasswordRules value={form.password} />
            <Field label="ยืนยันรหัสผ่าน" error={errors.confirm || (mismatch ? 'ยืนยันรหัสผ่านไม่ตรงกัน' : '')}>
              <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" invalid={Boolean(mismatch)} />
            </Field>
            <Button
              type="submit"
              block
              disabled={busy || !form.username.trim() || !form.full_name.trim() || !form.branch_id || !passwordOk(form.password) || form.password !== form.confirm}
            >
              {busy ? 'กำลังสมัคร…' : 'สมัครสมาชิก'}
            </Button>
            <p style={{ margin: 0, fontSize: 13, textAlign: 'center' }}>
              มีบัญชีแล้ว? <Link to="/login">เข้าสู่ระบบ</Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
