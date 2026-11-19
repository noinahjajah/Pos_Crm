import { useCallback, useEffect, useMemo, useState } from 'react'
import { APPROVAL_STATUS, POS_MOCK, getOrder, lineAmount, listApprovals, listOrders, orderItems, requestApproval } from '../../api/pos'
import { errorText } from '../../lib/format'
import { hhmm, tablesText, thb, useToast } from '../../lib/posUtils'
import { MockBanner, Stepper, Toast } from '../../components/ui/posUi'
import '../../styles/pos.css'

// staff ขอคืนเงิน: อ้างอิงบิลที่จ่ายแล้ว · คืนทั้งบิลหรือบางรายการ (1.28)
// ส่งคำขอ → manager/owner อนุมัติ (1.29) → คืนเงินที่หน้าคิดเงินของ Dev 2 (1.30) · คืนเงินไม่คืนสต็อก

const VAT_RATE = 0.07
const METHOD = { cash: 'ชำระเงินสด', promptpay: 'ชำระ PromptPay' }

/** วันนี้ตามเวลาไทย 'YYYY-MM-DD' */
const todayTh = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10)

export default function RefundRequestPage() {
  const [bills, setBills] = useState([])
  const [mine, setMine] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [q, setQ] = useState('')
  const [searching, setSearching] = useState(false)
  const [order, setOrder] = useState(null)
  const [loadingOrder, setLoadingOrder] = useState(false)
  const [mode, setMode] = useState('partial') // 'full' | 'partial'
  const [qty, setQty] = useState({}) // order_item_id → จำนวนที่คืน
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()

  // บิลที่จ่ายแล้ววันนี้ + คำขอคืนเงินของฉัน
  useEffect(() => {
    let cancelled = false
    Promise.all([listOrders({ status: 'paid', date: todayTh() }), listApprovals({ type: 'refund' })])
      .then(([orders, approvals]) => {
        if (cancelled) return
        setBills(orders || [])
        setMine(approvals || [])
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const term = q.trim().toLowerCase()
  const shownBills = term ? bills.filter((b) => (b.order_no || '').toLowerCase().includes(term)) : bills

  /** Enter ในช่องค้นหา → ถ้าไม่เจอในบิลวันนี้ ค้นจากทุกวัน */
  async function search(e) {
    e.preventDefault()
    if (!term) return
    if (shownBills.length === 1) return selectBill(shownBills[0])
    if (shownBills.length > 1) return
    setSearching(true)
    try {
      const found = await listOrders({ status: 'paid', q: q.trim() })
      if (!found?.length) notify('ไม่พบบิลที่จ่ายแล้วเลขนี้', 'error')
      else if (found.length === 1) selectBill(found[0])
      else setBills(found)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setSearching(false)
    }
  }

  const selectBill = useCallback(
    async (bill) => {
      setSent(null)
      setQty({})
      setReason('')
      setMode('partial')
      setLoadingOrder(true)
      try {
        setOrder(await getOrder(bill.id))
      } catch (err) {
        notify(errorText(err), 'error')
      } finally {
        setLoadingOrder(false)
      }
    },
    [notify],
  )

  // ---------- คำนวณยอดคืน ----------
  const items = useMemo(() => orderItems(order), [order])
  const subtotal = Number(order?.subtotal ?? items.reduce((s, it) => s + lineAmount(it), 0))
  const total = Number(order?.total ?? subtotal)
  // ใช้สัดส่วนยอดสุทธิ/ยอดรายการ → ถูกทั้งกรณีมีส่วนลดและวิธีคิด VAT แบบรวม/แยก
  const ratio = subtotal > 0 ? total / subtotal : 1

  const picked = items.filter((it) => (qty[it.id] || 0) > 0)
  const refundAmount =
    mode === 'full'
      ? total
      : Math.min(total, Math.round(picked.reduce((s, it) => s + (lineAmount(it) / it.quantity) * qty[it.id], 0) * ratio * 100) / 100)
  const beforeVat = Math.round((refundAmount / (1 + VAT_RATE)) * 100) / 100
  const vat = Math.round((refundAmount - beforeVat) * 100) / 100

  const pending = order && mine.find((a) => a.order_id === order.id && a.status === 'pending')
  const canSend = order && !pending && refundAmount > 0 && reason.trim() && !busy

  async function submit() {
    if (!canSend) return
    setBusy(true)
    try {
      const body = { type: 'refund', value_type: 'amount', value: refundAmount, reason: reason.trim() }
      if (mode === 'partial') body.refund_items = picked.map((it) => ({ order_item_id: it.id, quantity: qty[it.id] }))
      const approval = await requestApproval(order.id, body)
      setSent(approval)
      setReloadKey((k) => k + 1)
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  const step = sent ? 2 : 1

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">ขอคืนเงิน</h1>
          <p className="pos-subtitle">อ้างอิงบิลเดิม · คืนทั้งบิลหรือบางรายการ</p>
        </div>
      </header>

      <MockBanner show={POS_MOCK} />
      {error && <div className="pos-alert">{error}</div>}

      <div className="pos-refund-layout">
        {/* ---------- ค้นหาบิล ---------- */}
        <section className="pos-panel" aria-label="ค้นหาบิลเดิม">
          <h2 className="pos-panel-title">ค้นหาบิลเดิม</h2>
          <form onSubmit={search}>
            <label className="pos-label" htmlFor="pos-bill-no" style={{ fontWeight: 400, color: 'var(--app-muted)' }}>
              เลขที่บิล
            </label>
            <input id="pos-bill-no" className="pos-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="พิมพ์เลขบิลแล้วกด Enter" disabled={searching} />
          </form>

          <p className="pos-muted pos-small" style={{ margin: '14px 0 8px' }}>
            {term ? 'ผลการค้นหา' : 'บิลล่าสุดของสาขา'}
          </p>
          {loading ? (
            <div className="pos-skeleton" style={{ height: 160 }} />
          ) : shownBills.length === 0 ? (
            <div className="pos-cart-empty">{term ? 'ไม่พบในบิลวันนี้ · กด Enter เพื่อค้นทุกวัน' : 'ยังไม่มีบิลที่จ่ายแล้ววันนี้'}</div>
          ) : (
            <div className="pos-bill-list">
              {shownBills.map((b) => (
                <button key={b.id} type="button" className={`pos-bill-card ${order?.id === b.id ? 'is-active' : ''}`} onClick={() => selectBill(b)}>
                  <span>
                    <strong>{b.order_no}</strong>
                    <span className="pos-line-sub">
                      {tablesText(b, ', ')} · {hhmm(b.paid_at || b.opened_at)}
                    </span>
                  </span>
                  <strong>{thb(b.total)}</strong>
                </button>
              ))}
            </div>
          )}

          {mine.length > 0 && (
            <>
              <p className="pos-muted pos-small" style={{ margin: '18px 0 8px' }}>
                คำขอคืนเงินของฉัน
              </p>
              <div className="pos-bill-list">
                {mine.slice(0, 5).map((a) => (
                  <div key={a.id} className="pos-mini-row">
                    <span>
                      {a.order_no || a.order_id.slice(0, 8)} · {thb(a.amount)}
                    </span>
                    <span className={`pos-pill ${APPROVAL_STATUS[a.status]?.cls || 'is-muted'}`}>{APPROVAL_STATUS[a.status]?.label || a.status}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ---------- รายการในบิล ---------- */}
        <section className="pos-panel" aria-label="รายการที่คืน">
          {loadingOrder ? (
            <div className="pos-skeleton" />
          ) : !order ? (
            <div className="pos-cart-empty">เลือกบิลทางซ้าย หรือค้นหาจากเลขที่บิล</div>
          ) : (
            <>
              <div className="pos-panel-head">
                <div>
                  <h2 className="pos-panel-title" style={{ margin: 0 }}>
                    บิล {order.order_no}
                  </h2>
                  <p className="pos-dialog-sub">
                    โต๊ะ {tablesText(order, ', ')} · {hhmm(order.opened_at)}
                    {order.payment_method && ` · ${METHOD[order.payment_method] || order.payment_method}`} {thb(total)}
                  </p>
                </div>
                <div className="pos-tabs" role="tablist" style={{ margin: 0 }}>
                  <button type="button" role="tab" aria-selected={mode === 'full'} className={mode === 'full' ? 'is-active' : ''} onClick={() => setMode('full')} disabled={!!sent}>
                    คืนทั้งบิล
                  </button>
                  <button type="button" role="tab" aria-selected={mode === 'partial'} className={mode === 'partial' ? 'is-active' : ''} onClick={() => setMode('partial')} disabled={!!sent}>
                    คืนบางรายการ
                  </button>
                </div>
              </div>

              <div className="pos-rtable-wrap">
                <table className="pos-rtable">
                  <thead>
                    <tr>
                      <th aria-label="เลือก" />
                      <th>รายการ</th>
                      <th className="is-num">ซื้อ</th>
                      <th className="is-center">จำนวนที่คืน</th>
                      <th className="is-num">ยอดคืน</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => {
                      const n = mode === 'full' ? it.quantity : qty[it.id] || 0
                      const on = n > 0
                      const each = lineAmount(it) / it.quantity
                      return (
                        <tr key={it.id}>
                          <td>
                            <input
                              type="checkbox"
                              className="pos-check"
                              checked={on}
                              disabled={mode === 'full' || !!sent}
                              onChange={() => setQty((m) => ({ ...m, [it.id]: on ? 0 : 1 }))}
                              aria-label={`คืน ${it.menu_name}`}
                            />
                          </td>
                          <td>
                            {it.menu_name}
                            {it.options?.length > 0 && <span className="pos-line-sub">{it.options.map((o) => o.option_name).join(' · ')}</span>}
                          </td>
                          <td className="is-num">{it.quantity}</td>
                          <td className="is-center">
                            {on && mode === 'partial' && !sent ? (
                              <Stepper value={n} onChange={(v) => setQty((m) => ({ ...m, [it.id]: v }))} min={0} max={it.quantity} size="sm" label={`จำนวนที่คืน ${it.menu_name}`} />
                            ) : (
                              <span className="pos-muted">{n}</span>
                            )}
                          </td>
                          <td className="is-num">{thb(each * n)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              <p className="pos-note is-muted" style={{ marginTop: 14 }}>
                {mode === 'full'
                  ? 'คืนทั้งบิล: คืนยอดสุทธิที่ลูกค้าจ่ายทั้งหมด · คืนเงินไม่คืนสต็อก'
                  : 'คืนบางรายการ: เลือกรายการและจำนวนที่คืน ระบบคำนวณยอดคืน (รวม VAT) ให้อัตโนมัติ · คืนเงินไม่คืนสต็อก'}
              </p>
            </>
          )}
        </section>

        {/* ---------- สรุป + ส่งคำขอ ---------- */}
        <section className="pos-refund-side" aria-label="ยอดคืนเงิน">
          <div className="pos-panel">
            <h2 className="pos-panel-title">ยอดคืนเงิน</h2>
            <div className="pos-sum">
              <span>ยอดก่อน VAT</span>
              <span>{thb(beforeVat)}</span>
            </div>
            <div className="pos-sum">
              <span>VAT 7%</span>
              <span>{thb(vat)}</span>
            </div>
            <div className="pos-sum is-total is-refund">
              <span>คืนลูกค้า</span>
              <strong>{thb(refundAmount)}</strong>
            </div>
          </div>

          <label className="pos-label" htmlFor="pos-refund-reason" style={{ fontWeight: 400, color: 'var(--app-muted)', marginTop: 4 }}>
            เหตุผล (บังคับ)
          </label>
          <input
            id="pos-refund-reason"
            className="pos-input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={200}
            placeholder="เช่น ลูกค้าไม่ได้รับเครื่องดื่ม"
            disabled={!order || !!sent}
          />

          <ol className="pos-steps" aria-label="ขั้นตอน">
            {['ส่งคำขอ', 'รออนุมัติ', 'คืนเงิน'].map((s, i) => (
              <li key={s} className={i + 1 === step ? 'is-current' : i + 1 < step ? 'is-done' : ''}>
                {i + 1} {s}
              </li>
            ))}
          </ol>

          {pending && !sent && <p className="pos-note is-warn">บิลนี้มีคำขอคืนเงิน {thb(pending.amount)} รออนุมัติอยู่แล้ว</p>}
          {sent && (
            <p className="pos-note is-brand">
              <strong>ส่งคำขอคืนเงิน {thb(sent.amount)} แล้ว</strong>
              รอผู้จัดการอนุมัติ จากนั้นคืนเงินที่หน้า "คิดเงิน"
            </p>
          )}

          <div className="pos-refund-actions">
            {sent ? (
              <button type="button" className="pos-btn pos-btn-block" onClick={() => { setOrder(null); setSent(null) }}>
                ขอคืนเงินบิลอื่น
              </button>
            ) : (
              <button type="button" className="pos-btn pos-btn-primary pos-btn-block" onClick={submit} disabled={!canSend}>
                {busy ? 'กำลังส่ง…' : 'ส่งคำขอคืนเงิน'}
              </button>
            )}
          </div>
        </section>
      </div>

      <Toast toast={toast} />
    </div>
  )
}
