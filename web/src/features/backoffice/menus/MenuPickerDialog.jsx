import { useMemo, useState } from 'react'
import { thb } from '../../../lib/posUtils'
import { Dialog } from '../../../components/ui/posUi'

// เลือกเมนูที่จะผูกกับกลุ่มตัวเลือก — การ์ดรูปในหน้าต่างใหญ่เกือบเต็มจอ
// แก้เป็นฉบับร่างก่อน กด "ตกลง" ถึงจะส่งกลับ (ยกเลิก = ไม่เปลี่ยนอะไร) · ยังต้องกด "บันทึกกลุ่ม" ที่หน้าหลักเพื่อบันทึกจริง
// รูปโหลดแบบ lazy และมีกล่องขนาดคงที่ไว้ก่อน หน้าจึงไม่กระตุกเมื่อรูปมาช้า

export default function MenuPickerDialog({ menus, selected, groupName, onApply, onClose }) {
  const [draft, setDraft] = useState(() => new Set(selected))
  const [search, setSearch] = useState('')

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return menus.filter((m) => !q || m.name.toLowerCase().includes(q))
  }, [menus, search])

  const toggle = (id) =>
    setDraft((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const selectShown = () => setDraft((cur) => new Set([...cur, ...shown.map((m) => m.id)]))
  const clearShown = () =>
    setDraft((cur) => {
      const next = new Set(cur)
      for (const m of shown) next.delete(m.id)
      return next
    })

  return (
    <Dialog title="เลือกเมนูที่ใช้กลุ่มนี้" subtitle={groupName ? `กลุ่ม: ${groupName}` : undefined} size="xl" onClose={onClose}>
      <div className="pos-picker-bar">
        <input className="pos-search" type="search" placeholder="ค้นหาเมนู" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="ค้นหาเมนู" autoFocus />
        <button type="button" className="pos-btn" onClick={selectShown} disabled={shown.length === 0}>
          เลือกทั้งหมด{search.trim() ? 'ที่ค้นเจอ' : ''}
        </button>
        <button type="button" className="pos-btn" onClick={clearShown} disabled={shown.length === 0}>
          ล้างที่เลือก
        </button>
      </div>

      {shown.length === 0 ? (
        <div className="pos-empty">ไม่พบเมนู</div>
      ) : (
        <div className="pos-picker-grid" role="group" aria-label="เมนู">
          {shown.map((m) => {
            const on = draft.has(m.id)
            return (
              <button key={m.id} type="button" role="checkbox" aria-checked={on} className={`pos-picker-card ${on ? 'is-on' : ''}`} onClick={() => toggle(m.id)}>
                <span className="pos-picker-img">
                  {m.image_url ? <img src={m.image_url} alt="" loading="lazy" decoding="async" /> : <span className="pos-picker-ph" aria-hidden="true">{m.name.trim().charAt(0)}</span>}
                  <span className="pos-picker-tick" aria-hidden="true">{on ? '✓' : ''}</span>
                </span>
                <span className="pos-picker-name">{m.name}</span>
                {m.price != null && <span className="pos-picker-price">{thb(m.price)}</span>}
              </button>
            )
          })}
        </div>
      )}

      <div className="pos-dialog-actions pos-picker-foot">
        <span className="pos-muted pos-small">เลือกแล้ว {draft.size} จาก {menus.length} เมนู</span>
        <span className="pos-picker-btns">
          <button type="button" className="pos-btn" onClick={onClose}>
            ยกเลิก
          </button>
          <button type="button" className="pos-btn pos-btn-primary" onClick={() => onApply(draft)}>
            ตกลง
          </button>
        </span>
      </div>
    </Dialog>
  )
}
