// จัดการผู้ใช้ (owner ทุกสาขา · manager ดูพนักงานในสาขาตัวเอง)

import { useCallback, useEffect, useState } from 'react'
import { identityApi, passwordOk, randomPassword } from '../../../api/identity.js'
import { useBranch } from '../../../app/providers.jsx'
import { PageHeader } from '../../../components/layout/Topbar.jsx'
import { useNotice } from '../../../components/ui/Notice.jsx'
import { Alert, Avatar, Badge, BranchOptions, Button, Card, Field, Select, SidePanel, TextInput } from '../../../components/ui/index.jsx'
import { useAuth } from '../../auth/AuthContext.jsx'
import { useForm } from '../../../hooks/useForm.js'
import { AVATAR_COLOR, ROLE_LABEL, ROLE_TONE } from '../../../lib/constants.js'
import { dateTime } from '../../../lib/format.js'

const LIMIT = 20

// จัดการผู้ใช้: ตารางผู้ใช้ + แผงเพิ่ม/แก้ไขด้านขวา
export function UsersPage() {
  const { user: me } = useAuth()
  const { selectedBranchId } = useBranch()
  const { toast, confirm } = useNotice()
  const isOwner = me.role === 'owner'

  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ page: 1, total: 0 })
  const [page, setPage] = useState(1)
  const [q, setQ] = useState('')
  const [role, setRole] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await identityApi.listUsers({
        page,
        limit: LIMIT,
        q: q || undefined,
        role: role || undefined,
        include_inactive: isOwner && showInactive ? 'true' : undefined,
        branch_id: isOwner ? selectedBranchId || undefined : undefined,
      })
      setRows(res.data)
      setMeta(res.meta)
    } catch (e) {
      setError(e.message)
    }
  }, [page, q, role, showInactive, isOwner, selectedBranchId])

  useEffect(() => {
    const t = setTimeout(load, 250)
    return () => clearTimeout(t)
  }, [load])

  async function remove(u) {
    const ok = await confirm({
      title: `ลบผู้ใช้ ${u.full_name}?`,
      message: `${u.username} จะถูกปิดบัญชีและออกจากระบบทุกเครื่อง`,
      confirmLabel: 'ลบผู้ใช้',
    })
    if (!ok) return
    try {
      await identityApi.deleteUser(u.id)
      toast(`ลบผู้ใช้ ${u.username} แล้ว`)
      load()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  const pages = Math.max(1, Math.ceil((meta.total || 0) / LIMIT))

  return (
    <>
      <PageHeader
        title={isOwner ? 'จัดการผู้ใช้งาน' : 'พนักงานในสาขา'}
        subtitle={
          isOwner
            ? 'เพิ่ม แก้ไข กำหนด Role และสาขาที่รับผิดชอบ'
            : `${me.branch?.name ?? ''} · ดูรายชื่อได้อย่างเดียว เพิ่ม/ลบผู้ใช้ทำได้โดย Owner`
        }
        showBranchSwitch
        actions={isOwner && <Button onClick={() => setEditing('new')}>+ เพิ่มผู้ใช้</Button>}
      />
      <div className="content">
        <div className={editing ? 'with-panel' : ''}>
          <div>
            <Alert>{error}</Alert>
            <Card
              title={`ผู้ใช้ทั้งหมด (${meta.total ?? 0})`}
              actions={
                <div className="toolbar">
                  <TextInput
                    placeholder="ค้นหาชื่อหรือ username…"
                    value={q}
                    onChange={(e) => {
                      setQ(e.target.value)
                      setPage(1)
                    }}
                  />
                  <Select
                    value={role}
                    onChange={(e) => {
                      setRole(e.target.value)
                      setPage(1)
                    }}
                  >
                    <option value="">Role: ทั้งหมด</option>
                    <option value="owner">Owner</option>
                    <option value="manager">Manager</option>
                    <option value="staff">Staff</option>
                  </Select>
                  {isOwner && (
                    <label className="check">
                      <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> แสดงที่ลบแล้ว
                    </label>
                  )}
                </div>
              }
            >
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>ผู้ใช้</th>
                      <th>Role</th>
                      <th>สาขา</th>
                      <th>สถานะ</th>
                      <th>เข้าใช้ล่าสุด</th>
                      {isOwner && <th style={{ textAlign: 'right' }}>จัดการ</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((u) => (
                      <tr key={u.id} className={u.is_active ? '' : 'inactive'}>
                        <td>
                          <div className="person">
                            <Avatar name={u.full_name} color={AVATAR_COLOR[u.role]} size="sm" />
                            <div>
                              <div>
                                {u.full_name} {u.id === me.id && <span className="muted">(คุณ)</span>}
                              </div>
                              <div className="sub">{u.username}</div>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge tone={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Badge>
                        </td>
                        <td>{u.branch ? u.branch.name : <span className="muted">ทุกสาขา</span>}</td>
                        <td>
                          {!u.is_active ? (
                            <Badge>ลบแล้ว</Badge>
                          ) : u.must_change_password ? (
                            <Badge tone="warning">รอตั้งรหัสใหม่</Badge>
                          ) : (
                            <Badge tone="success">ใช้งาน</Badge>
                          )}
                        </td>
                        <td className="muted">
                          {u.last_login_at ? dateTime(u.last_login_at) : 'ยังไม่เคยเข้า'}
                        </td>
                        {isOwner && (
                          <td>
                            <div className="actions">
                              <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                                แก้ไข
                              </Button>
                              {u.is_active && u.id !== me.id && (
                                <Button variant="ghost" size="sm" className="danger" onClick={() => remove(u)}>
                                  ลบ
                                </Button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!rows.length && <div className="empty">ไม่พบผู้ใช้</div>}
              </div>
              <div className="pager">
                แสดง {rows.length} จาก {meta.total ?? 0} รายการ
                <div className="grow" />
                <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  ‹ ก่อนหน้า
                </Button>
                หน้า {page} / {pages}
                <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                  ถัดไป ›
                </Button>
              </div>
            </Card>
          </div>
          {editing && (
            <UserForm
              key={editing === 'new' ? 'new' : editing.id}
              user={editing === 'new' ? null : editing}
              isSelf={editing !== 'new' && editing.id === me.id}
              onClose={() => setEditing(null)}
              onSaved={(message) => {
                setEditing(null)
                toast(message)
                load()
              }}
            />
          )}
        </div>
      </div>
    </>
  )
}

const ROLE_OPTIONS = [
  { value: 'owner', label: 'Owner', desc: 'เห็นทุกสาขา จัดการผู้ใช้และสาขา อนุมัติคำขอ' },
  { value: 'manager', label: 'Manager', desc: 'ดูแลเฉพาะสาขาที่กำหนด อนุมัติคำขอของสาขา' },
  { value: 'staff', label: 'Staff', desc: 'พนักงานหน้าร้าน (เสิร์ฟ + แคชเชียร์)' },
]

// ฟอร์มผู้ใช้
function UserForm({ user, isSelf, onClose, onSaved }) {
  const { branches, selectedBranchId } = useBranch()
  const isNew = !user
  const { form, setForm, set, errors, error, busy, submit } = useForm({
    username: user?.username ?? '',
    full_name: user?.full_name ?? '',
    role: user?.role ?? 'staff',
    branch_id: user?.branch_id ?? '',
    password: '',
    is_active: user?.is_active ?? true,
  })

  const branchValue = form.branch_id || (isNew ? selectedBranchId || branches[0]?.id || '' : '')

  function save() {
    const branch_id = form.role === 'owner' ? null : branchValue || null
    return submit(async () => {
      if (isNew) {
        const { data } = await identityApi.createUser({
          username: form.username,
          password: form.password,
          full_name: form.full_name,
          role: form.role,
          branch_id,
        })
        return onSaved(`เพิ่มผู้ใช้ ${data.username} แล้ว · ต้องเปลี่ยนรหัสผ่านตอนเข้าครั้งแรก`)
      }
      const body = { full_name: form.full_name, role: form.role, branch_id }
      if (form.password) body.password = form.password
      if (form.is_active !== user.is_active) body.is_active = form.is_active
      await identityApi.updateUser(user.id, body)
      onSaved(`บันทึกข้อมูล ${user.username} แล้ว`)
    })
  }

  return (
    <SidePanel
      title={isNew ? 'เพิ่มผู้ใช้' : `แก้ไขผู้ใช้ ${user.username}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button onClick={save} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </>
      }
    >
      <Alert>{error}</Alert>
      <div className="grid-2">
        <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
          <TextInput value={form.full_name} onChange={set('full_name')} invalid={!!errors.full_name} />
        </Field>
        <Field label="ชื่อผู้ใช้ (username)" hint={isNew ? 'a-z 0-9 . _ -' : 'แก้ไม่ได้'} error={errors.username}>
          <TextInput value={form.username} onChange={set('username')} disabled={!isNew} invalid={!!errors.username} autoCapitalize="none" />
        </Field>
      </div>
      <Field
        label={isNew ? 'รหัสผ่านชั่วคราว' : 'รีเซ็ตรหัสผ่าน'}
        hint={
          isNew
            ? '8 ตัวขึ้นไป มีตัวอักษรและตัวเลข · ผู้ใช้ต้องเปลี่ยนเองตอนเข้าครั้งแรก'
            : 'เว้นว่างถ้าไม่เปลี่ยน · รีเซ็ตแล้วผู้ใช้ต้องตั้งรหัสใหม่ และปลดล็อกบัญชีให้ด้วย'
        }
        error={errors.password || (form.password && !passwordOk(form.password) ? 'ต้องมี 8 ตัวขึ้นไป มีตัวอักษรและตัวเลข' : '')}
      >
        <div className="pw-wrap">
          <TextInput value={form.password} onChange={set('password')} autoComplete="new-password" invalid={!!errors.password} spellCheck={false} />
          <button type="button" className="pw-toggle" onClick={() => setForm((f) => ({ ...f, password: randomPassword() }))}>
            สุ่มรหัส
          </button>
        </div>
      </Field>

      <div className="field">
        <span>กำหนด Role {isSelf && <em className="hint">เปลี่ยน role ของตัวเองไม่ได้</em>}</span>
        <div className="radio-cards">
          {ROLE_OPTIONS.map((r) => (
            <label key={r.value} className={`radio-card ${form.role === r.value ? 'selected' : ''}`}>
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={form.role === r.value}
                disabled={isSelf}
                onChange={set('role')}
              />
              <div>
                <b>{r.label}</b>
                <small>{r.desc}</small>
              </div>
            </label>
          ))}
        </div>
      </div>

      {form.role !== 'owner' && (
        <Field label="สาขาที่รับผิดชอบ" error={errors.branch_id} hint={form.role === 'manager' ? 'Manager เห็นและจัดการได้เฉพาะสาขานี้' : ''}>
          <Select value={branchValue} onChange={set('branch_id')}>
            <option value="">— เลือกสาขา —</option>
            <BranchOptions branches={branches} />
          </Select>
        </Field>
      )}

      {!isNew && !isSelf && (
        <label className="check">
          <input type="checkbox" checked={form.is_active} onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
          บัญชีใช้งานได้ (ปิด = ลบผู้ใช้ และออกจากระบบทุกเครื่อง)
        </label>
      )}
    </SidePanel>
  )
}
