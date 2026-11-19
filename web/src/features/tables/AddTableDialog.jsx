import { useId, useState } from 'react'
import { createTable } from '../../api/pos'
import { errorText } from '../../lib/format'
import { Dialog, Stepper } from '../../components/ui/posUi'

// เพิ่มโต๊ะในผัง (manager สาขาตัวเอง / owner เลือกสาขา) — ชื่อโต๊ะซ้ำในสาขาเดียวกันไม่ได้

export default function AddTableDialog({ branchId, branchName, zones = [], onClose, onCreated }) {
  const zoneListId = useId()
  const [tableNo, setTableNo] = useState('')
  const [seats, setSeats] = useState(4)
  const [zone, setZone] = useState(zones[0] && zones[0] !== 'โต๊ะทั้งหมด' ? zones[0] : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!tableNo.trim()) return setError('กรุณากรอกชื่อโต๊ะ')
    setBusy(true)
    setError('')
    try {
      const table = await createTable({
        table_no: tableNo.trim(),
        seats,
        zone: zone.trim() || null,
        ...(branchId ? { branch_id: branchId } : {}),
      })
      onCreated(table)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <Dialog title="เพิ่มโต๊ะ" subtitle={branchName ? `สาขา${branchName}` : undefined} onClose={onClose} busy={busy}>
      <form onSubmit={submit}>
        <label className="pos-field">
          <span>ชื่อ / เลขโต๊ะ</span>
          <input
            className="pos-input"
            value={tableNo}
            onChange={(e) => setTableNo(e.target.value)}
            maxLength={20}
            placeholder="เช่น T13, A1, VIP-1"
            autoFocus
          />
        </label>

        <div className="pos-field">
          <span>จำนวนที่นั่ง</span>
          <Stepper value={seats} onChange={setSeats} min={1} max={50} label="จำนวนที่นั่ง" />
        </div>

        <label className="pos-field">
          <span>โซน (ไม่บังคับ)</span>
          <input
            className="pos-input"
            value={zone}
            onChange={(e) => setZone(e.target.value)}
            maxLength={50}
            list={zoneListId}
            placeholder="เช่น โซนในร้าน, โซนด้านนอก"
          />
          <datalist id={zoneListId}>
            {zones
              .filter((z) => z !== 'โต๊ะทั้งหมด')
              .map((z) => (
                <option key={z} value={z} />
              ))}
          </datalist>
        </label>

        {error && <p className="pos-error">{error}</p>}

        <div className="pos-dialog-actions">
          <button type="button" className="pos-btn" onClick={onClose} disabled={busy}>
            ยกเลิก
          </button>
          <button type="submit" className="pos-btn pos-btn-primary" disabled={busy}>
            {busy ? 'กำลังเพิ่ม…' : 'เพิ่มโต๊ะ'}
          </button>
        </div>
      </form>
    </Dialog>
  )
}
