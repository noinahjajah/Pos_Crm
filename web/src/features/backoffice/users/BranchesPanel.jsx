import { useState } from 'react'
import { createBranch, deleteBranch, updateBranch } from '../../../api/identity'
import { BRANCH_TYPES } from '../../../lib/constants'
import { errorText } from '../useBranchScope'

// แท็บสาขา (owner เท่านั้น) — 1.6
// ลบ = soft delete (is_active = false) เพื่อไม่ให้ id ที่ service อื่นอ้างถึงหาย · เปิดใช้อีกครั้งได้

const typeLabel = (value) => BRANCH_TYPES.find((t) => t.value === value)?.label ?? value

export default function BranchesPanel({ branches, onChanged, notify }) {
  const [editing, setEditing] = useState(null) // null | {} | branch
  const [busyId, setBusyId] = useState(null)

  const sorted = [...branches].sort((a, b) =>
    a.is_active === b.is_active ? (a.code || '').localeCompare(b.code || '') : a.is_active === false ? 1 : -1,
  )

  async function run(branch, action, message) {
    setBusyId(branch.id)
    try {
      await action()
      notify(message)
      onChanged()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  function remove(branch) {
    if (!window.confirm(`ลบสาขา "${branch.name}" ?\nพนักงานของสาขานี้จะทำงานต่อไม่ได้จนกว่าจะย้ายสาขาหรือเปิดสาขาอีกครั้ง`)) return
    run(branch, () => deleteBranch(branch.id), `ลบสาขา ${branch.name} แล้ว`)
  }

  return (
    <>
      <div className="us-toolbar">
        <p className="bo-muted" style={{ margin: 0 }}>
          ทั้งหมด {branches.filter((b) => b.is_active !== false).length} สาขาที่เปิดอยู่
        </p>
        <button className="mm-btn mm-btn-primary" onClick={() => setEditing({})}>
          + เพิ่มสาขา
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="mm-empty">ยังไม่มีสาขา</div>
      ) : (
        <div className="us-branches">
          {sorted.map((b) => {
            const inactive = b.is_active === false
            return (
              <article key={b.id} className={`us-branch ${inactive ? 'us-inactive' : ''}`}>
                <div className="us-branch-head">
                  <span className="us-code">{b.code}</span>
                  <span className={`bo-status ${inactive ? 'is-empty' : 'is-on'}`}>{inactive ? 'ปิดแล้ว' : 'เปิดอยู่'}</span>
                </div>
                <h3 className="us-branch-name">{b.name}</h3>
                <div className="us-branch-type">{typeLabel(b.branch_type)}</div>
                <dl className="us-branch-meta">
                  <div>
                    <dt>ที่อยู่</dt>
                    <dd>{b.address || '—'}</dd>
                  </div>
                  <div>
                    <dt>โทร</dt>
                    <dd>{b.phone || '—'}</dd>
                  </div>
                </dl>
                <div className="bo-row-actions us-branch-actions">
                  {inactive ? (
                    <button
                      className="mm-btn"
                      disabled={busyId === b.id}
                      onClick={() => run(b, () => updateBranch(b.id, { is_active: true }), `เปิดสาขา ${b.name} อีกครั้งแล้ว`)}
                    >
                      เปิดใช้อีกครั้ง
                    </button>
                  ) : (
                    <>
                      <button className="mm-btn" disabled={busyId === b.id} onClick={() => setEditing(b)}>
                        แก้ไข
                      </button>
                      <button className="mm-btn mm-btn-danger" disabled={busyId === b.id} onClick={() => remove(b)}>
                        ลบ
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}

      {editing && (
        <BranchDialog
          branch={editing.id ? editing : null}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            notify(msg)
            onChanged()
          }}
        />
      )}
    </>
  )
}

function BranchDialog({ branch, onClose, onSaved }) {
  const [form, setForm] = useState({
    code: branch?.code ?? '',
    name: branch?.name ?? '',
    branch_type: branch?.branch_type ?? 'restaurant',
    address: branch?.address ?? '',
    phone: branch?.phone ?? '',
  })
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    const code = form.code.trim().toUpperCase()
    const name = form.name.trim()
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return setError('รหัสสาขา 2–20 ตัว ใช้ A-Z 0-9 เช่น BAR01')
    if (!name) return setError('กรุณากรอกชื่อสาขา')

    const body = {
      code,
      name,
      branch_type: form.branch_type,
      address: form.address.trim() || null,
      phone: form.phone.trim() || null,
    }
    setSaving(true)
    try {
      if (branch) await updateBranch(branch.id, body)
      else await createBranch(body)
      onSaved(branch ? 'บันทึกการแก้ไขแล้ว' : `เพิ่มสาขา ${name} แล้ว`)
    } catch (err) {
      setError(err.status === 409 ? 'รหัสสาขานี้มีอยู่แล้ว' : errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog mm-dialog-sm" onSubmit={submit} noValidate>
        <h2 className="mm-dialog-title">{branch ? 'แก้ไขสาขา' : 'เพิ่มสาขา'}</h2>
        <div className="mm-fields" style={{ marginTop: 16 }}>
          <div className="mm-two">
            <label className="mm-field">
              <span>รหัสสาขา *</span>
              <input
                className="mm-input"
                value={form.code}
                onChange={set('code')}
                placeholder="เช่น BAR01"
                autoCapitalize="characters"
                autoFocus
              />
            </label>
            <label className="mm-field">
              <span>ประเภท *</span>
              <select className="mm-select" value={form.branch_type} onChange={set('branch_type')}>
                {BRANCH_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mm-field">
            <span>ชื่อสาขา *</span>
            <input className="mm-input" value={form.name} onChange={set('name')} maxLength={100} />
          </label>
          <label className="mm-field">
            <span>ที่อยู่</span>
            <input className="mm-input" value={form.address} onChange={set('address')} maxLength={300} />
          </label>
          <label className="mm-field">
            <span>เบอร์โทร</span>
            <input className="mm-input" type="tel" value={form.phone} onChange={set('phone')} maxLength={20} />
          </label>
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
