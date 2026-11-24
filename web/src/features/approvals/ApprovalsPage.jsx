import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useApprovalFeed } from '../../api/approvalFeed'
import { createRefund } from '../../api/payment'
import { APPROVAL_STATUS, APPROVAL_TYPE, POS_MOCK, approveApproval, getOrder, listApprovals, rejectApproval } from '../../api/pos'
import { VAT_RATE } from '../../lib/constants'
import { errorText } from '../../lib/format'
import { hhmm, tablesText, useToast } from '../../lib/posUtils'
import { MockBanner, Toast } from '../../components/ui/posUi'
import '../../styles/pos.css'

// คำขออนุมัติส่วนลด/คืนเงิน (manager/owner) — 1.29–1.31
// - realtime ผ่าน approvalFeed (SSE) · ถ้าหลุด poll ทุก 10 วินาที (ต่ออยู่ poll ทุก 30 วินาทีกันพลาด)
// - อนุมัติแล้วส่วนลดเข้าบิลทันที · อนุมัติคืนเงิน = บันทึกการคืนเงินลง payment ทันที (ตามวิธีคืนเงินที่เลือก)
//   ถ้าบันทึกคืนเงินไม่สำเร็จ กด "บันทึกคืนเงิน" ซ้ำได้ (หรือคืนต่อที่หน้าคิดเงิน) · ประวัติลบไม่ได้ (1.31)

const POLL_LIVE = 30_000
const POLL_OFFLINE = 10_000

const REFUND_METHODS = [
  ['cash', 'เงินสด'],
  ['promptpay', 'PromptPay'],
  ['credit_card', 'บัตรเครดิต/เดบิต'],
]

const money = new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thb2 = (n) => `${money.format(Number(n) || 0)} ฿`
const thb = (n) => `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(Number(n) || 0)} ฿`

const isToday = (v) => v && new Date(v).toDateString() === new Date().toDateString()
const when = (v) => (isToday(v) ? hhmm(v) : new Date(v).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))
const fullTime = (v) =>
  v ? new Date(v).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

/** บิลโต๊ะ T10 · ส่วนลด 100 ฿ / บิล B-0042 · คืน 90 ฿ */
function headline(a) {
  const where = a.type === 'discount' && a.tables?.length ? `บิลโต๊ะ ${tablesText(a)}` : `บิล ${a.order_no || a.order_id.slice(0, 8)}`
  return `${where} · ${a.type === 'discount' ? 'ส่วนลด' : 'คืน'} ${thb(a.amount)}`
}

/** ข้อความอ้างอิงในตารางประวัติ */
function reference(a) {
  if (a.type === 'discount') {
    const v = a.value_type === 'percent' ? `${a.value}%` : thb(a.amount)
    return `${a.tables?.length ? tablesText(a, ', ') : a.order_no} · ${v}`
  }
  return `${a.order_no || a.order_id.slice(0, 8)} · ${thb(a.amount)}`
}

