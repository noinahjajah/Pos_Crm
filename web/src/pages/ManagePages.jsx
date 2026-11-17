// หน้าจัดการผู้ใช้และจัดการสาขา

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { identityApi, passwordOk, randomPassword } from '../app/api.js'
import { BRANCH_TYPE_LABEL, useAuth, useBranch, useNotice } from '../app/providers.jsx'
import { Alert, AVATAR_COLOR, Avatar, Badge, BranchOptions, Button, Card, dateTime, Field, PageHeader, PhaseNote, SidePanel, ROLE_LABEL, ROLE_TONE, Select, TextInput, useForm } from '../app/ui.jsx'

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

const EMPTY = { code: '', name: '', branch_type: 'restaurant', address: '', phone: '' }

// จัดการสาขา: การ์ดสาขา + ฟอร์มเพิ่มสาขาด้านล่าง
export function BranchesPage() {
  const { reload: reloadSwitcher, selectBranch } = useBranch()
  const { toast, confirm } = useNotice()
  const navigate = useNavigate()
  const formRef = useRef(null)
  const [branches, setBranches] = useState([])
  const [stats, setStats] = useState({})
  const [showClosed, setShowClosed] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)

  function startEdit(b) {
    setEditing(b)
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 0)
  }

  const load = useCallback(async () => {
    try {
      const [{ data }, users] = await Promise.all([
        identityApi.listBranches({ include_inactive: showClosed }),
        identityApi.listUsers({ limit: 100 }),
      ])
      setBranches(data)
      const next = {}
      for (const u of users.data) {
        if (!u.branch_id || !u.is_active) continue
        const st = (next[u.branch_id] ||= { manager: null, staff: 0 })
        if (u.role === 'manager') st.manager ??= u.full_name
        if (u.role === 'staff') st.staff += 1
      }
      setStats(next)
      setError('')
    } catch (e) {
      setError(e.message)
    }
  }, [showClosed])

  useEffect(() => {
    const t = setTimeout(load, 0)
    return () => clearTimeout(t)
  }, [load])

  async function afterChange() {
    await load()
    reloadSwitcher()
  }

  async function close(b) {
    const ok = await confirm({
      title: `ปิดสาขา ${b.name}?`,
      message: `${b.code} · พนักงานในสาขานี้ต้องถูกย้ายหรือลบก่อน`,
      confirmLabel: 'ปิดสาขา',
    })
    if (!ok) return
    try {
      await identityApi.deleteBranch(b.id)
      toast(`ปิดสาขา ${b.name} แล้ว`)
      afterChange()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  async function reopen(b) {
    try {
      await identityApi.updateBranch(b.id, { is_active: true })
      toast(`เปิดสาขา ${b.name} อีกครั้งแล้ว`)
      afterChange()
    } catch (e) {
      toast(e.message, 'error')
    }
  }

  return (
    <>
      <PageHeader
        title="จัดการสาขา"
        subtitle="เพิ่ม แก้ไข หรือปิดสาขา · ชื่อ ที่อยู่ และเบอร์โทรใช้พิมพ์หัวใบเสร็จ"
        actions={<Button onClick={() => startEdit(null)}>+ เพิ่มสาขา</Button>}
      />
      <div className="content">
        <Alert>{error}</Alert>
        <div className="toolbar">
          <label className="check">
            <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> แสดงสาขาที่ปิดแล้ว
          </label>
        </div>
        <div className="branch-cards">
          {branches.map((b) => (
            <Card key={b.id} className={`branch-card ${b.is_active ? '' : 'closed'}`}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="code">{b.code}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 16 }}>{b.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {BRANCH_TYPE_LABEL[b.branch_type]} · รหัส {b.code}
                  </div>
                </div>
                {b.is_active ? <Badge tone="success">เปิดอยู่</Badge> : <Badge tone="neutral">ปิดแล้ว</Badge>}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                {b.address || 'ยังไม่ระบุที่อยู่'} · โทร {b.phone || '—'}
              </div>
              <div className="stat-row">
                <div className="stat">
                  <small>ผู้จัดการ</small>
                  {stats[b.id]?.manager || '—'}
                </div>
                <div className="stat">
                  <small>พนักงาน</small>
                  {stats[b.id]?.staff || 0} คน
                </div>
                <div className="stat">
                  <small>ประเภท</small>
                  {BRANCH_TYPE_LABEL[b.branch_type]}
                </div>
              </div>
              <div className="toolbar">
                <Button variant="secondary" onClick={() => startEdit(b)}>
                  แก้ไข
                </Button>
                {b.is_active && (
                  <Button
                    variant="secondary"
                    onClick={() => {
                      selectBranch(b.id)
                      navigate('/dashboard')
                    }}
                  >
                    ดูแดชบอร์ด
                  </Button>
                )}
                <div style={{ flex: 1 }} />
                {b.is_active ? (
                  <Button variant="ghost" className="danger" onClick={() => close(b)}>
                    ปิดสาขา
                  </Button>
                ) : (
                  <Button variant="ghost" onClick={() => reopen(b)}>
                    เปิดสาขาอีกครั้ง
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
        {!branches.length && !error && <div className="empty">ยังไม่มีสาขา</div>}

        <div ref={formRef}>
          <BranchForm
            key={editing?.id ?? 'new'}
            branch={editing}
            onCancel={() => setEditing(null)}
            onSaved={(message) => {
              setEditing(null)
              toast(message)
              afterChange()
            }}
          />
        </div>
      </div>
    </>
  )
}

// ฟอร์มสาขา
function BranchForm({ branch, onCancel, onSaved }) {
  const { form, set, errors, error, busy, submit, reset } = useForm(
    branch ? { ...EMPTY, ...branch, address: branch.address || '', phone: branch.phone || '' } : EMPTY,
  )

  function save() {
    const body = {
      code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      branch_type: form.branch_type,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
    }
    return submit(async () => {
      if (branch) await identityApi.updateBranch(branch.id, body)
      else await identityApi.createBranch(body)
      reset(EMPTY)
      onSaved(branch ? `บันทึกสาขา ${body.name} แล้ว` : `เพิ่มสาขา ${body.name} แล้ว`)
    })
  }

  return (
    <Card className="inline-form" title={branch ? `แก้ไขสาขา ${branch.code}` : 'เพิ่มสาขาใหม่'}>
      <Alert>{error}</Alert>
      <div className="grid-2">
        <Field label="ชื่อสาขา" error={errors.name}>
          <TextInput value={form.name} onChange={set('name')} invalid={!!errors.name} placeholder="เช่น สาขาบาร์" />
        </Field>
        <Field label="รหัสสาขา" hint="A-Z 0-9" error={errors.code}>
          <TextInput value={form.code} onChange={set('code')} invalid={!!errors.code} placeholder="เช่น BAR01" />
        </Field>
        <Field label="ประเภทสาขา" error={errors.branch_type}>
          <Select value={form.branch_type} onChange={set('branch_type')}>
            {Object.entries(BRANCH_TYPE_LABEL).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="เบอร์โทร" error={errors.phone}>
          <TextInput value={form.phone} onChange={set('phone')} placeholder="02-xxx-xxxx" />
        </Field>
      </div>
      <Field label="ที่อยู่" hint="แสดงบนหัวใบเสร็จ" error={errors.address}>
        <TextInput value={form.address} onChange={set('address')} />
      </Field>
      <PhaseNote title="เวลาเปิด–ปิดสาขา">ตั้งเวลาเปิด–ปิดของแต่ละสาขา จะเพิ่มในเฟส 2</PhaseNote>
      <div className="form-actions">
        {(branch || form.name || form.code) && (
          <Button
            variant="secondary"
            onClick={() => {
              reset(EMPTY)
              onCancel()
            }}
          >
            ยกเลิก
          </Button>
        )}
        <Button onClick={save} disabled={busy}>
          {busy ? 'กำลังบันทึก…' : 'บันทึกสาขา'}
        </Button>
      </div>
    </Card>
  )
}
