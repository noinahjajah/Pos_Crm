import { useMemo, useState } from 'react'
import { thb } from '../../lib/posUtils'
import { Dialog, Stepper } from '../../components/ui/posUi'

// เลือกตัวเลือกเสริม + หมายเหตุ + จำนวน ก่อนเพิ่มลงออร์เดอร์ (1.9, 1.16–1.18)
// กลุ่มที่ max_select = 1 → เลือกได้อย่างเดียว (radio) · มากกว่านั้น → เลือกได้ไม่เกิน max_select
// initial = รายการเดิมในตะกร้า (กรณีแก้ไข)

function groupHint(g) {
  const many = g.max_select >= (g.options?.length || 0)
  const pick = g.max_select === 1 ? 'เลือกได้ 1 อย่าง' : many ? 'เลือกได้หลายอย่าง' : `เลือกได้สูงสุด ${g.max_select} อย่าง`
  return g.is_required ? `${pick} · บังคับ` : pick
}

export default function MenuOptionDialog({ menu, initial, maxQty = 99, onClose, onSubmit }) {
  const groups = useMemo(() => menu.option_groups || [], [menu.option_groups])

  const [selected, setSelected] = useState(() => {
    const init = {}
    for (const g of groups) {
      init[g.id] = (initial?.options || []).filter((o) => g.options.some((x) => x.id === o.option_id)).map((o) => o.option_id)
    }
    return init
  })
  const [note, setNote] = useState(initial?.note || '')
  const [qty, setQty] = useState(initial?.quantity || 1)

  function toggle(g, optionId) {
    setSelected((s) => {
      const cur = s[g.id] || []
      if (g.max_select === 1) {
        // แตะตัวที่เลือกอยู่ซ้ำ = ยกเลิก (เฉพาะกลุ่มที่ไม่บังคับ)
        const next = cur[0] === optionId ? (g.is_required ? cur : []) : [optionId]
        return { ...s, [g.id]: next }
      }
      if (cur.includes(optionId)) return { ...s, [g.id]: cur.filter((id) => id !== optionId) }
      if (cur.length >= g.max_select) return s
      return { ...s, [g.id]: [...cur, optionId] }
    })
  }

  const chosen = groups.flatMap((g) =>
    g.options
      .filter((o) => (selected[g.id] || []).includes(o.id))
      .map((o) => ({ option_id: o.id, option_name: o.name, extra_price: Number(o.extra_price || 0), group_id: g.id })),
  )
  const missing = groups.filter((g) => g.is_required && (selected[g.id] || []).length === 0)
  const unit = Number(menu.price) + chosen.reduce((s, o) => s + o.extra_price, 0)

  function submit(e) {
    e.preventDefault()
    if (missing.length) return
    onSubmit({
      menu_id: menu.id,
      menu_name: menu.name,
      unit_price: Number(menu.price),
      quantity: qty,
      note: note.trim(),
      options: chosen,
    })
  }

  return (
    <Dialog title={menu.name} subtitle={[menu.category_name, thb(menu.price)].filter(Boolean).join(' · ')} onClose={onClose} size="md">
      <form onSubmit={submit}>
        {groups.map((g) => {
          const cur = selected[g.id] || []
          const single = g.max_select === 1
          const full = !single && cur.length >= g.max_select
          return (
            <fieldset key={g.id} className="pos-opt-group" style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="pos-opt-head">
                <legend style={{ padding: 0 }}>
                  <strong>{g.name}</strong>
                </legend>
                <span className={`pos-pill ${g.is_required ? 'is-muted' : 'is-available'}`}>{groupHint(g)}</span>
              </div>
              <div className="pos-opt-list">
                {g.options.map((o) => {
                  const checked = cur.includes(o.id)
                  const disabled = !checked && full
                  return (
                    <label key={o.id} className={`pos-opt ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
                      <input
                        type={single ? 'radio' : 'checkbox'}
                        name={`g-${g.id}`}
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggle(g, o.id)}
                        onClick={() => single && checked && toggle(g, o.id)}
                      />
                      {o.name}
                      {Number(o.extra_price) > 0 && <span className="pos-opt-price">+{thb(o.extra_price)}</span>}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          )
        })}

        <label className="pos-label" htmlFor="pos-note" style={{ marginTop: 16 }}>
          หมายเหตุถึงครัว
        </label>
        <input
          id="pos-note"
          className="pos-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={200}
          placeholder="เช่น ไม่ใส่ผัก, แยกน้ำ"
        />

        {missing.length > 0 && <p className="pos-note is-warn" style={{ marginTop: 12 }}>กรุณาเลือก: {missing.map((g) => g.name).join(', ')}</p>}

        <div className="pos-opt-foot">
          <Stepper value={qty} onChange={setQty} min={1} max={Math.max(1, maxQty)} />
          <button type="submit" className="pos-btn pos-btn-primary" disabled={missing.length > 0}>
            {initial ? 'บันทึก' : 'เพิ่มลงออร์เดอร์'} · {thb(unit * qty)}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
