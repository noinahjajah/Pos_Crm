import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { createRefund, getOrder as getPaymentOrder, listApprovedRefunds, listWaitingOrders } from '../../api/payment'
import { APPROVAL_STATUS, getOrder as getPosOrder, listApprovals, listTables, requestPayment } from '../../api/pos'
import { errorText } from '../../lib/format'
import { useAuth } from '../auth/AuthContext'
import DiscountRequestDialog from '../approvals/DiscountRequestDialog'
import { hhmm, tablesText, thb, useBranchName, useToast } from '../../lib/posUtils'
import { Toast } from '../../components/ui/posUi'
import BillPrint from './BillPrint'
import BillSummary from './BillSummary'
import { billItems, lineTotal, thb2 } from './checkoutUtils'
import '../../styles/pos.css'

// หน้าคิดเงิน (Dev 2) — 1.23, 1.25, 1.27, 1.30
// ซ้าย: โต๊ะที่มีลูกค้า (รอชำระ จาก payment + มีลูกค้า จากผังโต๊ะของ pos) และคำขอคืนเงินที่อนุมัติแล้ว
// กลาง: รายการในบิล + คำขอส่วนลด · ขวา: สรุปยอด (VAT ตาม 1.24) + ขอส่วนลด / ชำระเงิน

const REFRESH_MS = 20_000
const STATUS_PILL = {
  waiting_payment: { label: 'รอชำระ', cls: 'is-waiting' },
  open: { label: 'มีลูกค้า', cls: 'is-occupied' },
}

/** โต๊ะที่มีลูกค้าจากผังโต๊ะ → บิลละ 1 แถว (โต๊ะที่รวมกันอยู่บิลเดียวกัน) */
function openBillsFromTables(tables) {
  const map = new Map()
  for (const t of tables || []) {
    if (t.status !== 'occupied' || !t.order) continue
    const row = map.get(t.order.id) || { ...t.order, status: 'open', tables: [] }
    row.tables.push({ id: t.id, table_no: t.table_no })
    map.set(t.order.id, row)
  }
  return [...map.values()]
}

