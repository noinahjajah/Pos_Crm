import { useState } from 'react'
import { openOrder } from '../../api/pos'
import { errorText } from '../../lib/format'
import { useAuth } from '../auth/AuthContext'
import { hhmm, useNow } from '../../lib/posUtils'
import { Dialog, Stepper } from '../../components/ui/posUi'

// เปิดโต๊ะ: ระบุจำนวนลูกค้า ระบบบันทึกเวลาเปิดเอง (1.7)

const QUICK = [1, 2, 3, 4, 5]

export default function OpenTableDialog({ table, onClose, onOpened }) {
  const { user } = useAuth()
  const now = useNow(15_000)
  const [guests, setGuests] = useState(Math.min(table.seats || 2, 4))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      const order = await openOrder({ table_ids: [table.id], guest_count: guests })
      onOpened(order)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  const subtitle = [table.zone /* , table.seats ? `${table.seats} ที่นั่ง` : null */].filter(Boolean).join(' · ') // จำนวนที่นั่ง: ยังไม่เปิดใช้

  return (
    <Dialog title={`เปิดโต๊ะ ${table.table_no}`} subtitle={subtitle} onClose={onClose} busy={busy}>
      <span className="pos-label">จำนวนลูกค้า</span>
      <div className="pos-center">
        <Stepper value={guests} onChange={setGuests} min={1} max={50} size="lg" label="จำนวนลูกค้า" />
      </div>
      <div className="pos-quick">
        {QUICK.map((n) => (
          <button key={n} type="button" className={guests === n ? 'is-active' : ''} onClick={() => setGuests(n)}>
            {n}
          </button>
        ))}
        <button type="button" className={guests >= 6 ? 'is-active' : ''} onClick={() => setGuests((g) => (g >= 6 ? g : 6))}>
          6+
        </button>
      </div>

      <div className="pos-infobox">
        <div>
          <span>เวลาเปิดโต๊ะ</span>
          <strong>{hhmm(now)} · บันทึกอัตโนมัติ</strong>
        </div>
        <div>
          <span>พนักงานที่เปิด</span>
          <strong>{user?.full_name || user?.username || '—'}</strong>
        </div>
      </div>

      {error && <p className="pos-error">{error}</p>}

      <div className="pos-dialog-actions">
        <button type="button" className="pos-btn" onClick={onClose} disabled={busy}>
          ยกเลิก
        </button>
        <button type="button" className="pos-btn pos-btn-primary" onClick={submit} disabled={busy}>
          {busy ? 'กำลังเปิดโต๊ะ…' : 'เปิดโต๊ะ & รับออร์เดอร์'}
        </button>
      </div>
    </Dialog>
  )
}
