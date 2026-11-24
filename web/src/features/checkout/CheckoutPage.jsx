import { useEffect, useState } from 'react'
import { createPayment, getOrder } from '../../api/payment'
import { thaiTime } from '../../lib/format'
import { useAuth } from '../auth/AuthContext'
import { useBranchName } from '../../lib/posUtils'
import BillSummary from './BillSummary'
import CardForm from './CardForm'
import CashForm from './CashForm'
import PromptPayQR from './PromptPayQR'
import Receipt from './Receipt'
import { billItems, billNumbers, errorText, lineTotal, tableLabel, thb, thb2 } from './checkoutUtils'
import '../../styles/pos.css'

// หน้าชำระเงิน — 1.23, 1.25 (ฝั่งเงินของ Dev 2) · เงินสด / PromptPay / บัตรเครดิต-เดบิต (EDC)
// ใช้: <CheckoutPage orderId="..." onDone={() => ...} onBack={() => ...} />
// ถ้าไม่ส่ง orderId จะอ่านจาก URL ?order_id=...
// ยอดเงินมาจากบิลผ่าน payment service · บิลต้องอยู่สถานะ "รอชำระ" (waiting_payment) ก่อน

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`)

export default function CheckoutPage({ orderId: orderIdProp, onDone, onBack }) {
  const orderId = orderIdProp || new URLSearchParams(window.location.search).get('order_id')
  const { user } = useAuth()
  const branchName = useBranchName()
  const [order, setOrder] = useState(null)
  const [loadError, setLoadError] = useState(orderId ? '' : 'ไม่ได้ระบุบิลที่จะคิดเงิน')
  const [method, setMethod] = useState('cash')
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  const [result, setResult] = useState(null)
  // key กันรับเงินซ้ำ: ใช้ key เดิมตลอดการจ่ายบิลนี้ กดซ้ำหรือเน็ตหลุดแล้วกดใหม่ก็ไม่รับเงินซ้ำ
  const [idempotencyKey] = useState(newKey)

  useEffect(() => {
    if (!orderId) return
    let cancelled = false
    getOrder(orderId)
      .then((data) => !cancelled && setOrder({ ...data, items: billItems(data) }))
      .catch((err) => !cancelled && setLoadError(errorText(err)))
    return () => {
      cancelled = true
    }
  }, [orderId])

  async function pay(body) {
    setPaying(true)
    setPayError('')
    try {
      const res = await createPayment({ order_id: orderId, method, ...body }, idempotencyKey)
      setResult(res)
    } catch (err) {
      setPayError(errorText(err))
    } finally {
      setPaying(false)
    }
  }

  if (loadError) {
    return (
      <div className="pos-page">
        <div className="pos-alert">{loadError}</div>
        {onBack && (
          <button className="pos-btn" onClick={onBack}>
            ← กลับ
          </button>
        )}
      </div>
    )
  }

  if (!order) {
    return (
      <div className="pos-page">
        <div className="pos-skeleton" />
      </div>
    )
  }

  const tables = tableLabel(order)
  const staffName = user?.full_name || user?.username || ''

  if (result) {
    return (
      <div className="pos-page">
        <header className="pos-header">
          <div>
            <h1 className="pos-title">ชำระเงินสำเร็จ · โต๊ะ {tables}</h1>
            <p className="pos-subtitle">
              บิล {order.order_no || order.id.slice(0, 8)} · {thaiTime(result.payment.paid_at)}
            </p>
          </div>
        </header>
        <Receipt order={order} payment={result.payment} changeAmount={result.change_amount} branchName={branchName} staffName={staffName} onDone={onDone} />
      </div>
    )
  }

  const total = billNumbers(order).total
  const waiting = order.status === 'waiting_payment'
  const items = order.items || []

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">ชำระเงิน · โต๊ะ {tables}</h1>
          <p className="pos-subtitle">
            บิล {order.order_no || order.id.slice(0, 8)}
            {order.guest_count ? ` · ${order.guest_count} คน` : ''}
          </p>
        </div>
        {onBack && (
          <button className="pos-btn" onClick={onBack} disabled={paying}>
            ← กลับ
          </button>
        )}
      </header>

      <div className="pos-checkout-layout">
        {/* ---------- สรุปยอด + รายการ ---------- */}
        <div className="pos-refund-side">
          <BillSummary order={order} />
          <div className="pos-panel">
            <h2 className="pos-panel-title">รายการ ({items.length})</h2>
            {items.map((it, i) => (
              <div key={it.id || i} className="pos-bill-line">
                <span>
                  <span className="pos-muted">{i + 1}.</span> {it.menu_name} <span className="pos-muted">x{it.quantity}</span>
                  {it.options?.length > 0 && <span className="pos-line-sub">{it.options.map((o) => o.option_name || o.name).join(' · ')}</span>}
                </span>
                <span>{thb(lineTotal(it))}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ---------- รับเงิน ---------- */}
        <section className="pos-panel pos-pay-panel" aria-label="รับเงิน">
          {!waiting ? (
            <div className="pos-alert">
              {order.status === 'paid' || order.status === 'refunded'
                ? 'บิลนี้ชำระเงินแล้ว'
                : 'บิลนี้ยังไม่ได้กด “เรียกเก็บเงิน” ให้กลับไปที่หน้าคิดเงินแล้วกดเรียกเก็บเงินก่อน'}
            </div>
          ) : (
            <>
              <div className="pos-tabs" role="tablist" aria-label="วิธีชำระเงิน">
                {[
                  ['cash', 'เงินสด'],
                  ['promptpay', 'QR พร้อมเพย์ (จำลอง)'],
                  ['credit_card', 'บัตรเครดิต/เดบิต'],
                ].map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="tab"
                    aria-selected={method === m}
                    className={method === m ? 'is-active' : ''}
                    onClick={() => setMethod(m)}
                    disabled={paying}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="pos-due">
                <span>ยอดที่ต้องชำระ</span>
                <strong>{thb2(total)}</strong>
              </div>

              {payError && <p className="pos-error" style={{ margin: '0 0 12px' }}>{payError}</p>}

              {method === 'cash' ? (
                <CashForm total={total} paying={paying} onPay={(cash) => pay({ cash_received: cash })} />
              ) : method === 'credit_card' ? (
                <CardForm total={total} paying={paying} onPay={(card) => pay(card)} />
              ) : (
                <PromptPayQR total={total} reference={order.order_no || order.id} branchName={branchName} paying={paying} onConfirm={() => pay({})} />
              )}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
