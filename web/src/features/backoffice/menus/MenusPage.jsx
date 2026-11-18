import { useCallback, useEffect, useMemo, useState } from 'react'
import { copyMenu, deleteMenu, listCategories, listMenus, listOptionGroups, setMenuAvailability } from '../../../api/catalog'
import { thb, useToast } from '../../pos/posUtils'
import { Toast } from '../../pos/posUi'
import { loadMenuGroupLinks } from '../menuLinks'
import { errorText, useBranchScope } from '../useBranchScope'
import MenuEditor from './MenuEditor'
import '../../pos/pos.css'

// หน้าจัดการเมนู (หลังร้าน) — 1.14, 1.15, 1.18
// ซ้าย: ตารางเมนู · ขวา: แผงแก้ไข/เพิ่มเมนู
// manager: เมนูของสาขาตัวเอง · owner: เลือกสาขาได้ และคัดลอกเมนูข้ามสาขาได้

const ALL = ''

export default function MenusPage() {
  const scope = useBranchScope()
  const { branchId, branches, isOwner, canManage, branchName } = scope
  const [categories, setCategories] = useState([])
  const [menus, setMenus] = useState([])
  const [groups, setGroups] = useState([])
  const [links, setLinks] = useState(new Map())
  const [categoryId, setCategoryId] = useState(ALL)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // menu id | 'new' | null
  const [busyId, setBusyId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  useEffect(() => {
    let cancelled = false
    listCategories()
      .then((rows) => !cancelled && setCategories((rows || []).filter((c) => c.is_active !== false)))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // เมนู + กลุ่มตัวเลือกของสาขา แล้วค่อยโหลดว่าเมนูไหนผูกกลุ่มไหน (ช้ากว่า แสดงตารางก่อน)
  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    Promise.all([listMenus({ branch_id: branchId }), listOptionGroups({ branch_id: branchId })])
      .then(([menuRows, groupRows]) => {
        if (cancelled) return
        setMenus(menuRows || [])
        setGroups(groupRows || [])
        setError('')
        setLoading(false)
        return loadMenuGroupLinks(menuRows || []).then((map) => !cancelled && setLinks(map))
      })
      .catch((err) => {
        if (cancelled) return
        setError(errorText(err))
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [branchId, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menus.filter((m) => (!categoryId || m.category_id === categoryId) && (!q || m.name.toLowerCase().includes(q)))
  }, [menus, categoryId, search])

  const usedCategories = useMemo(() => categories.filter((c) => menus.some((m) => m.category_id === c.id)), [categories, menus])
  const current = selected === 'new' ? null : menus.find((m) => m.id === selected) || null

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
      if (selected === menu.id) setSelected(null)
      notify(`ลบ ${menu.name} แล้ว`)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function copy(menu, toBranchId) {
    try {
      await copyMenu(menu.id, toBranchId)
      notify(`คัดลอก ${menu.name} ไป ${branchName(toBranchId)} แล้ว (สต็อก 0 ปิดขายไว้ก่อน)`)
    } catch (err) {
      notify(errorText(err), 'error')
    }
  }

  function onSaved(menu, isNew) {
    notify(isNew ? `เพิ่ม ${menu.name} แล้ว (สต็อก 0 ปิดขายไว้ก่อน)` : `บันทึก ${menu.name} แล้ว`)
    setSelected(menu.id)
    reload()
  }

  if (scope.me && !canManage) {
    return (
      <div className="pos-page">
        <div className="pos-empty">หน้านี้สำหรับผู้จัดการและเจ้าของร้านเท่านั้น</div>
      </div>
    )
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">จัดการเมนู</h1>
          <p className="pos-subtitle">
            เพิ่ม แก้ไข ลบ เมนู พร้อมหมวดหมู่ ราคา และรูป (1.14){!isOwner && branchName(branchId) ? ` · สาขา${branchName(branchId)}` : ''}
          </p>
        </div>
        {isOwner && (
          <select
            className="pos-input pos-select-sm"
            value={branchId}
            onChange={(e) => {
              setLoading(true)
              setSelected(null)
              scope.setBranchId(e.target.value)
            }}
            aria-label="สาขา"
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        )}
      </header>

      {(error || scope.error) && (
        <div className="pos-alert">
          {error || scope.error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-bo-layout">
        <section aria-label="รายการเมนู" style={{ minWidth: 0 }}>
          <div className="pos-menu-toolbar">
            <div className="pos-chips" style={{ alignItems: 'center' }}>
              <input className="pos-search" type="search" placeholder="ค้นหาเมนู" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหาเมนู" />
              <button type="button" className={`pos-chip ${!categoryId ? 'is-active' : ''}`} onClick={() => setCategoryId(ALL)}>
                ทั้งหมด
              </button>
              {usedCategories.map((c) => (
                <button key={c.id} type="button" className={`pos-chip ${categoryId === c.id ? 'is-active' : ''}`} onClick={() => setCategoryId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
            <button type="button" className="pos-btn pos-btn-primary" onClick={() => setSelected('new')} disabled={!branchId}>
              + เพิ่มเมนู
            </button>
          </div>

          {loading ? (
            <div className="pos-skeleton" />
          ) : shown.length === 0 ? (
            <div className="pos-empty">{menus.length ? 'ไม่พบเมนูที่ค้นหา' : 'ยังไม่มีเมนูในสาขานี้ กด “+ เพิ่มเมนู” เพื่อเริ่ม'}</div>
          ) : (
            <div className="pos-rtable-wrap" style={{ background: 'var(--app-card)' }}>
              <table className="pos-rtable pos-avail-table">
                <thead>
                  <tr>
                    <th aria-label="รูป" />
                    <th>เมนู</th>
                    <th>หมวด</th>
                    <th className="is-num">ราคา</th>
                    <th>ตัวเลือกเสริม</th>
                    <th className="is-center">ขาย</th>
                    <th aria-label="จัดการ" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((m) => {
                    const empty = Number(m.quantity) <= 0
                    const linked = links.get(m.id)
                    return (
                      <tr key={m.id} className={selected === m.id ? 'is-selected' : ''}>
                        <td style={{ width: 56 }}>
                          <div className="pos-thumb-sm">{m.image_url ? <img src={m.image_url} alt="" loading="lazy" /> : <span aria-hidden="true">▧</span>}</div>
                        </td>
                        <td>
                          <button type="button" className="pos-row-link" onClick={() => setSelected(m.id)}>
                            {m.name}
                          </button>
                        </td>
                        <td className="pos-muted">{m.category_name}</td>
                        <td className="is-num">{thb(m.price)}</td>
                        <td className="pos-muted pos-small">{linked ? linked.map((g) => g.name).join(', ') || '-' : '…'}</td>
                        <td className="is-center">
                          <label className="pos-switch" title={empty ? 'สต็อกเป็น 0 ต้องเติมสต็อกก่อนเปิดขาย' : ''}>
                            <input
                              type="checkbox"
                              aria-label={`เปิดขาย ${m.name}`}
                              checked={m.is_available && !empty}
                              disabled={busyId === m.id || empty}
                              onChange={() => toggleAvailable(m)}
                            />
                            <span />
                          </label>
                        </td>
                        <td className="pos-row-actions">
                          <button type="button" className="pos-link-btn" onClick={() => setSelected(m.id)}>
                            แก้ไข
                          </button>
                          <button type="button" className="pos-link-btn is-danger" onClick={() => remove(m)} disabled={busyId === m.id}>
                            ลบ
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <aside className="pos-panel pos-side-panel" aria-label="แก้ไขเมนู">
          {selected ? (
            <MenuEditor
              key={`${selected}:${reloadKey}`}
              menu={current}
              branchId={branchId}
              branchName={branchName(branchId)}
              isOwner={isOwner}
              branches={branches}
              categories={categories}
              groups={groups.filter((g) => g.is_active !== false)}
              linkedIds={current ? (links.get(current.id) || []).map((g) => g.id) : []}
              linksReady={!current || links.has(current.id)}
              busy={busyId === current?.id}
              onSaved={onSaved}
              onDelete={() => current && remove(current)}
              onToggle={() => current && toggleAvailable(current)}
              onCopy={(toBranchId) => current && copy(current, toBranchId)}
              onCancel={() => setSelected(null)}
            />
          ) : (
            <div className="pos-cart-empty">เลือกเมนูในตารางเพื่อแก้ไข หรือกด “+ เพิ่มเมนู”</div>
          )}
        </aside>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
