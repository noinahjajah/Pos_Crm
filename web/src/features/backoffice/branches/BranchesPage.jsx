// จัดการสาขา (owner)

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { identityApi } from '../../../api/identity.js'
import { useBranch } from '../../../app/providers.jsx'
import { PageHeader } from '../../../components/layout/Topbar.jsx'
import { useNotice } from '../../../components/ui/Notice.jsx'
import { Alert, Badge, Button, Card, Field, PhaseNote, Select, TextInput } from '../../../components/ui/index.jsx'
import { useForm } from '../../../hooks/useForm.js'
import { BRANCH_TYPE_LABEL } from '../../../lib/constants.js'

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
