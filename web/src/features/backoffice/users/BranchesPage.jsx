import { useCallback, useEffect, useState } from 'react'
import { createBranch, deleteBranch, listBranches, listUsers, updateBranch } from '../../../api/identity'
import { getBranchReport } from '../../../api/payment'
import { BRANCH_TYPES } from '../../../lib/constants'
import { thb, useToast } from '../../../lib/posUtils'
import { Toast } from '../../../components/ui/posUi'
import { errorText, todayTh } from '../useBranchScope'
import '../../../styles/pos.css'

// หน้าจัดการสาขา (owner) — 1.6 (Dev 1)
// ลบ = ปิดสาขา (soft delete) id ยังอยู่ให้ service อื่นอ้างถึง · บิล รายจ่าย รายงานย้อนหลังยังอยู่ · เปิดใช้อีกครั้งได้
// ผู้ใช้ของสาขาที่ปิดจะเข้าระบบไม่ได้ จึงให้พิมพ์ชื่อสาขายืนยันก่อนลบ

const typeLabel = (value) => BRANCH_TYPES.find((t) => t.value === value)?.label ?? value

export default function BranchesPage() {
  const [branches, setBranches] = useState([])
  const [users, setUsers] = useState([])
  const [sales, setSales] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState('new') // branch id | 'new'
  const [deleting, setDeleting] = useState(null) // branch
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  useEffect(() => {
    let cancelled = false
    const today = todayTh()
    Promise.all([
      listBranches({ include_inactive: true }),
      listUsers({}).catch(() => []),
      getBranchReport({ from: today, to: today }).catch(() => null),
    ])
      .then(([b, u, report]) => {
        if (cancelled) return
        setBranches(b || [])
        setUsers(u || [])
        setSales(new Map((report?.branches || []).map((r) => [r.branch_id, r.net_sales])))
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const sorted = [...branches].sort((a, b) =>
    a.is_active === b.is_active ? (a.code || '').localeCompare(b.code || '') : a.is_active === false ? 1 : -1,
  )
  const staffOf = (id) => users.filter((u) => u.branch_id === id && u.is_active !== false)
  const current = editing !== 'new' ? branches.find((b) => b.id === editing) || null : null

  async function restore(b) {
    setBusyId(b.id)
    try {
      await updateBranch(b.id, { is_active: true })
      notify(`เปิดสาขา ${b.name} อีกครั้งแล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">จัดการสาขา</h1>
          <p className="pos-subtitle">เพิ่ม แก้ไข และลบสาขา</p>
        </div>
        <button type="button" className="pos-btn pos-btn-primary" onClick={() => setEditing('new')}>
          + เพิ่มสาขา
        </button>
      </header>

      {error && (
        <div className="pos-alert">
          {error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-bo-layout">
        <section style={{ minWidth: 0 }} aria-label="สาขาทั้งหมด">
          {loading ? (
            <div className="pos-skeleton" />
          ) : sorted.length === 0 ? (
            <div className="pos-empty">ยังไม่มีสาขา</div>
          ) : (
            <div className="pos-branch-grid">
              {sorted.map((b) => {
                const inactive = b.is_active === false
                const staff = staffOf(b.id)
                const managers = staff.filter((u) => u.role === 'manager').map((u) => u.full_name || u.username)
                return (
                  <article key={b.id} className={`pos-panel pos-branch-card ${editing === b.id ? 'is-selected' : ''} ${inactive ? 'is-dim' : ''}`}>
                    <div className="pos-bill-card-row">
                      <h2 className="pos-panel-title" style={{ margin: 0 }}>
                        {b.name}
                      </h2>
                      <span className={`pos-pill ${inactive ? 'is-muted' : 'is-available'}`}>{inactive ? 'ปิดแล้ว' : 'เปิดอยู่'}</span>
                    </div>
                    <p className="pos-dialog-sub" style={{ margin: '2px 0 10px' }}>
                      {b.code} · ประเภท: {typeLabel(b.branch_type)}
                    </p>
                    <dl className="pos-kv">
                      <div>
                        <dt>พนักงาน</dt>
                        <dd>{staff.length} คน</dd>
                      </div>
                      <div>
                        <dt>ผู้จัดการ</dt>
                        <dd>{managers.join(', ') || '—'}</dd>
                      </div>
                      <div>
                        <dt>ยอดขายวันนี้</dt>
                        <dd>{sales.has(b.id) ? thb(sales.get(b.id)) : inactive ? '—' : thb(0)}</dd>
                      </div>
                      {b.phone && (
                        <div>
                          <dt>โทร</dt>
                          <dd>{b.phone}</dd>
                        </div>
                      )}
                    </dl>
                    <div className="pos-side-actions" style={{ justifyContent: 'flex-start' }}>
                      {inactive ? (
                        <button type="button" className="pos-btn" onClick={() => restore(b)} disabled={busyId === b.id}>
                          เปิดใช้อีกครั้ง
                        </button>
                      ) : (
                        <>
                          <button type="button" className="pos-btn" onClick={() => setEditing(b.id)}>
                            แก้ไข
                          </button>
                          <button type="button" className="pos-link-btn is-danger" onClick={() => setDeleting(b)}>
                            ลบสาขา
                          </button>
                        </>
                      )}
                    </div>
                  </article>
                )
              })}
            </div>
          )}

          {deleting && (
            <DeleteConfirm
              key={deleting.id}
              branch={deleting}
              userCount={staffOf(deleting.id).length}
              onCancel={() => setDeleting(null)}
              onDeleted={() => {
                notify(`ลบสาขา ${deleting.name} แล้ว`)
                if (editing === deleting.id) setEditing('new')
                setDeleting(null)
                reload()
              }}
            />
          )}

          <p className="pos-note is-muted" style={{ marginTop: 14 }}>
            ลบสาขา = ปิดสาขา · บิล รายจ่าย และรายงานย้อนหลังของสาขานั้นยังเก็บไว้ครบ และเปิดใช้อีกครั้งได้
          </p>
        </section>

        <aside className="pos-panel pos-side-panel" aria-label={current ? 'แก้ไขสาขา' : 'เพิ่มสาขาใหม่'}>
          <BranchEditor
            key={`${editing}:${reloadKey}`}
            branch={current}
            onCancel={() => setEditing('new')}
            onSaved={(msg) => {
              notify(msg)
              setEditing('new')
              reload()
            }}
          />
        </aside>
      </div>

      <Toast toast={toast} />
    </div>
  )
}

function DeleteConfirm({ branch, userCount, onCancel, onDeleted }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const match = typed.trim() === branch.name.trim()

  async function confirm() {
    setBusy(true)
    try {
      await deleteBranch(branch.id)
      onDeleted()
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <section className="pos-danger-box" role="alertdialog" aria-labelledby="del-title">
      <h2 id="del-title">ยืนยันการลบ “{branch.name}”?</h2>
      <p>
        {userCount > 0 ? `ผู้ใช้ ${userCount} คนที่ผูกกับสาขานี้จะเข้าระบบไม่ได้ · ` : ''}พิมพ์ชื่อสาขาเพื่อยืนยัน
      </p>
      <input className="pos-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={branch.name} aria-label="พิมพ์ชื่อสาขาเพื่อยืนยัน" autoFocus />
      {error && <p className="pos-error">{error}</p>}
      <div className="pos-side-actions" style={{ justifyContent: 'flex-start' }}>
        <button type="button" className="pos-btn" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
        <button type="button" className="pos-btn pos-btn-danger-solid" onClick={confirm} disabled={!match || busy}>
          {busy ? 'กำลังลบ…' : 'ลบสาขา'}
        </button>
      </div>
    </section>
  )
}

function BranchEditor({ branch, onCancel, onSaved }) {
  const [form, setForm] = useState({
    name: branch?.name ?? '',
    code: branch?.code ?? '',
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
    if (!name) return setError('กรุณากรอกชื่อสาขา')
    if (!/^[A-Z0-9_-]{2,20}$/.test(code)) return setError('รหัสสาขา 2–20 ตัว ใช้ A-Z 0-9 เช่น CAFE01')

    const body = { code, name, branch_type: form.branch_type, address: form.address.trim() || null, phone: form.phone.trim() || null }
    setSaving(true)
    setError('')
    try {
      if (branch) await updateBranch(branch.id, body)
      else await createBranch(body)
      onSaved(branch ? `บันทึก ${name} แล้ว` : `เพิ่มสาขา ${name} แล้ว`)
    } catch (err) {
      setError(err.status === 409 ? 'รหัสสาขานี้มีอยู่แล้ว' : errorText(err))
      setSaving(false)
    }
  }

  return (
    <form className="pos-editor" onSubmit={submit} noValidate>
      <h2 className="pos-panel-title">{branch ? `แก้ไข ${branch.name}` : 'เพิ่มสาขาใหม่'}</h2>
      <label className="pos-field">
        <span>ชื่อสาขา</span>
        <input className="pos-input" value={form.name} onChange={set('name')} maxLength={100} placeholder="เช่น สาขาคาเฟ่" />
      </label>
      <label className="pos-field">
        <span>รหัสสาขา (A-Z 0-9)</span>
        <input className="pos-input" value={form.code} onChange={set('code')} placeholder="เช่น CAFE01" autoCapitalize="characters" maxLength={20} />
      </label>
      <label className="pos-field">
        <span>ประเภทร้าน</span>
        <select className="pos-input" value={form.branch_type} onChange={set('branch_type')}>
          {BRANCH_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="pos-field">
        <span>ที่อยู่</span>
        <input className="pos-input" value={form.address} onChange={set('address')} maxLength={300} placeholder="กรอกที่อยู่สาขา" />
      </label>
      <label className="pos-field">
        <span>เบอร์โทร</span>
        <input className="pos-input" type="tel" value={form.phone} onChange={set('phone')} maxLength={20} />
      </label>
      {!branch && <p className="pos-note is-muted">หลังเพิ่มสาขา: ตั้งผู้จัดการที่หน้า “ผู้ใช้” และเพิ่มโต๊ะ/เมนูของสาขา</p>}
      {error && <p className="pos-error">{error}</p>}

      <div className="pos-side-actions">
        {branch && (
          <button type="button" className="pos-btn" onClick={onCancel} disabled={saving}>
            ยกเลิก
          </button>
        )}
        <button className={`pos-btn pos-btn-primary ${branch ? '' : 'pos-grow'}`} disabled={saving}>
          {saving ? 'กำลังบันทึก…' : branch ? 'บันทึก' : 'เพิ่มสาขา'}
        </button>
      </div>
    </form>
  )
}
