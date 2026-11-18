import { useState } from 'react'
import { createUser, updateUser } from '../../../api/identity'
import { ROLE_LABELS } from '../../../lib/constants'
import { errorText } from '../useBranchScope'

// ฟอร์มเพิ่ม/แก้ไขผู้ใช้ (owner เท่านั้น) — 1.5
// staff/manager ต้องมีสาขา · owner ไม่มีสาขา (branch_id = null เห็นทุกสาขา)
// username แก้ไม่ได้หลังสร้าง (ใช้ login) · รหัสผ่านเว้นว่างตอนแก้ = ไม่เปลี่ยน

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/
const MIN_PASSWORD = 6

export default function UserDialog({ user, isSelf, branches, defaultBranchId, onClose, onSaved }) {
  const [form, setForm] = useState({
    username: user?.username ?? '',
    full_name: user?.full_name ?? '',
    role: user?.role ?? 'staff',
    branch_id: user?.branch_id ?? defaultBranchId,
    password: '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const needsBranch = form.role !== 'owner'

  async function submit(e) {
    e.preventDefault()
    const username = form.username.trim().toLowerCase()
    const fullName = form.full_name.trim()
    if (!user && !USERNAME_RE.test(username))
      return setError('ชื่อผู้ใช้ 3–30 ตัว ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง')
    if (!fullName) return setError('กรุณากรอกชื่อ-นามสกุล')
    if (needsBranch && !form.branch_id) return setError('กรุณาเลือกสาขา')
    if (!user && form.password.length < MIN_PASSWORD) return setError(`รหัสผ่านอย่างน้อย ${MIN_PASSWORD} ตัว`)
    if (user && form.password && form.password.length < MIN_PASSWORD)
      return setError(`รหัสผ่านใหม่อย่างน้อย ${MIN_PASSWORD} ตัว`)

    const body = { full_name: fullName, role: form.role, branch_id: needsBranch ? form.branch_id : null }
    if (form.password) body.password = form.password

    setSaving(true)
    try {
      if (user) await updateUser(user.id, body)
      else await createUser({ ...body, username })
      onSaved(user ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มผู้ใช้ ${username} แล้ว`)
    } catch (err) {
      setError(err.status === 409 ? 'ชื่อผู้ใช้นี้มีอยู่แล้ว' : errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog mm-dialog-sm" onSubmit={submit} noValidate>
        <h2 className="mm-dialog-title">{user ? 'แก้ไขผู้ใช้' : 'เพิ่มพนักงาน'}</h2>
        <div className="mm-fields" style={{ marginTop: 16 }}>
          <label className="mm-field">
            <span>ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ) *</span>
            <input
              className="mm-input"
              value={form.username}
              onChange={set('username')}
              disabled={Boolean(user)}
              autoCapitalize="none"
              spellCheck={false}
              autoComplete="off"
              placeholder="เช่น somchai"
              autoFocus={!user}
            />
          </label>
          <label className="mm-field">
            <span>ชื่อ-นามสกุล *</span>
            <input className="mm-input" value={form.full_name} onChange={set('full_name')} maxLength={100} autoFocus={Boolean(user)} />
          </label>
          <div className="mm-two">
            <label className="mm-field">
              <span>ตำแหน่ง *</span>
              <select className="mm-select" value={form.role} onChange={set('role')} disabled={isSelf}>
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="mm-field">
              <span>สาขา {needsBranch && '*'}</span>
              {needsBranch ? (
                <select className="mm-select" value={form.branch_id || ''} onChange={set('branch_id')}>
                  <option value="" disabled>
                    เลือกสาขา
                  </option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="mm-input" value="ทุกสาขา" disabled />
              )}
            </label>
          </div>
          <label className="mm-field">
            <span>{user ? 'ตั้งรหัสผ่านใหม่' : 'รหัสผ่าน *'}</span>
            <input
              className="mm-input"
              type="password"
              value={form.password}
              onChange={set('password')}
              autoComplete="new-password"
              placeholder={user ? 'เว้นว่างถ้าไม่เปลี่ยน' : `อย่างน้อย ${MIN_PASSWORD} ตัว`}
            />
          </label>
          {isSelf && <p className="mm-hint">แก้ตำแหน่งของตัวเองไม่ได้ เพื่อกันไม่ให้ไม่มีเจ้าของร้านเหลือในระบบ</p>}
        </div>
        {error && (
          <div className="mm-alert" style={{ marginTop: 16 }}>
            {error}
          </div>
        )}
        <div className="mm-dialog-actions">
          <button type="button" className="mm-btn" onClick={onClose} disabled={saving}>
            ยกเลิก
          </button>
          <button className="mm-btn mm-btn-primary" disabled={saving}>
            {saving ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </form>
    </div>
  )
}
