import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router'
import { createUser, deleteUser, listBranches, listUsers, updateUser } from '../../../api/identity'
import { ROLE_LABELS } from '../../../lib/constants'
import { useAuth } from '../../auth/AuthContext'
import { useToast } from '../../../lib/posUtils'
import { Toast } from '../../../components/ui/posUi'
import { errorText } from '../useBranchScope'
import '../../../styles/pos.css'

// หน้าจัดการผู้ใช้ — 1.3–1.5 (Dev 1)
// owner: เพิ่ม/แก้/ลบผู้ใช้ทุกสาขา (แผงขวา) · manager: ดูรายชื่อพนักงานสาขาตัวเองอย่างเดียว (gateway กรองสาขาให้)
// ลบ = ปิดบัญชี (soft delete) เปิดใช้อีกครั้งได้ · username แก้ไม่ได้หลังสร้าง · แก้ role ตัวเองไม่ได้

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/
const MIN_PASSWORD = 6
const ROLE_PILL = { owner: 'is-available', manager: 'is-available', staff: 'is-muted' }
const ROLE_HINT = {
  staff: 'เปิดโต๊ะ รับออร์เดอร์ คิดเงิน ขอส่วนลด/คืนเงิน',
  manager: 'ทุกอย่างของพนักงาน + อนุมัติ เมนู สต็อก รายจ่ายของสาขาตัวเอง',
  owner: 'เห็นทุกสาขา จัดการผู้ใช้และสาขา',
}

