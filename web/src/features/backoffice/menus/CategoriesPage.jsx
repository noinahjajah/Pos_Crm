import { useCallback, useEffect, useState } from 'react'
import { createCategory, listCategories, updateCategory } from '../../../api/catalog'
import { useBranchScope, useNotify } from '../useBranchScope'
import { errorText } from '../../../lib/format.js'
import './menus.css'
import '../backoffice.css'

// หน้าหมวดหมู่ — ของกลางทุกสาขา จัดการได้เฉพาะ owner (1.14)
// ปิดใช้แทนการลบ (เมนูเก่ายังอ้างหมวดได้)

export default function CategoriesPage() {
  const scope = useBranchScope()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null) // null | {} | category
  const notify = useNotify()

  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let cancelled = false
    listCategories({ include_inactive: true })
      .then((data) => !cancelled && (setRows(data), setError('')))
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  async function toggle(cat) {
    try {
      await updateCategory(cat.id, { is_active: !cat.is_active })
      notify(cat.is_active ? `ปิดใช้ ${cat.name} แล้ว` : `เปิดใช้ ${cat.name} แล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    }
  }

  if (scope.me && !scope.isOwner) {
    return (
      <div className="mm-page">
        <div className="mm-empty">หมวดหมู่ใช้ร่วมกันทุกสาขา จัดการได้เฉพาะเจ้าของร้าน</div>
      </div>
    )
  }

  return (
    <div className="mm-page">
      <header className="mm-header">
        <div>
          <h1 className="mm-title">หมวดหมู่เมนู</h1>
          <p className="mm-subtitle">ใช้ร่วมกันทุกสาขา · ลำดับน้อยแสดงก่อน</p>
        </div>
        <button className="mm-btn mm-btn-primary" onClick={() => setEditing({})}>
          + เพิ่มหมวด
        </button>
      </header>

      {error && <div className="mm-alert">{error}</div>}

      {loading ? (
        <div className="mm-card mm-skeleton" />
      ) : rows.length === 0 ? (
        <div className="mm-empty">ยังไม่มีหมวดหมู่ กด “+ เพิ่มหมวด” เพื่อเริ่ม</div>
      ) : (
        <div className="bo-table-wrap">
          <table className="bo-table">
            <thead>
              <tr>
                <th className="bo-num">ลำดับ</th>
                <th>ชื่อหมวด</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td className="bo-num bo-muted">{c.sort_order}</td>
                  <td>
                    <strong>{c.name}</strong>
                  </td>
                  <td>
                    <span className={`bo-status ${c.is_active ? 'is-on' : ''}`}>{c.is_active ? 'ใช้งาน' : 'ปิดใช้'}</span>
                  </td>
                  <td>
                    <div className="bo-row-actions">
                      <button className="mm-btn" onClick={() => setEditing(c)}>
                        แก้ไข
                      </button>
                      <button className="mm-btn" onClick={() => toggle(c)}>
                        {c.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CategoryDialog
          category={editing.id ? editing : null}
          nextOrder={rows.reduce((m, c) => Math.max(m, c.sort_order), 0) + 1}
          onClose={() => setEditing(null)}
          onSaved={(msg) => {
            setEditing(null)
            notify(msg)
            reload()
          }}
        />
      )}
    </div>
  )
}

function CategoryDialog({ category, nextOrder, onClose, onSaved }) {
  const [name, setName] = useState(category?.name ?? '')
  const [sortOrder, setSortOrder] = useState(category?.sort_order ?? nextOrder)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const order = Number(sortOrder)
    if (!name.trim()) return setError('กรุณากรอกชื่อหมวด')
    if (!Number.isInteger(order) || order < 0) return setError('ลำดับต้องเป็นจำนวนเต็มตั้งแต่ 0')
    setSaving(true)
    try {
      const body = { name: name.trim(), sort_order: order }
      if (category) await updateCategory(category.id, body)
      else await createCategory(body)
      onSaved(category ? `บันทึก ${body.name} แล้ว` : `เพิ่มหมวด ${body.name} แล้ว`)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog mm-dialog-sm" onSubmit={submit}>
        <h2 className="mm-dialog-title">{category ? `แก้ไข ${category.name}` : 'เพิ่มหมวดหมู่'}</h2>
        <p className="mm-hint">หมวดหมู่ใช้ร่วมกันทุกสาขา</p>
        <div className="mm-fields">
          <label className="mm-field">
            <span>ชื่อหมวด *</span>
            <input className="mm-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </label>
          <label className="mm-field">
            <span>ลำดับการแสดง</span>
            <input className="mm-input" type="number" min="0" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
          </label>
        </div>
        {error && <div className="mm-alert" style={{ marginTop: 16 }}>{error}</div>}
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
