import { useState } from 'react'
import { createMenu, readImageFile, updateMenu } from '../../../api/catalog'
import { saveMenuGroups } from '../menuLinks'
import { errorText } from '../useBranchScope'

// แผงเพิ่ม/แก้ไขเมนู: รูป ชื่อ หมวด ราคา รายละเอียด กลุ่มตัวเลือกที่ผูก เปิดขาย (1.14, 1.15, 1.18)
// ราคาเมนูเป็นราคาก่อน VAT ตาม spec 1.24 (VAT 7% บวกตอนคิดเงิน)

const MAX_IMAGE = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

function ImageIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.6" />
      <path d="m21 16-5-5-9 9" />
    </svg>
  )
}

export default function MenuEditor({
  menu,
  branchId,
  branchName,
  isOwner,
  branches,
  categories,
  groups,
  linkedIds,
  linksReady,
  busy,
  onSaved,
  onDelete,
  onToggle,
  onCopy,
  onCancel,
}) {
  const isNew = !menu
  const [form, setForm] = useState({
    name: menu?.name ?? '',
    category_id: menu?.category_id ?? categories[0]?.id ?? '',
    price: menu?.price ?? '',
    description: menu?.description ?? '',
  })
  const [image, setImage] = useState(null) // { data, content_type } รูปใหม่
  const [preview, setPreview] = useState(menu?.image_url ?? '')
  const [removeImage, setRemoveImage] = useState(false)
  const [selected, setSelected] = useState(null) // null = ยังไม่แตะ → ใช้ linkedIds
  const [adding, setAdding] = useState(false)
  const [copyTo, setCopyTo] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const groupIds = selected ?? linkedIds
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const groupName = (id) => groups.find((g) => g.id === id)?.name || 'กลุ่มที่ปิดใช้'
  const available = groups.filter((g) => !groupIds.includes(g.id))
  const empty = menu && Number(menu.quantity) <= 0

  async function pickImage(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!IMAGE_TYPES.includes(file.type)) return setError('รองรับเฉพาะรูป JPG, PNG, WEBP')
    if (file.size > MAX_IMAGE) return setError('รูปต้องไม่เกิน 2MB')
    const img = await readImageFile(file)
    setImage(img)
    setPreview(img.data)
    setRemoveImage(false)
    setError('')
  }

  async function submit(e) {
    e.preventDefault()
    const price = Number(form.price)
    if (!form.name.trim()) return setError('กรุณากรอกชื่อเมนู')
    if (!form.category_id) return setError('กรุณาเลือกหมวดหมู่')
    if (form.price === '' || Number.isNaN(price) || price < 0) return setError('ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')

    const body = { name: form.name.trim(), category_id: form.category_id, price, description: form.description.trim() || null }
    if (image) body.image = image
    else if (removeImage) body.image_url = null

    setSaving(true)
    setError('')
    try {
      const saved = isNew ? await createMenu({ ...body, ...(isOwner ? { branch_id: branchId } : {}) }) : await updateMenu(menu.id, body)
      const changed = groupIds.length !== linkedIds.length || groupIds.some((id, i) => id !== linkedIds[i])
      if (changed) await saveMenuGroups(saved.id, groupIds)
      onSaved(saved, isNew)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <form className="pos-editor" onSubmit={submit}>
      <h2 className="pos-panel-title">{isNew ? 'เพิ่มเมนู' : 'แก้ไขเมนู'}</h2>
      {isNew && <p className="pos-dialog-sub" style={{ marginTop: -6, marginBottom: 10 }}>สาขา{branchName} · เมนูใหม่เริ่มที่สต็อก 0 และปิดขายไว้ก่อน</p>}

      <label className={`pos-upload ${preview ? 'has-image' : ''}`}>
        {preview ? (
          <img src={preview} alt="" />
        ) : (
          <>
            <ImageIcon />
            <span>อัปโหลดรูปเมนู (JPG / PNG ไม่เกิน 2MB)</span>
          </>
        )}
        <input type="file" accept={IMAGE_TYPES.join(',')} onChange={pickImage} disabled={saving} />
      </label>
      {preview && (
        <button
          type="button"
          className="pos-link"
          style={{ fontSize: 13, marginTop: 6 }}
          onClick={() => {
            setImage(null)
            setPreview('')
            setRemoveImage(true)
          }}
        >
          เอารูปออก
        </button>
      )}

      <label className="pos-field">
        <span>ชื่อเมนู</span>
        <input className="pos-input" value={form.name} onChange={set('name')} maxLength={100} autoFocus={isNew} />
      </label>
      <label className="pos-field">
        <span>หมวดหมู่</span>
        <select className="pos-input" value={form.category_id} onChange={set('category_id')}>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="pos-field">
        <span>ราคา (บาท, ก่อน VAT)</span>
        <input className="pos-input" type="number" min="0" step="0.01" inputMode="decimal" value={form.price} onChange={set('price')} />
      </label>
      <label className="pos-field">
        <span>รายละเอียด (ไม่บังคับ)</span>
        <textarea className="pos-input" rows={2} value={form.description} onChange={set('description')} maxLength={500} />
      </label>

      <div className="pos-field">
        <span>กลุ่มตัวเลือกเสริมที่ผูกไว้</span>
        {!linksReady ? (
          <span className="pos-muted pos-small">กำลังโหลด…</span>
        ) : (
          <div className="pos-chips" style={{ alignItems: 'center' }}>
            {groupIds.map((id) => (
              <span key={id} className="pos-tag">
                {groupName(id)}
                <button type="button" aria-label={`เอา ${groupName(id)} ออก`} onClick={() => setSelected(groupIds.filter((x) => x !== id))}>
                  ×
                </button>
              </span>
            ))}
            {adding ? (
              <select
                className="pos-input pos-select-sm"
                autoFocus
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) setSelected([...groupIds, e.target.value])
                  setAdding(false)
                }}
                onBlur={() => setAdding(false)}
                aria-label="เลือกกลุ่มที่จะผูก"
              >
                <option value="">เลือกกลุ่ม…</option>
                {available.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            ) : (
              available.length > 0 && (
                <button type="button" className="pos-link-btn" onClick={() => setAdding(true)}>
                  + ผูกกลุ่ม
                </button>
              )
            )}
            {groupIds.length === 0 && !adding && available.length === 0 && <span className="pos-muted pos-small">สาขานี้ยังไม่มีกลุ่มตัวเลือก</span>}
          </div>
        )}
      </div>

      {!isNew && (
        <div className="pos-field-row" style={{ margin: '4px 0 0' }}>
          <span className="pos-muted">เปิดขาย{empty ? ' (สต็อก 0 ต้องเติมก่อน)' : ''}</span>
          <label className="pos-switch">
            <input type="checkbox" aria-label="เปิดขาย" checked={menu.is_available && !empty} disabled={busy || empty} onChange={onToggle} />
            <span />
          </label>
        </div>
      )}

      {!isNew && isOwner && branches.length > 1 && (
        <div className="pos-field">
          <span>คัดลอกไปสาขาอื่น (สต็อก 0 ปิดขายไว้ก่อน)</span>
          <div className="pos-chips">
            <select className="pos-input pos-select-sm" value={copyTo} onChange={(e) => setCopyTo(e.target.value)} aria-label="สาขาปลายทาง">
              <option value="">เลือกสาขา…</option>
              {branches
                .filter((b) => b.id !== menu.branch_id)
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </select>
            <button type="button" className="pos-btn" disabled={!copyTo} onClick={() => onCopy(copyTo)}>
              คัดลอก
            </button>
          </div>
        </div>
      )}

      {error && <p className="pos-error">{error}</p>}

      <div className="pos-side-actions">
        {isNew ? (
          <button type="button" className="pos-btn" onClick={onCancel} disabled={saving}>
            ยกเลิก
          </button>
        ) : (
          <button type="button" className="pos-btn pos-btn-danger-solid" onClick={onDelete} disabled={saving || busy}>
            ลบเมนู
          </button>
        )}
        <button className="pos-btn pos-btn-primary" disabled={saving || !linksReady}>
          {saving ? 'กำลังบันทึก…' : 'บันทึก'}
        </button>
      </div>
    </form>
  )
}
