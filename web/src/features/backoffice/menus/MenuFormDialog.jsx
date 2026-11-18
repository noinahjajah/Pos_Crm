import { useEffect, useState } from 'react'
import {
  createMenu,
  getMenu,
  listOptionGroups,
  readImageFile,
  setMenuOptionGroups,
  updateMenu,
} from '../../../api/catalog'
import { errorText } from '../../../lib/format.js'

// ฟอร์มเพิ่ม/แก้ไขเมนู: ชื่อ หมวด ราคา รายละเอียด รูป และกลุ่มตัวเลือกของสาขา (1.14, 1.18)


const MAX_IMAGE = 2 * 1024 * 1024
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export default function MenuFormDialog({ menu, branchId, branchName, isOwner, categories, onClose, onSaved }) {
  const isNew = !menu
  const [form, setForm] = useState({
    name: menu?.name ?? '',
    category_id: menu?.category_id ?? categories[0]?.id ?? '',
    price: menu?.price ?? '',
    description: menu?.description ?? '',
  })
  const [image, setImage] = useState(null) // { data, content_type } รูปใหม่ที่เลือก
  const [preview, setPreview] = useState(menu?.image_url ?? '')
  const [removeImage, setRemoveImage] = useState(false)
  const [groups, setGroups] = useState([]) // กลุ่มตัวเลือกทั้งหมดของสาขา
  const [selected, setSelected] = useState([]) // id ที่ผูกกับเมนู (เรียงตามลำดับ)
  const [initialSelected, setInitialSelected] = useState([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // โหลดกลุ่มตัวเลือกของสาขา + กลุ่มที่ผูกกับเมนูนี้อยู่
  useEffect(() => {
    let cancelled = false
    Promise.all([listOptionGroups({ branch_id: branchId }), menu ? getMenu(menu.id) : null])
      .then(([allGroups, detail]) => {
        if (cancelled) return
        setGroups(allGroups)
        const linked = detail?.option_groups?.map((g) => g.id) ?? []
        setSelected(linked)
        setInitialSelected(linked)
      })
      .catch((err) => !cancelled && setError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [branchId, menu])

  // ปิดด้วยปุ่ม Esc
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

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

  function clearImage() {
    setImage(null)
    setPreview('')
    setRemoveImage(true)
  }

  function toggleGroup(id) {
    setSelected((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]))
  }

  async function submit(e) {
    e.preventDefault()
    const price = Number(form.price)
    if (!form.name.trim()) return setError('กรุณากรอกชื่อเมนู')
    if (!form.category_id) return setError('กรุณาเลือกหมวดหมู่')
    if (form.price === '' || Number.isNaN(price) || price < 0) return setError('ราคาต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป')

    const body = {
      name: form.name.trim(),
      category_id: form.category_id,
      price,
      description: form.description.trim() || null,
    }
    if (image) body.image = image
    else if (removeImage) body.image_url = null

    setSaving(true)
    setError('')
    try {
      const saved = isNew
        ? await createMenu({ ...body, ...(isOwner ? { branch_id: branchId } : {}) })
        : await updateMenu(menu.id, body)

      const changed = selected.length !== initialSelected.length || selected.some((id, i) => id !== initialSelected[i])
      if (changed) {
        await setMenuOptionGroups(
          saved.id,
          selected.map((id, i) => ({ option_group_id: id, sort_order: i + 1 })),
        )
      }
      onSaved(saved, isNew)
    } catch (err) {
      setError(errorText(err))
      setSaving(false)
    }
  }

  return (
    <div className="mm-overlay" onMouseDown={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form className="mm-dialog" onSubmit={submit}>
        <h2 className="mm-dialog-title">{isNew ? 'เพิ่มเมนู' : `แก้ไข ${menu.name}`}</h2>
        <p className="mm-hint">
          สาขา {branchName}
          {isNew && ' · เมนูใหม่เริ่มที่สต็อก 0 และปิดขายไว้ก่อน'}
        </p>

        <div className="mm-form">
          <div className="mm-image-box">
            <div className="mm-image-preview">
              {preview ? <img src={preview} alt="" /> : <span>ไม่มีรูป</span>}
            </div>
            <label className="mm-btn mm-file">
              เลือกรูป
              <input type="file" accept={IMAGE_TYPES.join(',')} onChange={pickImage} />
            </label>
            {preview && (
              <button type="button" className="mm-link" onClick={clearImage}>
                เอารูปออก
              </button>
            )}
          </div>

          <div className="mm-fields">
            <label className="mm-field">
              <span>ชื่อเมนู *</span>
              <input className="mm-input" value={form.name} onChange={set('name')} maxLength={100} autoFocus />
            </label>
            <div className="mm-two">
              <label className="mm-field">
                <span>หมวดหมู่ *</span>
                <select className="mm-select" value={form.category_id} onChange={set('category_id')}>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="mm-field">
                <span>ราคา (บาท ก่อน VAT) *</span>
                <input
                  className="mm-input"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={form.price}
                  onChange={set('price')}
                />
              </label>
            </div>
            <label className="mm-field">
              <span>รายละเอียด</span>
              <textarea className="mm-input" rows={2} value={form.description} onChange={set('description')} maxLength={500} />
            </label>
          </div>
        </div>

        <fieldset className="mm-groups">
          <legend>กลุ่มตัวเลือกของเมนูนี้</legend>
          {groups.length === 0 ? (
            <p className="mm-hint">สาขานี้ยังไม่มีกลุ่มตัวเลือก</p>
          ) : (
            groups.map((g) => {
              const order = selected.indexOf(g.id)
              return (
                <label key={g.id} className={`mm-group ${order >= 0 ? 'is-checked' : ''}`}>
                  <input type="checkbox" checked={order >= 0} onChange={() => toggleGroup(g.id)} />
                  <div>
                    <strong>
                      {order >= 0 && <em>{order + 1}</em>}
                      {g.name}
                    </strong>
                    <small>
                      {g.is_required ? 'ต้องเลือก' : 'ไม่บังคับ'} · เลือกได้ {g.max_select === 1 ? '1 อย่าง' : `ไม่เกิน ${g.max_select}`} ·{' '}
                      {g.options.map((o) => (o.extra_price > 0 ? `${o.name} +${o.extra_price}` : o.name)).join(', ')}
                    </small>
                  </div>
                </label>
              )
            })
          )}
        </fieldset>

        {error && <div className="mm-alert">{error}</div>}

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