export default function CashierPage() {
  const navigate = useNavigate()
  const { isStaff } = useAuth()
  const branchName = useBranchName()
  const [bills, setBills] = useState([])
  const [refunds, setRefunds] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selectedId, setSelectedId] = useState(null)
  const [loaded, setLoaded] = useState(null) // บิลที่โหลดล่าสุด
  const [discounts, setDiscounts] = useState([])
  const [askDiscount, setAskDiscount] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [methods, setMethods] = useState({}) // approval id → วิธีคืนเงิน
  const [busyRefund, setBusyRefund] = useState(null)
  const [toast, notify] = useToast()
  const donePrinting = useCallback(() => setPrinting(false), [])

  // ---------- รายการโต๊ะ + คืนเงิน ----------
  useEffect(() => {
    let cancelled = false
    const load = () =>
      Promise.all([listWaitingOrders(), listTables().catch(() => []), listApprovedRefunds()])
        .then(([waiting, tables, refundRows]) => {
          if (cancelled) return
          const waitingRows = (waiting || []).map((o) => ({ ...o, status: 'waiting_payment' }))
          const ids = new Set(waitingRows.map((o) => o.id))
          setBills([...waitingRows, ...openBillsFromTables(tables).filter((o) => !ids.has(o.id))])
          setRefunds(refundRows || [])
          setError('')
        })
        .catch((err) => !cancelled && setError(errorText(err)))
        .finally(() => !cancelled && setLoading(false))
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // เลือกบิลแรกให้อัตโนมัติ · บิลที่เลือกหายไป (จ่ายแล้ว) → เลือกบิลแรกแทน
  const selected = useMemo(() => bills.find((b) => b.id === selectedId) || bills[0] || null, [bills, selectedId])
  // แสดงเฉพาะบิลที่ตรงกับโต๊ะที่เลือก (ระหว่างโหลดบิลใหม่ไม่โชว์บิลเก่า)
  const order = loaded && selected && loaded.id === selected.id && loaded.status === selected.status ? loaded : null

  // ---------- รายละเอียดบิล ----------
  const selectedKey = selected ? `${selected.id}:${selected.status}` : ''
  useEffect(() => {
    if (!selected) return
    let cancelled = false
    const fetchOrder = selected.status === 'waiting_payment' ? getPaymentOrder : getPosOrder
    Promise.all([fetchOrder(selected.id), listApprovals({ order_id: selected.id, type: 'discount' }).catch(() => [])])
      .then(([o, a]) => {
        if (cancelled) return
        // ใช้สถานะจากรายการทางซ้าย ให้ตรงกับที่เลือก (บิลจาก payment = รอชำระเสมอ)
        setLoaded({ ...o, id: selected.id, status: selected.status, items: billItems(o) })
        setDiscounts(a || [])
      })
      .catch((err) => !cancelled && notify(errorText(err), 'error'))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- โหลดใหม่เมื่อเปลี่ยนบิลหรือสถานะเท่านั้น ไม่ใช่ทุกครั้งที่รายการรีเฟรช
  }, [selectedKey, notify])

  function pick(bill) {
    setSelectedId(bill.id)
  }

  async function bill() {
    if (!window.confirm(`เรียกเก็บเงินโต๊ะ ${tablesText(order, ', ')} ? หลังจากนี้จะสั่งอาหารเพิ่มไม่ได้`)) return
    setBusy(true)
    try {
      await requestPayment(order.id)
      notify('เรียกเก็บเงินแล้ว')
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function refund(row) {
    const method = methods[row.id] || 'cash'
    const label = method === 'cash' ? 'เงินสด' : 'PromptPay'
    if (!window.confirm(`คืนเงิน ${thb2(row.amount)} ให้บิล ${row.order_no || row.order_id.slice(0, 8)} ด้วย${label} ?`)) return
    setBusyRefund(row.id)
    try {
      // key ผูกกับคำขอ กดซ้ำหรือเน็ตหลุดแล้วกดใหม่ก็ไม่คืนเงินซ้ำ
      await createRefund({ approval_id: row.id, method }, `refund-${row.id}`)
      notify(`คืนเงิน ${thb2(row.amount)} แล้ว`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setBusyRefund(null)
    }
  }

  // ---------- แสดงผล ----------
  const waiting = order?.status === 'waiting_payment'
  const canDiscount = isStaff && order && ['open', 'waiting_payment'].includes(order.status)
  const hasPendingDiscount = discounts.some((a) => a.status === 'pending')
  const items = order?.items || []

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">คิดเงิน{selected ? ` · โต๊ะ ${tablesText(selected, ', ')}` : ''}</h1>
          <p className="pos-subtitle">
            {order
              ? [
                  order.guest_count ? `${order.guest_count} คน` : null,
                  order.opened_at ? `เปิดโต๊ะ ${hhmm(order.opened_at)}` : null,
                  order.opened_by_name ? `พนักงานเปิดโต๊ะ: ${order.opened_by_name}` : null,
                  order.order_no ? `บิล ${order.order_no}` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')
              : 'เลือกโต๊ะทางซ้ายเพื่อดูบิล'}
          </p>
        </div>
      </header>

      {error && (
        <div className="pos-alert">
          {error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-cashier-layout">
        {/* ---------- โต๊ะที่มีลูกค้า ---------- */}
        <section className="pos-panel" aria-label="โต๊ะที่มีลูกค้า">
          <h2 className="pos-panel-title">โต๊ะที่มีลูกค้า</h2>
          {loading ? (
            <div className="pos-skeleton" style={{ height: 200 }} />
          ) : bills.length === 0 ? (
            <div className="pos-cart-empty">ไม่มีโต๊ะที่มีลูกค้า</div>
          ) : (
            <div className="pos-bill-list">
              {bills.map((b) => {
                const pill = STATUS_PILL[b.status] || STATUS_PILL.open
                return (
                  <button key={b.id} type="button" className={`pos-bill-card is-col ${selected?.id === b.id ? 'is-active' : ''}`} onClick={() => pick(b)}>
                    <span className="pos-bill-card-row">
                      <strong>{tablesText(b, ', ')}</strong>
                      <strong>{thb(b.status === 'waiting_payment' ? b.total : (b.subtotal ?? b.total))}</strong>
                    </span>
                    <span className="pos-bill-card-row">
                      <span className="pos-line-sub">
                        {[b.guest_count ? `${b.guest_count} คน` : b.order_no, b.opened_at ? hhmm(b.opened_at) : null].filter(Boolean).join(' · ')}
                      </span>
                      <span className={`pos-pill ${pill.cls}`}>{pill.label}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          {refunds.length > 0 && (
            <>
              <h2 className="pos-panel-title" style={{ marginTop: 20 }}>
                คืนเงินที่อนุมัติแล้ว
              </h2>
              <div className="pos-bill-list">
                {refunds.map((r) => (
                  <div key={r.id} className="pos-refund-card">
                    <div className="pos-bill-card-row">
                      <strong>{r.order_no || r.order_id.slice(0, 8)}</strong>
                      <strong className="pos-danger-text" style={{ fontSize: 14 }}>
                        {thb2(r.amount)}
                      </strong>
                    </div>
                    {r.reason && <span className="pos-line-sub">{r.reason}</span>}
                    <div className="pos-bill-card-row" style={{ marginTop: 6 }}>
                      <select
                        className="pos-input pos-select-sm"
                        aria-label="วิธีคืนเงิน"
                        value={methods[r.id] || 'cash'}
                        onChange={(e) => setMethods((m) => ({ ...m, [r.id]: e.target.value }))}
                        disabled={busyRefund === r.id}
                      >
                        <option value="cash">เงินสด</option>
                        <option value="promptpay">PromptPay</option>
                      </select>
                      <button type="button" className="pos-btn pos-btn-danger" onClick={() => refund(r)} disabled={busyRefund === r.id}>
                        {busyRefund === r.id ? 'กำลังคืน…' : 'คืนเงิน'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* ---------- รายการในบิล ---------- */}
        <section className="pos-panel" aria-label="รายการในบิล">
          {selected && !order ? (
            <div className="pos-skeleton" />
          ) : !order ? (
            <div className="pos-cart-empty">ยังไม่มีบิลให้คิดเงิน</div>
          ) : (
            <>
              <div className="pos-panel-head">
                <div>
                  <h2 className="pos-panel-title" style={{ margin: 0 }}>
                    บิลโต๊ะ {tablesText(order)}
                  </h2>
                  <p className="pos-dialog-sub">
                    {items.length} รายการ · {(order.tables || []).length || 1} โต๊ะ = 1 บิล (ไม่รองรับการแยกบิล)
                  </p>
                </div>
                <button type="button" className="pos-btn" onClick={() => setPrinting(true)} disabled={!items.length}>
                  พิมพ์ใบแจ้งยอด
                </button>
              </div>

              <div className="pos-rtable-wrap">
                <table className="pos-rtable">
                  <thead>
                    <tr>
                      <th>รายการ</th>
                      <th className="is-num">จำนวน</th>
                      <th className="is-num">ราคา</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, i) => (
                      <tr key={it.id || i}>
                        <td>
                          {it.menu_name}
                          {it.options?.length > 0 && (
                            <span className="pos-line-sub">
                              {it.options
                                .map((o) => (Number(o.extra_price) > 0 ? `${o.option_name || o.name} +${thb(o.extra_price)}` : o.option_name || o.name))
                                .join(' · ')}
                            </span>
                          )}
                          {it.note && <span className="pos-line-sub">{it.note}</span>}
                        </td>
                        <td className="is-num">{it.quantity}</td>
                        <td className="is-num">{thb(lineTotal(it))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {discounts.map((a) => (
                <div key={a.id} className={`pos-approval is-${a.status}`}>
                  <span>
                    <strong>
                      ส่วนลด {a.value_type === 'percent' ? `${a.value}% (${thb(a.amount)})` : thb(a.amount)} · {a.reason}
                    </strong>
                    ขอโดย {a.requested_by_name || '—'}
                    {a.approved_by_name && ` · ${a.status === 'rejected' ? 'ปฏิเสธโดย' : 'อนุมัติโดย'} ${a.approved_by_name}`}
                    {` · ${hhmm(a.decided_at || a.requested_at)}`}
                  </span>
                  <span className={`pos-pill ${APPROVAL_STATUS[a.status]?.cls || 'is-muted'}`}>{APPROVAL_STATUS[a.status]?.label || a.status}</span>
                </div>
              ))}
            </>
          )}
        </section>

        {/* ---------- สรุปยอด ---------- */}
        <section className="pos-refund-side" aria-label="สรุปยอด">
          {order && <BillSummary order={order} />}
          {order && !waiting && (
            <p className="pos-note is-warn">โต๊ะนี้ยังสั่งอาหารอยู่ กด “เรียกเก็บเงิน” เพื่อปิดการสั่งแล้วรับเงิน (1.8)</p>
          )}
          {hasPendingDiscount && <p className="pos-note is-muted">มีคำขอส่วนลดรอผู้จัดการอนุมัติ · ส่วนลดจะเข้าบิลเมื่ออนุมัติแล้ว (1.30)</p>}

          <div className="pos-side-actions">
            {canDiscount && (
              <button type="button" className="pos-btn" onClick={() => setAskDiscount(true)} disabled={hasPendingDiscount}>
                ขอส่วนลด
              </button>
            )}
            {order &&
              (waiting ? (
                <button type="button" className="pos-btn pos-btn-primary pos-grow" onClick={() => navigate(`/checkout/${order.id}`)}>
                  ชำระเงิน
                </button>
              ) : (
                <button type="button" className="pos-btn pos-btn-primary pos-grow" onClick={bill} disabled={busy || !items.length}>
                  {busy ? 'กำลังบันทึก…' : 'เรียกเก็บเงิน'}
                </button>
              ))}
          </div>
        </section>
      </div>

      {askDiscount && order && (
        <DiscountRequestDialog
          order={order}
          onClose={() => setAskDiscount(false)}
          onSent={(approval) => {
            setAskDiscount(false)
            setDiscounts((d) => [approval, ...d])
            notify('ส่งคำขอส่วนลดแล้ว รอผู้จัดการอนุมัติ')
          }}
        />
      )}

      {printing && order && <BillPrint order={order} branchName={branchName} autoPrint onAfterPrint={donePrinting} />}

      <Toast toast={toast} />
    </div>
  )
}
