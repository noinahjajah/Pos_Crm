import { useCallback, useEffect, useMemo, useState } from 'react'
import { useBranchScope, useNotify } from '../useBranchScope'
import { copyMenu, deleteMenu, listCategories, listMenus, setMenuAvailability } from '../../../api/catalog'
import MenuFormDialog from './MenuFormDialog'
import '../backoffice.css'
import { errorText } from '../../../lib/format.js'

// หน้าจัดการเมนู (หลังร้าน) — 1.14, 1.15, 1.18
// manager: เมนูของสาขาตัวเอง · owner: เลือกสาขาได้ และคัดลอกเมนูข้ามสาขาได้


const baht = new Intl.NumberFormat('th-TH', { style: 'currency', currency: 'THB' })

export default function MenusPage() {
  const { me, branches, branchId, setBranchId, isOwner, canManage } = useBranchScope()
  const notify = useNotify()
  const [categories, setCategories] = useState([])
  const [menus, setMenus] = useState([])
  const [categoryId, setCategoryId] = useState('')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null = ปิด, {} = เพิ่มใหม่, menu = แก้ไข
  const [copying, setCopying] = useState(null)
  const [busyId, setBusyId] = useState(null)

  // หมวดหมู่ (โหลดครั้งเดียว)
  useEffect(() => {
    let cancelled = false
    listCategories()
      .then((cats) => !cancelled && setCategories(cats))
      .catch((err) => {
        if (cancelled) return
        setError(errorText(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // โหลดเมนูของสาขาที่เลือก (โหลดใหม่เมื่อเปลี่ยนสาขาหรือกด reload)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    listMenus({ branch_id: branchId })
      .then((rows) => {
        if (cancelled) return
        setMenus(rows)
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [branchId, reloadKey])

  const loadMenus = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  function changeBranch(id) {
    setLoading(true)
    setBranchId(id)
  }

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menus
      .filter((m) => !categoryId || m.category_id === categoryId)
      .filter((m) => !q || m.name.toLowerCase().includes(q))
  }, [menus, categoryId, search])

  const branchName = (id) => branches.find((b) => b.id === id)?.name || ''

  async function toggleAvailable(menu) {
    setBusyId(menu.id)
    try {
      const res = await setMenuAvailability(menu.id, !menu.is_available)
      setMenus((list) => list.map((m) => (m.id === menu.id ? { ...m, is_available: res.is_available } : m)))
      notify(res.is_available ? `เปิดขาย ${menu.name}` : `ปิดขาย ${menu.name}`)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function remove(menu) {
    if (!window.confirm(`ลบเมนู "${menu.name}" ?\nบิลเก่าที่เคยสั่งเมนูนี้จะไม่ได้รับผลกระทบ`)) return
    setBusyId(menu.id)
    try {
      await deleteMenu(menu.id)
      setMenus((list) => list.filter((m) => m.id !== menu.id))
      notify(`ลบ ${menu.name} แล้ว`)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function doCopy(toBranchId) {
    try {
      await copyMenu(copying.id, toBranchId)
      notify(`คัดลอก ${copying.name} ไป ${branchName(toBranchId)} แล้ว (สต็อก 0 ปิดขายไว้ก่อน)`)
      setCopying(null)
    } catch (err) {
      notify(errorText(err), 'error')
    }
  }

  function onSaved(menu, isNew) {
    setEditing(null)
    notify(isNew ? `เพิ่ม ${menu.name} แล้ว (สต็อก 0 ปิดขายไว้ก่อน)` : `บันทึก ${menu.name} แล้ว`)
    loadMenus()
  }

  if (me && !canManage) {
    return (
      <div className="mm-page">
        <div className="mm-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">จัดการเมนู</h1>
          <p className="mm-subtitle">
            {isOwner ? 'เลือกสาขาที่ต้องการแก้ไข เมนูของแต่ละสาขาแยกกัน' : `สาขา ${branchName(branchId)}`}
          </p>
        </div>
        <div className="mm-header-actions">
          {isOwner && (
            <select className="mm-select" value={branchId} onChange={(e) => changeBranch(e.target.value)}>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          )}
          <button className="mm-btn mm-btn-primary" onClick={() => setEditing({})} disabled={!branchId}>
            + เพิ่มเมนู
          </button>
        </div>
      </header>

      <div className="mm-toolbar">
        <input
          className="mm-input mm-search"
          placeholder="ค้นหาชื่อเมนู"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="mm-chips">
          <button className={`mm-chip ${!categoryId ? 'is-active' : ''}`} onClick={() => setCategoryId('')}>
            ทั้งหมด <span>{menus.length}</span>
          </button>
          {categories.map((c) => {
            const count = menus.filter((m) => m.category_id === c.id).length
            return (
              <button
                key={c.id}
                className={`mm-chip ${categoryId === c.id ? 'is-active' : ''}`}
                onClick={() => setCategoryId(c.id)}
              >
                {c.name} <span>{count}</span>
              </button>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="mm-alert">
          {error}
          <button className="mm-link" onClick={loadMenus}>
            ลองใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="mm-grid">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="mm-card mm-skeleton" />
          ))}
        </div>
      ) : shown.length === 0 ? (
        <div className="mm-empty">
          {menus.length === 0 ? 'ยังไม่มีเมนูในสาขานี้ กด “+ เพิ่มเมนู” เพื่อเริ่ม' : 'ไม่พบเมนูที่ค้นหา'}
        </div>
      ) : (
        <div className="mm-grid">
          {shown.map((m) => {
            const empty = m.quantity <= 0
            return (
              <article key={m.id} className={`mm-card ${m.is_available ? '' : 'is-off'}`}>
                <div className="mm-thumb">
                  {m.image_url ? <img src={m.image_url} alt={m.name} /> : <span aria-hidden="true">🍽️</span>}
                  <span className={`mm-badge ${m.is_available ? 'is-on' : ''}`}>
                    {m.is_available ? 'เปิดขาย' : 'ปิดขาย'}
                  </span>
                </div>
                <div className="mm-body">
                  <div className="mm-row">
                    <h3 className="mm-name">{m.name}</h3>
                    <strong className="mm-price">{baht.format(m.price)}</strong>
                  </div>
                  <div className="mm-meta">
                    <span>{m.category_name}</span>
                    <span className={empty ? 'mm-stock-empty' : ''}>คงเหลือ {m.quantity}</span>
                  </div>
                  {m.description && <p className="mm-desc">{m.description}</p>}
                </div>
                <footer className="mm-actions">
                  <label
                    className="mm-switch"
                    title={empty && !m.is_available ? 'สต็อกเป็น 0 ต้องเติมสต็อกก่อนเปิดขาย' : ''}
                  >
                    <input
                      type="checkbox"
                      checked={m.is_available}
                      disabled={busyId === m.id || (empty && !m.is_available)}
                      onChange={() => toggleAvailable(m)}
                    />
                    <span />
                  </label>
                  <div className="mm-action-btns">
                    <button className="mm-btn" onClick={() => setEditing(m)} disabled={busyId === m.id}>
                      แก้ไข
                    </button>
                    {isOwner && (
                      <button className="mm-btn" onClick={() => setCopying(m)} disabled={busyId === m.id}>
                        คัดลอก
                      </button>
                    )}
                    <button className="mm-btn mm-btn-danger" onClick={() => remove(m)} disabled={busyId === m.id}>
                      ลบ
                    </button>
                  </div>
                </footer>
              </article>
            )
          })}
        </div>
      )}

      {editing && (
        <MenuFormDialog
          menu={editing.id ? editing : null}
          branchId={branchId}
          branchName={branchName(branchId)}
          isOwner={isOwner}
          categories={categories.filter((c) => c.is_active !== false)}
          onClose={() => setEditing(null)}
          onSaved={onSaved}
        />
      )}

      {copying && (
        <CopyDialog
          menu={copying}
          branches={branches.filter((b) => b.id !== copying.branch_id)}
          onClose={() => setCopying(null)}
          onCopy={doCopy}
        />
      )}
    </div>
  )
}

/** owner เลือกสาขาปลายทางเพื่อคัดลอกเมนู */
function CopyDialog({ menu, branches, onClose, onCopy }) {
  const [target, setTarget] = useState(branches[0]?.id || '')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    await onCopy(target)
    setSaving(false)
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="mm-dialog mm-dialog-sm" onSubmit={submit}>
        <h2 className="mm-dialog-title">คัดลอก “{menu.name}”</h2>
        <p className="mm-hint">คัดลอกพร้อมกลุ่มตัวเลือก สาขาปลายทางเริ่มที่สต็อก 0 และปิดขายไว้ก่อน แก้ไขแยกกันได้ภายหลัง</p>
        <label className="mm-field">
          <span>ไปที่สาขา</span>
          <select className="mm-select" value={target} onChange={(e) => setTarget(e.target.value)} required>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <div className="mm-dialog-actions">
          <button type="button" className="mm-btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button className="mm-btn mm-btn-primary" disabled={!target || saving}>
            {saving ? 'กำลังคัดลอก…' : 'คัดลอก'}
          </button>
        </div>
      </form>
    </div>
  )
}
