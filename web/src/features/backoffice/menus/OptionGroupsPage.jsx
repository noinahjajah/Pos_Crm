import { useCallback, useEffect, useState } from 'react'
import { useBranchScope, useNotify } from '../useBranchScope'
import {
  createOption,
  createOptionGroup,
  listOptionGroups,
  updateOption,
  updateOptionGroup,
} from '../../../api/catalog'
import './menus.css'
import './option-groups.css'
import { errorText } from '../../../lib/format.js'

// หน้าจัดการกลุ่มตัวเลือก (หลังร้าน) — 1.16, 1.17
// กลุ่มตัวเลือกเป็นของแต่ละสาขา เช่น "ระดับความเผ็ด" (เลือกได้ 1) หรือ "ท็อปปิ้ง" (เลือกได้หลายอย่าง)
// manager: สาขาตัวเอง · owner: เลือกสาขาได้ · ปิดใช้แทนการลบ

const price = (n) => (Number(n) > 0 ? `+${Number(n).toLocaleString('th-TH')} บาท` : 'ไม่บวกเพิ่ม')

export default function OptionGroupsPage() {
  const { me, branches, branchId, setBranchId, isOwner, canManage } = useBranchScope()
  const notify = useNotify()
  const [groups, setGroups] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [groupDialog, setGroupDialog] = useState(null) // null = ปิด, {} = เพิ่ม, group = แก้ไข
  const [optionDialog, setOptionDialog] = useState(null) // { group, option? }
  const [busyId, setBusyId] = useState(null)

  // โหลดกลุ่มตัวเลือกของสาขา (รวมที่ปิดใช้)
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    if (!branchId) return
    let cancelled = false
    listOptionGroups({ branch_id: branchId, include_inactive: true })
      .then((rows) => {
        if (cancelled) return
        setGroups(rows)
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [branchId, reloadKey])

  const reload = useCallback(() => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }, [])

  function changeBranch(id) {
    setLoading(true)
    setBranchId(id)
  }

  const branchName = (id) => branches.find((b) => b.id === id)?.name || ''

  async function toggleGroup(group) {
    setBusyId(group.id)
    try {
      await updateOptionGroup(group.id, { is_active: !group.is_active })
      notify(group.is_active ? `ปิดใช้ ${group.name} แล้ว (เมนูที่ผูกไว้จะไม่แสดงกลุ่มนี้)` : `เปิดใช้ ${group.name} แล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function toggleOption(option) {
    setBusyId(option.id)
    try {
      await updateOption(option.id, { is_active: !option.is_active })
      setGroups((list) =>
        list.map((g) => ({
          ...g,
          options: g.options.map((o) => (o.id === option.id ? { ...o, is_active: !o.is_active } : o)),
        })),
      )
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyId(null)
    }
  }

  function onSaved(message) {
    setGroupDialog(null)
    setOptionDialog(null)
    notify(message)
    reload()
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
          <h1 className="mm-title">กลุ่มตัวเลือก</h1>
          <p className="mm-subtitle">
            เช่น ระดับความเผ็ด ความหวาน ท็อปปิ้ง · {isOwner ? 'แต่ละสาขาแยกกัน' : `สาขา ${branchName(branchId)}`}
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
          <button className="mm-btn mm-btn-primary" onClick={() => setGroupDialog({})} disabled={!branchId}>
            + เพิ่มกลุ่ม
          </button>
        </div>
      </header>

      {error && (
        <div className="mm-alert">
          {error}
          <button className="mm-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      {loading ? (
        <div className="og-list">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="mm-card mm-skeleton og-skeleton" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="mm-empty">ยังไม่มีกลุ่มตัวเลือกในสาขานี้ กด “+ เพิ่มกลุ่ม” เพื่อเริ่ม</div>
      ) : (
        <div className="og-list">
          {groups.map((g) => (
            <section key={g.id} className={`og-card ${g.is_active ? '' : 'is-off'}`}>
              <header className="og-card-head">
                <div>
                  <h3 className="og-name">
                    {g.name}
                    {!g.is_active && <span className="og-tag">ปิดใช้</span>}
                  </h3>
                  <p className="og-rule">
                    <span className={`og-pill ${g.is_required ? 'is-required' : ''}`}>
                      {g.is_required ? 'ต้องเลือก' : 'ไม่บังคับ'}
                    </span>
                    <span className="og-pill">{g.max_select === 1 ? 'เลือกได้ 1 อย่าง' : `เลือกได้ไม่เกิน ${g.max_select}`}</span>
                  </p>
                </div>
                <div className="mm-action-btns">
                  <button className="mm-btn" onClick={() => setGroupDialog(g)} disabled={busyId === g.id}>
                    แก้ไข
                  </button>
                  <button className="mm-btn" onClick={() => toggleGroup(g)} disabled={busyId === g.id}>
                    {g.is_active ? 'ปิดใช้' : 'เปิดใช้'}
                  </button>
                </div>
              </header>

              <ul className="og-options">
                {g.options.length === 0 && <li className="og-option og-option-empty">ยังไม่มีตัวเลือก</li>}
                {g.options.map((o) => (
                  <li key={o.id} className={`og-option ${o.is_active ? '' : 'is-off'}`}>
                    <label className="mm-switch" title={o.is_active ? 'ปิดตัวเลือกนี้' : 'เปิดตัวเลือกนี้'}>
                      <input
                        type="checkbox"
                        checked={o.is_active}
                        disabled={busyId === o.id}
                        onChange={() => toggleOption(o)}
                      />
                      <span />
                    </label>
                    <span className="og-option-name">{o.name}</span>
                    <span className="og-option-price">{price(o.extra_price)}</span>
                    <button className="mm-link" onClick={() => setOptionDialog({ group: g, option: o })}>
                      แก้ไข
                    </button>
                  </li>
                ))}
              </ul>

              <button className="og-add" onClick={() => setOptionDialog({ group: g })}>
                + เพิ่มตัวเลือก
              </button>
            </section>
          ))}
        </div>
      )}

      {groupDialog && (
        <GroupDialog
          group={groupDialog.id ? groupDialog : null}
          branchId={branchId}
          branchName={branchName(branchId)}
          isOwner={isOwner}
          onClose={() => setGroupDialog(null)}
          onSaved={onSaved}
        />
      )}

      {optionDialog && (
        <OptionDialog
          group={optionDialog.group}
          option={optionDialog.option}
          onClose={() => setOptionDialog(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  )
}

/** เพิ่ม/แก้ไขกลุ่มตัวเลือก (ตอนเพิ่มใส่ตัวเลือกพร้อมกันได้) */
function GroupDialog({ group, branchId, branchName, isOwner, onClose, onSaved }) {
  const isNew = !group
  const [name, setName] = useState(group?.name ?? '')
  const [isRequired, setIsRequired] = useState(group?.is_required ?? false)
  const [maxSelect, setMaxSelect] = useState(group?.max_select ?? 1)
  const [options, setOptions] = useState([{ name: '', extra_price: '' }])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const setOptionField = (i, key) => (e) =>
    setOptions((list) => list.map((o, idx) => (idx === i ? { ...o, [key]: e.target.value } : o)))

  async function submit(e) {
    e.preventDefault()
    const max = Number(maxSelect)
    if (!name.trim()) return setError('กรุณากรอกชื่อกลุ่ม')
    if (!Number.isInteger(max) || max < 1 || max > 20) return setError('จำนวนที่เลือกได้ต้องเป็น 1–20')

    const body = { name: name.trim(), is_required: isRequired, max_select: max }
    if (isNew) {
      const filled = options.filter((o) => o.name.trim())
      if (filled.some((o) => o.extra_price !== '' && (Number.isNaN(Number(o.extra_price)) || Number(o.extra_price) < 0))) {
        return setError('ราคาบวกเพิ่มต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')
      }
      body.options = filled.map((o) => ({ name: o.name.trim(), extra_price: Number(o.extra_price || 0) }))
      if (isOwner) body.branch_id = branchId
    }

    setSaving(true)
    setError('')
    try {
      if (isNew) await createOptionGroup(body)
      else await updateOptionGroup(group.id, body)
      onSaved(isNew ? `เพิ่มกลุ่ม ${body.name} แล้ว` : `บันทึก ${body.name} แล้ว`)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog mm-dialog-md" onSubmit={submit}>
        <h2 className="mm-dialog-title">{isNew ? 'เพิ่มกลุ่มตัวเลือก' : `แก้ไข ${group.name}`}</h2>
        <p className="mm-hint">สาขา {branchName}</p>

        <div className="mm-fields">
          <label className="mm-field">
            <span>ชื่อกลุ่ม *</span>
            <input
              className="mm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ระดับความเผ็ด"
              maxLength={100}
              autoFocus
            />
          </label>
          <div className="mm-two">
            <label className="mm-field">
              <span>เลือกได้สูงสุด (อย่าง)</span>
              <input
                className="mm-input"
                type="number"
                min="1"
                max="20"
                value={maxSelect}
                onChange={(e) => setMaxSelect(e.target.value)}
              />
            </label>
            <label className="og-check">
              <input type="checkbox" checked={isRequired} onChange={(e) => setIsRequired(e.target.checked)} />
              <span>
                ลูกค้าต้องเลือก
                <small>ไม่เลือกจะสั่งเมนูนี้ไม่ได้</small>
              </span>
            </label>
          </div>
        </div>

        {isNew && (
          <fieldset className="mm-groups">
            <legend>ตัวเลือก</legend>
            {options.map((o, i) => (
              <div key={i} className="og-row">
                <input
                  className="mm-input"
                  placeholder={`ตัวเลือกที่ ${i + 1} เช่น เผ็ดน้อย`}
                  value={o.name}
                  onChange={setOptionField(i, 'name')}
                  maxLength={100}
                />
                <input
                  className="mm-input og-row-price"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="+ บาท"
                  value={o.extra_price}
                  onChange={setOptionField(i, 'extra_price')}
                />
                <button
                  type="button"
                  className="mm-btn"
                  onClick={() => setOptions((list) => list.filter((_, idx) => idx !== i))}
                  disabled={options.length === 1}
                  aria-label="ลบแถวนี้"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="og-add og-add-inline"
              onClick={() => setOptions((list) => [...list, { name: '', extra_price: '' }])}
            >
              + เพิ่มแถว
            </button>
          </fieldset>
        )}

        {error && <div className="mm-alert og-dialog-alert">{error}</div>}

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

/** เพิ่ม/แก้ไขตัวเลือก 1 ตัว */
function OptionDialog({ group, option, onClose, onSaved }) {
  const isNew = !option
  const [name, setName] = useState(option?.name ?? '')
  const [extra, setExtra] = useState(option?.extra_price ?? '')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    const extraPrice = Number(extra || 0)
    if (!name.trim()) return setError('กรุณากรอกชื่อตัวเลือก')
    if (Number.isNaN(extraPrice) || extraPrice < 0) return setError('ราคาบวกเพิ่มต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')

    const body = { name: name.trim(), extra_price: extraPrice }
    setSaving(true)
    setError('')
    try {
      if (isNew) await createOption(group.id, body)
      else await updateOption(option.id, body)
      onSaved(isNew ? `เพิ่ม ${body.name} ใน ${group.name} แล้ว` : `บันทึก ${body.name} แล้ว`)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog mm-dialog-sm" onSubmit={submit}>
        <h2 className="mm-dialog-title">{isNew ? 'เพิ่มตัวเลือก' : `แก้ไข ${option.name}`}</h2>
        <p className="mm-hint">กลุ่ม {group.name}</p>
        <div className="mm-fields">
          <label className="mm-field">
            <span>ชื่อตัวเลือก *</span>
            <input className="mm-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} autoFocus />
          </label>
          <label className="mm-field">
            <span>ราคาบวกเพิ่ม (บาท)</span>
            <input
              className="mm-input"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={extra}
              onChange={(e) => setExtra(e.target.value)}
            />
          </label>
        </div>
        {error && <div className="mm-alert og-dialog-alert">{error}</div>}
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
