import { useEffect, useState } from 'react'
import { api } from '../../api/client'
import { createPayment } from '../../api/payment'
import CashForm from './CashForm'
import PromptPayQR from './PromptPayQR'
import Receipt from './Receipt'
import { errorText, fmt, lineTotal, tableLabel } from './checkoutUtils'
import './checkout.css'

// หน้าคิดเงิน — 1.23, 1.25 (ฝั่งเงินของ Dev 2)
// ใช้: <CheckoutPage orderId="..." onDone={() => ...} onBack={() => ...} />
// ถ้าไม่ส่ง orderId จะอ่านจาก URL ?order_id=...
// ยอดเงินมาจากบิลของ pos (Dev 3) · บิลต้องอยู่สถานะ "รอชำระ" (waiting_payment) ก่อน

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `pay-${Date.now()}-${Math.random().toString(36).slice(2)}`)

export default function CheckoutPage({ orderId: orderIdProp, onDone, onBack }) {
  const orderId = orderIdProp || new URLSearchParams(window.location.search).get('order_id')
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
    api
      .get(`/pos/orders/${orderId}`)
      .then((res) => !cancelled && setOrder(res.data))
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
      <div className="co-page">
        <div className="co-alert">{loadError}</div>
        {onBack && (
          <button className="co-btn" onClick={onBack}>
            ← กลับ
          </button>
        )}
      </div>
    )
  }

  if (!order) {
    return (
      <div className="co-page">
        <div className="co-skeleton" />
      </div>
    )
  }

  if (result) {
    return (
      <div className="co-page">
        <Receipt order={order} payment={result.payment} changeAmount={result.change_amount} onDone={onDone} />
      </div>
    )
  }

  const total = Number(order.total)
  const waiting = order.status === 'waiting_payment'

  return (
    <div className="co-page">
      <header className="co-header">
        {onBack && (
          <button className="co-btn co-btn-ghost" onClick={onBack}>
            ← กลับ
          </button>
        )}
        <div>
          <h1 className="co-title">คิดเงิน</h1>
          <p className="co-sub">
            บิล {order.order_no || order.id.slice(0, 8)} · โต๊ะ {tableLabel(order)}
            {order.guest_count ? ` · ${order.guest_count} คน` : ''}
          </p>
        </div>
      </header>

      <div className="co-layout">
        {/* ---------- รายการในบิล ---------- */}
        <section className="co-bill">
          <h2 className="co-section-title">รายการ</h2>
          <ul className="co-items">
            {(order.items || []).map((it, i) => (
              <li key={it.id || i}>
                <span className="co-qty">{it.quantity}×</span>
                <div className="co-item-name">
                  {it.menu_name}
                  {(it.options || []).length > 0 && (
                    <small>{it.options.map((o) => o.option_name || o.name).join(', ')}</small>
                  )}
                  {it.note && <small className="co-note">หมายเหตุ: {it.note}</small>}
                </div>
                <span className="co-amount">{fmt(lineTotal(it))}</span>
              </li>
            ))}
          </ul>

          <dl className="co-totals">
            <div>
              <dt>ยอดก่อน VAT</dt>
              <dd>{fmt(order.subtotal)}</dd>
            </div>
            {Number(order.discount_amount) > 0 && (
              <div className="co-discount">
                <dt>ส่วนลด</dt>
                <dd>−{fmt(order.discount_amount)}</dd>
              </div>
            )}
            <div>
              <dt>VAT 7%</dt>
              <dd>{fmt(order.vat_amount)}</dd>
            </div>
            <div className="co-grand">
              <dt>ยอดสุทธิ</dt>
              <dd>฿{fmt(total)}</dd>
            </div>
          </dl>
        </section>

        {/* ---------- รับเงิน ---------- */}
        <section className="co-pay">
          {!waiting ? (
            <div className="co-alert">
              {order.status === 'paid'
                ? 'บิลนี้ชำระเงินแล้ว'
                : 'บิลนี้ยังไม่ได้กด “เรียกเก็บเงิน” ให้กลับไปที่โต๊ะแล้วกดเรียกเก็บเงินก่อน'}
            </div>
          ) : (
            <>
              <div className="co-methods" role="tablist">
                <button
                  role="tab"
                  aria-selected={method === 'cash'}
                  className={`co-method ${method === 'cash' ? 'is-active' : ''}`}
                  onClick={() => setMethod('cash')}
                  disabled={paying}
                >
                  <span aria-hidden="true">💵</span> เงินสด
                </button>
                <button
                  role="tab"
                  aria-selected={method === 'promptpay'}
                  className={`co-method ${method === 'promptpay' ? 'is-active' : ''}`}
                  onClick={() => setMethod('promptpay')}
                  disabled={paying}
                >
                  <span aria-hidden="true">📱</span> PromptPay
                </button>
              </div>

              {method === 'cash' ? (
                <CashForm total={total} paying={paying} onPay={(cash) => pay({ cash_received: cash })} />
              ) : (
                <PromptPayQR total={total} reference={order.order_no || order.id} paying={paying} onConfirm={() => pay({})} />
              )}

              {payError && <div className="co-alert co-alert-pay">{payError}</div>}
            </>
          )}
        </section>
      </div>
    </div>
  )
}