export default function UsersPage() {
  const [params] = useSearchParams()
  const { user: me, isOwner } = useAuth()
  const [branches, setBranches] = useState([])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [branchId, setBranchId] = useState('')
  const [editing, setEditing] = useState(isOwner ? 'new' : null) // user id | 'new' | null
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  useEffect(() => {
    let cancelled = false
    Promise.all([listBranches(isOwner ? { include_inactive: true } : undefined), listUsers({ include_inactive: isOwner || undefined })])
      .then(([b, u]) => {
        if (cancelled) return
        setBranches(b || [])
        setRows(u || [])
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [isOwner, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const branchName = (id) => (id ? branches.find((b) => b.id === id)?.name || '—' : 'ทุกสาขา')
  const activeBranches = branches.filter((b) => b.is_active !== false)

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase()
    return rows
      .filter((u) => !role || u.role === role)
      .filter((u) => !branchId || u.branch_id === branchId)
      .filter((u) => !term || `${u.full_name || ''} ${u.username || ''}`.toLowerCase().includes(term))
      .sort((a, b) => (a.is_active === b.is_active ? 0 : a.is_active === false ? 1 : -1))
  }, [rows, q, role, branchId])

  // หน้าเดิมเคยมีแท็บสาขา (?tab=branches) → ย้ายไปหน้าสาขา
  if (params.get('tab') === 'branches') return <Navigate to="/admin/branches" replace />

  async function remove(u) {
    if (!window.confirm(`ลบผู้ใช้ "${u.full_name || u.username}" ?\nบัญชีจะเข้าสู่ระบบไม่ได้และถูกออกจากระบบทันที (เปิดใช้อีกครั้งได้)`)) return
    setBusyId(u.id)
    try {
      await deleteUser(u.id)
      notify('ลบผู้ใช้แล้ว')
      if (editing === u.id) setEditing('new')
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function restore(u) {
    setBusyId(u.id)
    try {
      await updateUser(u.id, { is_active: true })
      notify(`เปิดใช้บัญชี ${u.username} อีกครั้งแล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  const current = editing && editing !== 'new' ? rows.find((u) => u.id === editing) || null : null

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">{isOwner ? 'จัดการผู้ใช้' : 'พนักงานในสาขา'}</h1>
          <p className="pos-subtitle">{isOwner ? 'เพิ่ม ลบ แก้ไขผู้ใช้ และกำหนด role' : 'รายชื่อพนักงานสาขาของคุณ ดูได้อย่างเดียว'}</p>
        </div>
        {isOwner && (
          <select className="pos-input pos-select-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="กรองตามสาขา">
            <option value="">ทุกสาขา</option>
            {activeBranches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {error && (
        <div className="pos-alert">
          {error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className={isOwner ? 'pos-bo-layout' : ''}>
        <section style={{ minWidth: 0 }} aria-label="รายชื่อผู้ใช้">
          <div className="pos-menu-toolbar">
            <div className="pos-chips" style={{ alignItems: 'center' }}>
              <input className="pos-search" type="search" placeholder="ค้นหาชื่อหรือชื่อผู้ใช้" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาผู้ใช้" />
              <button type="button" className={`pos-chip ${!role ? 'is-active' : ''}`} onClick={() => setRole('')}>
                ทั้งหมด
              </button>
              {Object.entries(ROLE_LABELS).map(([value, label]) => (
                <button key={value} type="button" className={`pos-chip ${role === value ? 'is-active' : ''}`} onClick={() => setRole(value)}>
                  {label}
                </button>
              ))}
            </div>
            {isOwner && (
              <button type="button" className="pos-btn pos-btn-primary" onClick={() => setEditing('new')} disabled={activeBranches.length === 0}>
                + เพิ่มผู้ใช้
              </button>
            )}
          </div>

          {loading ? (
            <div className="pos-skeleton" />
          ) : visible.length === 0 ? (
            <div className="pos-empty">{rows.length === 0 ? 'ยังไม่มีผู้ใช้' : 'ไม่พบผู้ใช้ที่ตรงกับตัวกรอง'}</div>
          ) : (
            <div className="pos-rtable-wrap" style={{ background: 'var(--app-card)' }}>
              <table className="pos-rtable">
                <thead>
                  <tr>
                    <th>ผู้ใช้</th>
                    <th>Role</th>
                    <th>สาขา</th>
                    <th>สถานะ</th>
                    {isOwner && <th aria-label="จัดการ" />}
                  </tr>
                </thead>
                <tbody>
                  {visible.map((u) => {
                    const isMe = u.id === me?.id
                    const inactive = u.is_active === false
                    return (
                      <tr key={u.id} className={`${editing === u.id ? 'is-selected' : ''} ${inactive ? 'is-dim' : ''}`}>
                        <td>
                          <strong>{u.full_name || '—'}</strong>
                          {isMe && <span className="pos-pill is-muted" style={{ marginLeft: 6 }}>คุณ</span>}
                          <span className="pos-line-sub">{u.username}</span>
                        </td>
                        <td>
                          <span className={`pos-pill ${ROLE_PILL[u.role] || 'is-muted'}`}>{ROLE_LABELS[u.role] || u.role}</span>
                        </td>
                        <td>{branchName(u.branch_id)}</td>
                        <td>
                          <span className={`pos-pill ${inactive ? 'is-muted' : 'is-available'}`}>{inactive ? 'ปิดใช้งาน' : 'ใช้งาน'}</span>
                        </td>
                        {isOwner && (
                          <td className="pos-row-actions">
                            {inactive ? (
                              <button type="button" className="pos-link-btn" onClick={() => restore(u)} disabled={busyId === u.id}>
                                เปิดใช้อีกครั้ง
                              </button>
                            ) : (
                              <>
                                <button type="button" className="pos-link-btn" onClick={() => setEditing(u.id)}>
                                  แก้ไข
                                </button>
                                {!isMe && (
                                  <button type="button" className="pos-link-btn is-danger" onClick={() => remove(u)} disabled={busyId === u.id}>
                                    ลบ
                                  </button>
                                )}
                              </>
                            )}
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {isOwner && (
          <aside className="pos-panel pos-side-panel" aria-label={current ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'}>
            {editing ? (
              <UserEditor
                key={`${editing}:${reloadKey}`}
                user={current}
                isSelf={current?.id === me?.id}
                branches={activeBranches}
                defaultBranchId={branchId || activeBranches[0]?.id || ''}
                onCancel={() => setEditing(current ? 'new' : null)}
                onSaved={(msg) => {
                  notify(msg)
                  setEditing('new')
                  reload()
                }}
              />
            ) : (
              <div className="pos-cart-empty">กด “+ เพิ่มผู้ใช้” หรือ “แก้ไข” ในตาราง</div>
            )}
          </aside>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  )
}

/** ฟอร์มเพิ่ม/แก้ไขผู้ใช้ในแผงขวา (owner) */
function UserEditor({ user, isSelf, branches, defaultBranchId, onCancel, onSaved }) {
  const [form, setForm] = useState({
    full_name: user?.full_name ?? '',
    username: user?.username ?? '',
    password: '',
    role: user?.role ?? 'staff',
    branch_id: user?.branch_id ?? defaultBranchId,
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const needsBranch = form.role !== 'owner'

  async function submit(e) {
    e.preventDefault()
    const username = form.username.trim().toLowerCase()
    const fullName = form.full_name.trim()
    if (!fullName) return setError('กรุณากรอกชื่อ-นามสกุล')
    if (!user && !USERNAME_RE.test(username)) return setError('ชื่อผู้ใช้ 3–30 ตัว ใช้ได้เฉพาะ a-z 0-9 จุด ขีด และขีดล่าง')
    if (!user && form.password.length < MIN_PASSWORD) return setError(`รหัสผ่านอย่างน้อย ${MIN_PASSWORD} ตัว`)
    if (user && form.password && form.password.length < MIN_PASSWORD) return setError(`รหัสผ่านใหม่อย่างน้อย ${MIN_PASSWORD} ตัว`)
    if (needsBranch && !form.branch_id) return setError('กรุณาเลือกสาขา')

    const body = { full_name: fullName, role: form.role, branch_id: needsBranch ? form.branch_id : null }
    if (form.password) body.password = form.password
    setSaving(true)
    setError('')
    try {
      if (user) await updateUser(user.id, body)
      else await createUser({ ...body, username })
      onSaved(user ? `บันทึก ${fullName} แล้ว` : `เพิ่มผู้ใช้ ${username} แล้ว`)
    } catch (err) {
      setError(err.status === 409 ? 'ชื่อผู้ใช้นี้มีอยู่แล้ว' : errorText(err))
      setSaving(false)
    }
  }

  return (
    <form className="pos-editor" onSubmit={submit} noValidate>
      <h2 className="pos-panel-title">{user ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'}</h2>
      <label className="pos-field">
        <span>ชื่อ-นามสกุล</span>
        <input className="pos-input" value={form.full_name} onChange={set('full_name')} maxLength={100} />
      </label>
      <label className="pos-field">
        <span>ชื่อผู้ใช้ (ใช้เข้าสู่ระบบ{user ? ' · แก้ไม่ได้' : ''})</span>
        <input className="pos-input" value={form.username} onChange={set('username')} disabled={Boolean(user)} autoCapitalize="none" spellCheck={false} autoComplete="off" placeholder="เช่น piya.waiter" />
      </label>
      <label className="pos-field">
        <span>{user ? 'ตั้งรหัสผ่านใหม่' : 'รหัสผ่านชั่วคราว'}</span>
        <input
          className="pos-input"
          type="password"
          value={form.password}
          onChange={set('password')}
          autoComplete="new-password"
          placeholder={user ? 'เว้นว่างถ้าไม่เปลี่ยน' : `อย่างน้อย ${MIN_PASSWORD} ตัว`}
        />
      </label>

      <fieldset className="pos-field" style={{ border: 0, padding: 0, margin: '0 0 12px' }} disabled={isSelf}>
        <legend className="pos-field-legend">Role</legend>
        <div className="pos-opt-list">
          {Object.entries(ROLE_LABELS).map(([value, label]) => (
            <label key={value} className={`pos-opt ${form.role === value ? 'is-checked' : ''} ${isSelf ? 'is-disabled' : ''}`}>
              <input type="radio" name="user-role" checked={form.role === value} onChange={() => setForm((f) => ({ ...f, role: value }))} />
              <span>
                {label}
                <span className="pos-line-sub" style={{ fontWeight: 400 }}>
                  {ROLE_HINT[value]}
                </span>
              </span>
            </label>
          ))}
        </div>
        {isSelf && <span className="pos-muted pos-small">แก้ role ของตัวเองไม่ได้ กันไม่ให้ไม่มีเจ้าของเหลือในระบบ</span>}
      </fieldset>

      <label className="pos-field">
        <span>สาขา</span>
        {needsBranch ? (
          <select className="pos-input" value={form.branch_id || ''} onChange={set('branch_id')}>
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
          <input className="pos-input" value="ทุกสาขา" disabled />
        )}
      </label>

      <p className="pos-note is-muted">ผู้จัดการเห็นเฉพาะสาขาตัวเอง · เจ้าของเห็นทุกสาขา</p>
      {error && <p className="pos-error">{error}</p>}

      <div className="pos-side-actions">
        <button type="button" className="pos-btn" onClick={onCancel} disabled={saving}>
          ยกเลิก
        </button>
        <button className="pos-btn pos-btn-primary" disabled={saving}>
          {saving ? 'กำลังบันทึก…' : user ? 'บันทึก' : 'เพิ่มผู้ใช้'}
        </button>
      </div>
    </form>
  )
}