export default function ApprovalsPage() {
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tab, setTab] = useState('pending')
  const [reloadKey, setReloadKey] = useState(0)
  const [order, setOrder] = useState(null) // บิลของคำขอที่เลือก (ใช้เมื่อ backend ไม่ส่งยอดบิลมากับคำขอ)
  const [note, setNote] = useState('')
  const [refundMethod, setRefundMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const [toast, notify] = useToast()

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])
  const live = useApprovalFeed(reload)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listApprovals({})
        .then((list) => {
          if (cancelled) return
          setRows(list || [])
          setError('')
        })
        .catch((err) => !cancelled && setError(errorText(err)))
        .finally(() => !cancelled && setLoading(false))
    load()
    const id = setInterval(load, live ? POLL_LIVE : POLL_OFFLINE)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [reloadKey, live])

  const pending = useMemo(() => rows.filter((a) => a.status === 'pending'), [rows])
  const history = useMemo(
    () => rows.filter((a) => a.status !== 'pending').sort((a, b) => (b.decided_at || '').localeCompare(a.decided_at || '')),
    [rows],
  )
  const list = tab === 'pending' ? pending : rows

  // คำขอที่เลือก: ?id= จากกระดิ่ง → ถ้าไม่มี เลือกคำขอแรกในแท็บ
  const wantedId = params.get('id')
  const selected = rows.find((a) => a.id === wantedId) || list[0] || null

  function select(a) {
    setParams(a ? { id: a.id } : {}, { replace: true })
    setNote('')
  }

  // ยอดบิล: ใช้ที่แนบมากับคำขอ ถ้าไม่มีค่อยเรียกบิล
  const needsOrder = selected && selected.order_subtotal == null
  const orderKey = needsOrder ? selected.order_id : ''
  useEffect(() => {
    if (!orderKey) return
    let cancelled = false
    getOrder(orderKey)
      .then((o) => !cancelled && setOrder(o))
      .catch(() => !cancelled && setOrder(null))
    return () => {
      cancelled = true
    }
  }, [orderKey])
  const billOrder = order && order.id === selected?.order_id ? order : null

  /** บันทึกการคืนเงินลง payment (Supabase) · key ผูกกับคำขอ กดซ้ำ/เน็ตหลุดก็ไม่คืนซ้ำ · คืน true ถ้าสำเร็จ */
  async function recordRefund(a) {
    try {
      await createRefund({ approval_id: a.id, method: refundMethod }, `refund-${a.id}`)
      return true
    } catch (err) {
      notify(`บันทึกคืนเงินไม่สำเร็จ — ${errorText(err)} (กด "บันทึกคืนเงิน" ซ้ำได้)`, 'error')
      return false
    }
  }

  async function recordSelectedRefund() {
    if (!selected || busy) return
    setBusy(true)
    if (await recordRefund(selected)) notify(`บันทึกคืนเงิน ${thb(selected.amount)} แล้ว`)
    reload()
    setBusy(false)
  }

  async function decide(kind) {
    if (!selected || busy) return
    if (kind === 'rejected' && !window.confirm(`ปฏิเสธคำขอ${APPROVAL_TYPE[selected.type]?.label || ''} ${thb2(selected.amount)} ?`)) return
    const isRefund = selected.type === 'refund'
    const methodLabel = REFUND_METHODS.find(([m]) => m === refundMethod)?.[1]
    if (kind === 'approved' && isRefund && !window.confirm(`อนุมัติและคืนเงิน ${thb2(selected.amount)} ด้วย${methodLabel} ?`)) return
    setBusy(true)
    try {
      const body = note.trim() ? { note: note.trim() } : {}
      if (kind === 'approved') await approveApproval(selected.id, body)
      else await rejectApproval(selected.id, body)
      // คืนเงิน: อนุมัติแล้วบันทึกการคืนเงินทันที
      const refunded = kind === 'approved' && isRefund ? await recordRefund(selected) : false
      if (kind === 'approved' && isRefund) {
        if (refunded) notify(`อนุมัติและคืนเงิน ${thb(selected.amount)} (${methodLabel}) แล้ว`)
      } else {
        notify(kind === 'approved' ? `อนุมัติ${APPROVAL_TYPE[selected.type]?.label} ${thb(selected.amount)} แล้ว` : 'ปฏิเสธคำขอแล้ว')
      }
      setNote('')
      // ไปคำขอถัดไปที่ยังรออยู่
      const next = pending.find((a) => a.id !== selected.id)
      setParams(next ? { id: next.id } : {}, { replace: true })
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
      reload() // อาจมีคนอื่นตัดสินไปแล้ว
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">คำขออนุมัติส่วนลด / คืนเงิน</h1>
          <p className="pos-subtitle">แจ้งเตือนแบบ realtime ที่เครื่องผู้จัดการและเจ้าของ</p>
        </div>
        <span className={`pos-pill ${live ? 'is-available' : 'is-muted'}`} title={live ? 'เชื่อมต่อแจ้งเตือนอยู่' : 'กำลังเชื่อมต่อใหม่ ระหว่างนี้อัปเดตทุก 10 วินาที'}>
          {live ? '● เรียลไทม์' : '○ กำลังเชื่อมต่อ…'}
        </span>
      </header>

      <MockBanner show={POS_MOCK} />
      {error && (
        <div className="pos-alert">
          {error}
          <button className="pos-link" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-approvals-layout">
        {/* ---------- รายการคำขอ ---------- */}
        <section className="pos-panel" aria-label="รายการคำขอ">
          <div className="pos-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'pending'} className={tab === 'pending' ? 'is-active' : ''} onClick={() => setTab('pending')}>
              รออนุมัติ ({pending.length})
            </button>
            <button type="button" role="tab" aria-selected={tab === 'all'} className={tab === 'all' ? 'is-active' : ''} onClick={() => setTab('all')}>
              ทั้งหมด
            </button>
          </div>

          {loading ? (
            <div className="pos-skeleton" style={{ height: 180 }} />
          ) : list.length === 0 ? (
            <div className="pos-cart-empty">{tab === 'pending' ? 'ไม่มีคำขอรออนุมัติ' : 'ยังไม่มีคำขอ'}</div>
          ) : (
            <div className="pos-bill-list">
              {list.map((a) => {
                const type = APPROVAL_TYPE[a.type] || APPROVAL_TYPE.discount
                return (
                  <button key={a.id} type="button" className={`pos-bill-card is-col ${selected?.id === a.id ? 'is-active' : ''}`} onClick={() => select(a)}>
                    <span className="pos-bill-card-row">
                      <span className={`pos-pill ${type.cls}`}>{type.label}</span>
                      <span className="pos-line-sub" style={{ display: 'inline' }}>
                        {when(a.requested_at)}
                      </span>
                    </span>
                    <strong style={{ marginTop: 4 }}>{headline(a)}</strong>
                    <span className="pos-bill-card-row">
                      <span className="pos-line-sub">
                        โดย {a.requested_by_name || '—'} · {a.reason}
                      </span>
                      {a.status !== 'pending' && <span className={`pos-pill ${APPROVAL_STATUS[a.status]?.cls}`}>{APPROVAL_STATUS[a.status]?.label}</span>}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        <div className="pos-refund-side">
          {/* ---------- รายละเอียด ---------- */}
          <section className="pos-panel" aria-label="รายละเอียดคำขอ">
            {!selected ? (
              <div className="pos-cart-empty">เลือกคำขอทางซ้ายเพื่อดูรายละเอียด</div>
            ) : (
              <Detail
                a={selected}
                order={billOrder}
                note={note}
                setNote={setNote}
                busy={busy}
                onDecide={decide}
                method={refundMethod}
                setMethod={setRefundMethod}
                onRecordRefund={recordSelectedRefund}
              />
            )}
          </section>

          {/* ---------- ประวัติ ---------- */}
          <section className="pos-panel" aria-label="ประวัติคำขอ">
            <h2 className="pos-panel-title">ประวัติคำขอทั้งหมด</h2>
            {history.length === 0 ? (
              <div className="pos-cart-empty">ยังไม่มีคำขอที่ตัดสินแล้ว</div>
            ) : (
              <div className="pos-rtable-wrap">
                <table className="pos-rtable">
                  <thead>
                    <tr>
                      <th>เวลา</th>
                      <th>ประเภท</th>
                      <th>อ้างอิง</th>
                      <th>ผู้ขอ / ผู้อนุมัติ</th>
                      <th>เหตุผล</th>
                      <th>ผล</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((a) => (
                      <tr key={a.id} className="pos-click-row" onClick={() => select(a)}>
                        <td>{when(a.decided_at || a.requested_at)}</td>
                        <td>
                          <span className={`pos-pill ${APPROVAL_TYPE[a.type]?.cls}`}>{APPROVAL_TYPE[a.type]?.label}</span>
                        </td>
                        <td>{reference(a)}</td>
                        <td>
                          {a.requested_by_name || '—'} / {a.approved_by_name || '—'}
                        </td>
                        <td>
                          {a.reason}
                          {a.note && <span className="pos-line-sub">หมายเหตุ: {a.note}</span>}
                        </td>
                        <td>
                          <span className={`pos-pill ${APPROVAL_STATUS[a.status]?.cls}`}>{a.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>

      <Toast toast={toast} />
    </div>
  )
}

/** เลือกวิธีคืนเงิน (ใช้ตอนอนุมัติ/บันทึกคืนเงิน) */
function RefundMethodPicker({ method, setMethod, busy }) {
  return (
    <>
      <span className="pos-label" style={{ fontWeight: 400, color: 'var(--app-muted)', marginTop: 14 }}>
        คืนเงินด้วย
      </span>
      <div className="pos-chips" role="radiogroup" aria-label="วิธีคืนเงิน">
        {REFUND_METHODS.map(([m, label]) => (
          <button key={m} type="button" role="radio" aria-checked={method === m} className={`pos-chip ${method === m ? 'is-active' : ''}`} onClick={() => setMethod(m)} disabled={busy}>
            {label}
          </button>
        ))}
      </div>
    </>
  )
}

function Detail({ a, order, note, setNote, busy, onDecide, method, setMethod, onRecordRefund }) {
  const isDiscount = a.type === 'discount'
  // อนุมัติแล้วแต่ยังไม่ได้บันทึกคืนเงิน (เช่น อนุมัติก่อนมีระบบคืนทันที หรือบันทึกไม่สำเร็จ)
  const awaitingRefund = !isDiscount && a.status === 'approved' && !a.refunded_at
  const subtotal = Number(a.order_subtotal ?? order?.subtotal ?? NaN)
  const paidTotal = Number(a.order_total ?? order?.total ?? NaN)
  const existingDiscount = Number(a.order_discount ?? order?.discount_amount ?? 0)
  const pending = a.status === 'pending'
  // รออนุมัติ: ยอดสุทธิถ้าอนุมัติ ตาม 1.24 = (ยอดรวมรายการ − ส่วนลดเดิม − ส่วนลดนี้) × 1.07
  // ตัดสินแล้ว: ยอดสุทธิปัจจุบันของบิล (ส่วนลดที่อนุมัติรวมอยู่แล้ว)
  const newNet = !pending
    ? paidTotal
    : Number.isFinite(subtotal)
      ? Math.round((subtotal - existingDiscount - a.amount) * (1 + VAT_RATE) * 100) / 100
      : NaN
  const where = isDiscount && a.tables?.length ? `บิลโต๊ะ ${tablesText(a)}` : `บิล ${a.order_no || a.order_id.slice(0, 8)}`

  return (
    <>
      <div className="pos-panel-head" style={{ marginBottom: 10 }}>
        <div>
          <h2 className="pos-panel-title" style={{ margin: 0 }}>
            คำขอ{isDiscount ? 'ส่วนลด' : 'คืนเงิน'} #{a.request_no || a.id.slice(0, 8)}
          </h2>
          <p className="pos-dialog-sub">
            {where}
            {a.branch_name ? ` · ${a.branch_name}` : ''}
          </p>
        </div>
        {!pending && <span className={`pos-pill ${APPROVAL_STATUS[a.status]?.cls}`}>{APPROVAL_STATUS[a.status]?.label}</span>}
      </div>

      <div className="pos-detail-grid">
        <dl>
          <div>
            <dt>ผู้ขอ</dt>
            <dd>{a.requested_by_name || '—'}</dd>
          </div>
          <div>
            <dt>เวลา</dt>
            <dd>{fullTime(a.requested_at)}</dd>
          </div>
          <div>
            <dt>เหตุผล</dt>
            <dd>{a.reason}</dd>
          </div>
        </dl>
        <dl>
          {isDiscount ? (
            <>
              <div>
                <dt>ยอดรวมรายการ</dt>
                <dd>{Number.isFinite(subtotal) ? thb2(subtotal) : '—'}</dd>
              </div>
              <div>
                <dt>ส่วนลดที่ขอ</dt>
                <dd>
                  {thb2(a.amount)} ({a.value_type === 'percent' ? `${a.value}%` : 'เป็นบาท'})
                </dd>
              </div>
              <div>
                <dt>{pending ? 'ยอดสุทธิหลังหัก (รวม VAT)' : 'ยอดสุทธิของบิล (รวม VAT)'}</dt>
                <dd>{Number.isFinite(newNet) ? thb2(newNet) : '—'}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>ยอดที่ลูกค้าจ่าย</dt>
                <dd>{Number.isFinite(paidTotal) ? thb2(paidTotal) : '—'}</dd>
              </div>
              <div>
                <dt>ยอดคืน</dt>
                <dd className="pos-danger-text" style={{ fontSize: 15 }}>
                  {thb2(a.amount)}
                </dd>
              </div>
              <div>
                <dt>รายการที่คืน</dt>
                <dd>
                  {a.refund_items?.length
                    ? a.refund_items.map((r) => `${r.menu_name || 'รายการ'} ×${r.quantity}`).join(', ')
                    : 'ทั้งบิล'}
                </dd>
              </div>
            </>
          )}
        </dl>
      </div>

      {pending ? (
        <>
          <label className="pos-label" htmlFor="pos-approval-note" style={{ fontWeight: 400, color: 'var(--app-muted)', marginTop: 14 }}>
            หมายเหตุถึงพนักงาน (ไม่บังคับ)
          </label>
          <input
            id="pos-approval-note"
            className="pos-input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={200}
            placeholder="พิมพ์หมายเหตุ…"
            disabled={busy}
          />
          {!isDiscount && (
            <>
              <RefundMethodPicker method={method} setMethod={setMethod} busy={busy} />
              <p className="pos-note is-muted" style={{ marginTop: 10 }}>
                กดอนุมัติ = บันทึกการคืนเงินทันที (ยอดขายลดลง) · ส่งเงินคืนลูกค้าตามวิธีที่เลือก · คืนเงินไม่คืนสต็อก
              </p>
            </>
          )}
          <div className="pos-dialog-actions">
            <button type="button" className="pos-btn pos-btn-danger-solid" onClick={() => onDecide('rejected')} disabled={busy}>
              ปฏิเสธ
            </button>
            <button type="button" className="pos-btn pos-btn-primary" onClick={() => onDecide('approved')} disabled={busy}>
              {busy ? 'กำลังบันทึก…' : isDiscount ? 'อนุมัติ' : 'อนุมัติและคืนเงิน'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="pos-note is-muted" style={{ marginTop: 14 }}>
            {a.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ'}โดย {a.approved_by_name || '—'} · {fullTime(a.decided_at)}
            {a.note && ` · หมายเหตุ: ${a.note}`}
            {!isDiscount && a.refunded_at && ` · คืนเงินแล้ว ${fullTime(a.refunded_at)}`}
          </p>
          {awaitingRefund && (
            <>
              <p className="pos-note is-warn">อนุมัติแล้วแต่ยังไม่ได้บันทึกการคืนเงิน</p>
              <RefundMethodPicker method={method} setMethod={setMethod} busy={busy} />
              <div className="pos-dialog-actions">
                <button type="button" className="pos-btn pos-btn-primary" onClick={onRecordRefund} disabled={busy}>
                  {busy ? 'กำลังบันทึก…' : `บันทึกคืนเงิน ${thb2(a.amount)}`}
                </button>
              </div>
            </>
          )}
        </>
      )}
    </>
  )
}
