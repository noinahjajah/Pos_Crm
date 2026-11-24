import { useCallback, useEffect, useMemo, useState } from 'react'
import { createOption, createOptionGroup, listMenus, listOptionGroups, updateOption, updateOptionGroup } from '../../../api/catalog'
import { useToast } from '../../../lib/posUtils'
import { Toast } from '../../../components/ui/posUi'
import MenuPickerDialog from './MenuPickerDialog'
import { loadMenuGroupLinks, saveMenuGroups } from '../menuLinks'
import { errorText, useBranchScope } from '../useBranchScope'
import '../../../styles/pos.css'

// หน้ากลุ่มตัวเลือกเสริม (หลังร้าน) — 1.16–1.18
// ซ้าย: กลุ่มทั้งหมด · กลาง: แก้ชื่อ รูปแบบการเลือก ตัวเลือกและราคาบวกเพิ่ม · ขวา: ผูกกับเมนู
// กลุ่ม/ตัวเลือกปิดใช้แทนการลบ (บิลเก่ายังอ้างถึงได้)

export default function OptionGroupsPage() {
  const scope = useBranchScope()
  const { branchId, branches, isOwner, canManage, branchName } = scope
  const [groups, setGroups] = useState([])
  const [menus, setMenus] = useState([])
  const [links, setLinks] = useState(null) // Map(menuId → [{id,name}]) · null = กำลังโหลด
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null) // group id | 'new'
  const [reloadKey, setReloadKey] = useState(0)
  const [resetKey, setResetKey] = useState(0) // เปลี่ยน = ล้างฟอร์มแก้ไข (ยกเลิก)
  const [toast, notify] = useToast()

  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    Promise.all([listOptionGroups({ branch_id: branchId, include_inactive: true }), listMenus({ branch_id: branchId })])
      .then(([groupRows, menuRows]) => {
        if (cancelled) return
        setGroups(groupRows || [])
        setMenus(menuRows || [])
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

  /** จำนวนเมนูที่ผูกกับแต่ละกลุ่ม */
  const menuCount = useMemo(() => {
    const count = new Map()
    for (const list of links?.values() || []) for (const g of list) count.set(g.id, (count.get(g.id) || 0) + 1)
    return count
  }, [links])

  // กลุ่มที่กำลังแก้: ที่เลือกไว้ หรือกลุ่มแรกถ้ายังไม่ได้เลือก
  const editing = selected === 'new' ? null : groups.find((g) => g.id === selected) || groups[0] || null

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
          <h1 className="pos-title">กลุ่มตัวเลือกเสริม</h1>
          <p className="pos-subtitle">
            สร้างกลุ่มเอง กำหนดเลือก 1 หรือหลายอย่าง และราคาบวกเพิ่ม{!isOwner && branchName(branchId) ? ` · สาขา${branchName(branchId)}` : ''}
          </p>
        </div>
        {isOwner && (
          <select
            className="pos-input pos-select-sm"
            value={branchId}
            onChange={(e) => {
              setLoading(true)
              setSelected(null)
              setLinks(null)
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

      <div className="pos-og-layout">
        {/* ---------- กลุ่มทั้งหมด ---------- */}
        <section className="pos-panel pos-col-panel" aria-label="กลุ่มทั้งหมด">
          <h2 className="pos-panel-title">กลุ่มทั้งหมด</h2>
          {loading ? (
            <div className="pos-skeleton" style={{ height: 200 }} />
          ) : groups.length === 0 ? (
            <div className="pos-cart-empty">ยังไม่มีกลุ่มตัวเลือก</div>
          ) : (
            <div className="pos-bill-list">
              {groups.map((g) => {
                const active = g.options.filter((o) => o.is_active).length
                const count = menuCount.get(g.id)
                return (
                  <button
                    key={g.id}
                    type="button"
                    className={`pos-bill-card is-col ${editing?.id === g.id && selected !== 'new' ? 'is-active' : ''} ${g.is_active ? '' : 'is-off'}`}
                    onClick={() => setSelected(g.id)}
                  >
                    <span className="pos-bill-card-row">
                      <strong>{g.name}</strong>
                      <span className={`pos-pill ${g.is_active ? (g.max_select === 1 ? 'is-muted' : 'is-available') : 'is-waiting'}`}>
                        {!g.is_active ? 'ปิดใช้' : g.max_select === 1 ? 'เลือก 1 อย่าง' : 'หลายอย่าง'}
                      </span>
                    </span>
                    <span className="pos-line-sub">
                      {active} ตัวเลือก · {links ? `${count || 0} เมนู` : '… เมนู'}
                      {g.is_required ? ' · บังคับเลือก' : ''}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          <button type="button" className="pos-btn pos-btn-block" style={{ marginTop: 'auto' }} onClick={() => setSelected('new')} disabled={!branchId}>
            + สร้างกลุ่มใหม่
          </button>
        </section>

        {/* ---------- แก้ไข + ผูกเมนู ---------- */}
        {loading ? (
          <section className="pos-panel" style={{ gridColumn: 'span 2' }}>
            <div className="pos-skeleton" />
          </section>
        ) : selected === 'new' || editing ? (
          <GroupEditor
            key={`${selected === 'new' ? 'new' : editing.id}:${resetKey}`}
            group={selected === 'new' ? null : editing}
            branchId={branchId}
            isOwner={isOwner}
            menus={menus}
            links={links}
            onCancel={() => {
              if (selected === 'new') setSelected(null)
              setResetKey((k) => k + 1)
            }}
            onSaved={(message, id) => {
              notify(message)
              setSelected(id)
              setLinks(null)
              setLoading(true) // ซ่อนฟอร์มจนโหลดกลุ่มใหม่เสร็จ ฟอร์มใหม่จะได้ id ตัวเลือกล่าสุด
              setResetKey((k) => k + 1)
              reload()
            }}
            onError={(message) => notify(message, 'error')}
          />
        ) : (
          <section className="pos-panel" style={{ gridColumn: 'span 2' }}>
            <div className="pos-cart-empty">กด “+ สร้างกลุ่มใหม่” เพื่อเริ่ม เช่น ระดับความเผ็ด ท็อปปิ้ง</div>
          </section>
        )}
      </div>

      <Toast toast={toast} />
    </div>
  )
}

/** แก้ไขกลุ่ม (คอลัมน์กลาง) + ผูกกับเมนู (คอลัมน์ขวา) — state ร่วมกัน บันทึกครั้งเดียว */
function GroupEditor({ group, branchId, isOwner, menus, links, onCancel, onSaved, onError }) {
  const isNew = !group
  const initialRows = (group?.options || []).filter((o) => o.is_active).map((o) => ({ ...o, key: o.id, extra_price: String(o.extra_price) }))
  const [name, setName] = useState(group?.name ?? '')
  const [multi, setMulti] = useState((group?.max_select ?? 1) > 1)
  const [maxSelect, setMaxSelect] = useState(group?.max_select > 1 ? group.max_select : Math.max(2, initialRows.length))
  const [required, setRequired] = useState(group?.is_required ?? false)
  const [rows, setRows] = useState(initialRows.length ? initialRows : [{ key: 'n0', name: '', extra_price: '' }])
  const [removed, setRemoved] = useState([]) // id ตัวเลือกเดิมที่กดลบ (จะปิดใช้)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState(null) // Set ของ menu id · null = ยังไม่แตะ
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const linkedNow = useMemo(() => {
    const s = new Set()
    if (!links || !group) return s
    for (const [menuId, list] of links) if (list.some((g) => g.id === group.id)) s.add(menuId)
    return s
  }, [links, group])
  const chosen = picked ?? linkedNow

  const setRow = (key, field) => (e) => setRows((list) => list.map((r) => (r.key === key ? { ...r, [field]: e.target.value } : r)))
  function removeRow(r) {
    setRows((list) => list.filter((x) => x.key !== r.key))
    if (r.id) setRemoved((ids) => [...ids, r.id])
  }
  async function save() {
    const filled = rows.filter((r) => r.name.trim())
    if (!name.trim()) return setError('กรุณากรอกชื่อกลุ่ม')
    if (filled.length === 0) return setError('ต้องมีตัวเลือกอย่างน้อย 1 อย่าง')
    if (filled.some((r) => r.extra_price !== '' && !(Number(r.extra_price) >= 0))) return setError('ราคาบวกเพิ่มต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
    const max = multi ? Number(maxSelect) : 1
    if (multi && (!Number.isInteger(max) || max < 2 || max > 20)) return setError('เลือกได้หลายอย่าง: จำนวนสูงสุดต้องเป็น 2–20')

    setSaving(true)
    setError('')
    try {
      const base = { name: name.trim(), is_required: required, max_select: max }
      let groupId = group?.id
      if (isNew) {
        const created = await createOptionGroup({
          ...base,
          ...(isOwner ? { branch_id: branchId } : {}),
          options: filled.map((r) => ({ name: r.name.trim(), extra_price: Number(r.extra_price || 0) })),
        })
        groupId = created.id
      } else {
        if (base.name !== group.name || base.is_required !== group.is_required || base.max_select !== group.max_select) {
          await updateOptionGroup(group.id, base)
        }
        for (const r of filled) {
          const body = { name: r.name.trim(), extra_price: Number(r.extra_price || 0) }
          if (!r.id) await createOption(group.id, body)
          else {
            const before = group.options.find((o) => o.id === r.id)
            if (before.name !== body.name || Number(before.extra_price) !== body.extra_price) await updateOption(r.id, body)
          }
        }
        // ลบ = ปิดใช้ (แถวที่ลบ + แถวเดิมที่ล้างชื่อทิ้ง)
        const blanked = rows.filter((r) => r.id && !r.name.trim()).map((r) => r.id)
        for (const id of [...removed, ...blanked]) await updateOption(id, { is_active: false })
      }

      // ผูกเมนู: แก้เฉพาะเมนูที่เปลี่ยน (PUT ทั้งชุดของเมนูนั้น)
      if (picked && links) {
        for (const m of menus) {
          const was = linkedNow.has(m.id)
          const now = picked.has(m.id)
          if (was === now) continue
          const ids = (links.get(m.id) || []).map((g) => g.id).filter((id) => id !== groupId)
          await saveMenuGroups(m.id, now ? [...ids, groupId] : ids)
        }
      }
      onSaved(isNew ? `สร้างกลุ่ม ${base.name} แล้ว` : `บันทึก ${base.name} แล้ว`, groupId)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  async function toggleActive() {
    setSaving(true)
    try {
      await updateOptionGroup(group.id, { is_active: !group.is_active })
      onSaved(group.is_active ? `ปิดใช้ ${group.name} แล้ว (เมนูที่ผูกไว้จะไม่แสดงกลุ่มนี้)` : `เปิดใช้ ${group.name} แล้ว`, group.id)
    } catch (err) {
      onError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <>
      <section className="pos-panel pos-col-panel" aria-label="แก้ไขกลุ่ม">
        <h2 className="pos-panel-title">{isNew ? 'สร้างกลุ่มใหม่' : `แก้ไขกลุ่ม: ${group.name}`}</h2>
        {!isNew && !group.is_active && <p className="pos-note is-warn">กลุ่มนี้ปิดใช้อยู่ ลูกค้าจะไม่เห็นตอนสั่ง</p>}

        <label className="pos-field">
          <span>ชื่อกลุ่ม</span>
          <input className="pos-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder="เช่น ระดับความเผ็ด" autoFocus={isNew} />
        </label>

        <div className="pos-field-row">
          <span className="pos-muted">รูปแบบการเลือก</span>
          <div className="pos-tabs" role="radiogroup" style={{ margin: 0 }}>
            <button type="button" role="radio" aria-checked={!multi} className={!multi ? 'is-active' : ''} onClick={() => setMulti(false)}>
              เลือกได้ 1 อย่าง
            </button>
            <button type="button" role="radio" aria-checked={multi} className={multi ? 'is-active' : ''} onClick={() => setMulti(true)}>
              เลือกได้หลายอย่าง
            </button>
          </div>
        </div>
        <div className="pos-field-row" style={{ marginTop: 0 }}>
          <label className="pos-check-label">
            <input type="checkbox" className="pos-check" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            ลูกค้าต้องเลือก (ไม่เลือกจะสั่งเมนูไม่ได้)
          </label>
          {multi && (
            <label className="pos-check-label">
              สูงสุด
              <input className="pos-input pos-input-xs" type="number" min="2" max="20" value={maxSelect} onChange={(e) => setMaxSelect(e.target.value)} aria-label="เลือกได้สูงสุด" />
              อย่าง
            </label>
          )}
        </div>

        <div className="pos-rtable-wrap">
          <table className="pos-rtable">
            <thead>
              <tr>
                <th>ตัวเลือก</th>
                <th style={{ width: 160 }}>ราคาบวกเพิ่ม</th>
                <th style={{ width: 48 }} aria-label="ลบ" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.key}>
                  <td>
                    <input className="pos-input pos-input-plain" value={r.name} onChange={setRow(r.key, 'name')} maxLength={100} placeholder={`ตัวเลือกที่ ${i + 1}`} aria-label={`ชื่อตัวเลือกที่ ${i + 1}`} />
                  </td>
                  <td>
                    <div className="pos-price-input">
                      <span>+</span>
                      <input type="number" min="0" step="0.01" inputMode="decimal" value={r.extra_price} onChange={setRow(r.key, 'extra_price')} placeholder="0" aria-label={`ราคาบวกเพิ่มของตัวเลือกที่ ${i + 1}`} />
                      <span>฿</span>
                    </div>
                  </td>
                  <td className="is-center">
                    <button type="button" className="pos-link-btn is-danger" onClick={() => removeRow(r)} disabled={rows.length === 1}>
                      ลบ
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="pos-link-btn" style={{ alignSelf: 'flex-start', marginTop: 10 }} onClick={() => setRows((list) => [...list, { key: `n${Date.now()}`, name: '', extra_price: '' }])}>
          + เพิ่มตัวเลือก
        </button>
        {removed.length > 0 && <p className="pos-muted pos-small">ตัวเลือกที่ลบจะถูกปิดใช้ บิลเก่ายังแสดงชื่อเดิมได้</p>}

        {error && <p className="pos-error">{error}</p>}

        <div className="pos-side-actions">
          {!isNew && (
            <button type="button" className="pos-btn" style={{ marginRight: 'auto' }} onClick={toggleActive} disabled={saving}>
              {group.is_active ? 'ปิดใช้กลุ่ม' : 'เปิดใช้กลุ่ม'}
            </button>
          )}
          <button type="button" className="pos-btn" onClick={onCancel} disabled={saving}>
            ยกเลิก
          </button>
          <button type="button" className="pos-btn pos-btn-primary" onClick={save} disabled={saving || (!links && !isNew)}>
            {saving ? 'กำลังบันทึก…' : 'บันทึกกลุ่ม'}
          </button>
        </div>
      </section>

      <section className="pos-panel pos-col-panel" aria-label="ผูกกับเมนู">
        <h2 className="pos-panel-title">ผูกกับเมนู</h2>
        {!links ? (
          <p className="pos-muted pos-small">กำลังโหลดว่าเมนูไหนผูกกลุ่มนี้…</p>
        ) : (
          <>
            <button type="button" className="pos-btn pos-btn-block" onClick={() => setPicking(true)} disabled={saving || menus.length === 0}>
              เลือกเมนู ({chosen.size}/{menus.length})
            </button>
            {chosen.size > 0 ? (
              <ul className="pos-chip-list" aria-label="เมนูที่ผูกแล้ว">
                {menus
                  .filter((m) => chosen.has(m.id))
                  .map((m) => (
                    <li key={m.id} className="pos-chip">
                      {m.name}
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="pos-muted pos-small">ยังไม่ได้ผูกกับเมนูไหน</p>
            )}
            <p className="pos-muted pos-small">กด “บันทึกกลุ่ม” เพื่อบันทึกการผูกเมนู</p>
          </>
        )}
      </section>

      {picking && (
        <MenuPickerDialog
          menus={menus}
          selected={chosen}
          groupName={name.trim() || group?.name}
          onClose={() => setPicking(false)}
          onApply={(next) => {
            setPicked(next)
            setPicking(false)
          }}
        />
      )}
    </>
  )
}
