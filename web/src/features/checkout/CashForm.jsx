import { useMemo, useState } from 'react'
import { fmt } from './checkoutUtils'

// รับเงินสด: พิมพ์จำนวนเงินที่รับ หรือกดปุ่มลัด แล้วระบบคิดเงินทอนให้ (1.25)

/** ปุ่มลัดจำนวนเงิน: พอดี + ธนบัตรที่มากกว่ายอด */
function quickAmounts(total) {
  const list = [total]
  for (const step of [20, 50, 100, 500, 1000]) {
    const v = Math.ceil(total / step) * step
    if (v > total && !list.includes(v)) list.push(v)
  }
  return list.slice(0, 5)
}

export default function CashForm({ total, paying, onPay }) {
  const [received, setReceived] = useState('')
  const value = Number(received)
  const enough = received !== '' && !Number.isNaN(value) && value >= total
  const change = enough ? Math.round((value - total) * 100) / 100 : 0
  const quick = useMemo(() => quickAmounts(total), [total])

  function submit(e) {
    e.preventDefault()
    if (enough && !paying) onPay(value)
  }

  return (
    <form className="co-cash" onSubmit={submit}>
      <label className="co-field">
        <span>รับเงินมา (บาท)</span>
        <input
          className="co-input co-input-big"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={received}
          onChange={(e) => setReceived(e.target.value)}
          placeholder={fmt(total)}
          autoFocus
          disabled={paying}
        />
      </label>

      <div className="co-quick">
        {quick.map((amount, i) => (
          <button
            key={amount}
            type="button"
            className={`co-chip ${Number(received) === amount ? 'is-active' : ''}`}
            onClick={() => setReceived(String(amount))}
            disabled={paying}
          >
            {i === 0 ? `พอดี ${fmt(amount)}` : fmt(amount)}
          </button>
        ))}
      </div>

      <div className={`co-change ${received !== '' && !enough ? 'is-short' : ''}`}>
        <span>{received !== '' && !enough ? 'ยังขาดอีก' : 'เงินทอน'}</span>
        <strong>฿{fmt(received !== '' && !enough ? total - (Number(received) || 0) : change)}</strong>
      </div>

      <button className="co-btn co-btn-primary co-btn-block" disabled={!enough || paying}>
        {paying ? 'กำลังบันทึก…' : `รับเงินสด ฿${fmt(total)}`}
      </button>
    </form>
  )
}
