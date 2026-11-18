import { useMemo, useState } from 'react'
import { thb, thb2 } from './checkoutUtils'

// รับเงินสด: พิมพ์/กดปุ่มตัวเลข หรือกดปุ่มลัด แล้วระบบคิดเงินทอนให้ (1.25)

/** ปุ่มลัด: ธนบัตรที่มากกว่ายอด 3 ค่า เช่น 1,660 → 1,700 / 2,000 / 2,500 */
function quickAmounts(total) {
  const up = (step, plus = 0) => Math.ceil(total / step) * step + plus
  const list = [up(100), up(500), up(1000), up(500, 500), up(1000, 1000)].filter((v) => v > total)
  return [...new Set(list)].sort((a, b) => a - b).slice(0, 3)
}

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '00', '0', 'ลบ']

export default function CashForm({ total, paying, onPay }) {
  const [received, setReceived] = useState('')
  const value = Number(received)
  const typed = received !== '' && Number.isFinite(value)
  const enough = typed && value >= total
  const change = enough ? Math.round((value - total) * 100) / 100 : 0
  const quick = useMemo(() => quickAmounts(total), [total])

  function press(key) {
    setReceived((r) => {
      if (key === 'ลบ') return r.slice(0, -1)
      const next = r === '0' ? key.replace(/^0+/, '') || '0' : r + key
      return next.length > 9 ? r : next
    })
  }

  function submit(e) {
    e.preventDefault()
    if (enough && !paying) onPay(value)
  }

  return (
    <form className="pos-pay-form" onSubmit={submit}>
      <label className="pos-label" htmlFor="pos-cash" style={{ fontWeight: 400, color: 'var(--app-muted)' }}>
        รับเงินมา
      </label>
      <input
        id="pos-cash"
        className="pos-input pos-input-lg"
        inputMode="decimal"
        value={received}
        onChange={(e) => /^\d*\.?\d{0,2}$/.test(e.target.value) && setReceived(e.target.value)}
        placeholder={thb2(total)}
        autoFocus
        disabled={paying}
        autoComplete="off"
      />

      <div className="pos-chips" style={{ margin: '12px 0' }}>
        <button type="button" className={`pos-chip ${typed && value === total ? 'is-active' : ''}`} onClick={() => setReceived(String(total))} disabled={paying}>
          พอดียอด
        </button>
        {quick.map((amount) => (
          <button key={amount} type="button" className={`pos-chip ${typed && value === amount ? 'is-active' : ''}`} onClick={() => setReceived(String(amount))} disabled={paying}>
            {thb(amount)}
          </button>
        ))}
      </div>

      <div className="pos-keypad" role="group" aria-label="แป้นตัวเลข">
        {KEYS.map((k) => (
          <button key={k} type="button" onClick={() => press(k)} disabled={paying} aria-label={k === 'ลบ' ? 'ลบตัวเลขสุดท้าย' : undefined}>
            {k}
          </button>
        ))}
      </div>

      <div className={`pos-change ${typed && !enough ? 'is-short' : ''}`} aria-live="polite">
        <span>{typed && !enough ? 'ยังขาดอีก' : 'เงินทอน'}</span>
        <strong>{thb2(typed && !enough ? total - value : change)}</strong>
      </div>

      <button className="pos-btn pos-btn-primary pos-btn-block pos-pay-submit" disabled={!enough || paying}>
        {paying ? 'กำลังบันทึก…' : 'ยืนยันรับเงิน & ปิดโต๊ะ'}
      </button>
    </form>
  )
}
