import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useBlocker, useNavigate, useParams } from 'react-router'
import { getMenu, listMenus } from '../../api/catalog'
import { APPROVAL_STATUS, POS_MOCK, cancelOrder, getOrder, itemsAmount, lineAmount, listApprovals, requestPayment, sendTicket } from '../../api/pos'
import KitchenTicketPrint from '../../components/print/KitchenTicketPrint'
import { errorText } from '../../lib/format'
import { useAuth } from '../auth/AuthContext'
import DiscountRequestDialog from '../approvals/DiscountRequestDialog'
import { hhmm, tablesText, thb, useBranchName, useToast } from '../../lib/posUtils'
import { ConfirmDialog, MockBanner, Stepper, Toast } from '../../components/ui/posUi'
import MenuOptionDialog from './MenuOptionDialog'
import TicketSentDialog from './TicketSentDialog'
import '../../styles/pos.css'

// รับออร์เดอร์ (1.9, 1.10, 1.20, 1.21)
// - เลือกเมนู → (มีตัวเลือก) เลือกตัวเลือก/หมายเหตุ → ลงตะกร้ารอบนี้
// - "ส่งเข้าครัว" = สร้างตั๋วครัว 1 รอบ (backend ตัดสต็อก + snapshot ชื่อ/ราคา) แล้วพิมพ์ใบออร์เดอร์
// - เมนูสต็อกหมด/ปิดขาย กดไม่ได้

const ALL = '__all__'

/** รายการเดียวกัน = เมนู ตัวเลือก หมายเหตุ ตรงกัน → รวมจำนวน */
const lineKey = (it) =>
  [it.menu_id, (it.options || []).map((o) => o.option_id).sort().join(','), (it.note || '').trim()].join('|')

const optionText = (it) =>
  (it.options || []).map((o) => (Number(o.extra_price) > 0 ? `${o.option_name} +${thb(o.extra_price)}` : o.option_name)).join(' · ')

const soldOut = (m) => !m.is_available || Number(m.quantity) <= 0

export default function OrderPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, isStaff } = useAuth()
  const branchName = useBranchName()
  const [order, setOrder] = useState(null)
  const [discounts, setDiscounts] = useState([]) // คำขอส่วนลดของบิลนี้
  const [askDiscount, setAskDiscount] = useState(false)
  const [closing, setClosing] = useState(false)
  const [billing, setBilling] = useState(false)
  const [confirm, setConfirm] = useState(null) // 'bill' | 'close' — หน้าต่างยืนยัน
  const [menus, setMenus] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [category, setCategory] = useState(ALL)
  const [q, setQ] = useState('')
  const [cart, setCart] = useState([])
  const [dialog, setDialog] = useState(null) // { menu, initial?, index? }
  const [loadingMenuId, setLoadingMenuId] = useState(null)
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(null) // ตั๋วที่เพิ่งส่ง
  const [printing, setPrinting] = useState(null) // ตั๋วที่กำลังพิมพ์
  const [toast, notify] = useToast()
  const menuCache = useRef(new Map())
  // ต้องคงที่ — PrintSlip สั่งพิมพ์ใหม่ทุกครั้งที่ onAfterPrint เปลี่ยน
  const donePrinting = useCallback(() => setPrinting(null), [])

  // ---------- โหลดบิล + เมนู ----------
  const loadOrder = useCallback(() => getOrder(id).then(setOrder), [id])
  const loadMenus = useCallback(() => listMenus().then((rows) => setMenus(rows || [])), [])
  const loadDiscounts = useCallback(
    () => listApprovals({ order_id: id, type: 'discount' }).then((rows) => setDiscounts(rows || [])),
    [id],
  )

  useEffect(() => {
    let cancelled = false
    Promise.all([getOrder(id), listMenus(), listApprovals({ order_id: id, type: 'discount' }).catch(() => [])])
      .then(([o, m, a]) => {
        if (cancelled) return
        setOrder(o)
        setMenus(m || [])
        setDiscounts(a || [])
        setError('')
      })
      .catch((err) => !cancelled && setError(errorText(err)))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  // ---------- เตือนก่อนออกจากหน้าเมื่อยังไม่ได้ส่งครัว ----------
  const dirty = cart.length > 0 && !sending
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname)
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    if (window.confirm('ยังมีรายการที่ยังไม่ได้ส่งเข้าครัว ออกจากหน้านี้เลยไหม?')) blocker.proceed()
    else blocker.reset()
  }, [blocker])
  useEffect(() => {
    if (!dirty) return
    const onUnload = (e) => e.preventDefault()
    window.addEventListener('beforeunload', onUnload)
    return () => window.removeEventListener('beforeunload', onUnload)
  }, [dirty])

  // ---------- เมนู ----------
  const categories = useMemo(() => {
    const seen = new Map()
    for (const m of menus) if (m.category_id && !seen.has(m.category_id)) seen.set(m.category_id, m.category_name || 'อื่น ๆ')
    return [...seen.entries()]
  }, [menus])

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase()
    return menus.filter((m) => (category === ALL || m.category_id === category) && (!term || m.name.toLowerCase().includes(term)))
  }, [menus, category, q])

  const menuById = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus])

  /** จำนวนที่ยังเพิ่มลงตะกร้าได้ (สต็อก − ที่อยู่ในตะกร้าแล้ว ยกเว้นแถว exceptIndex) */
  const remaining = useCallback(
    (menuId, exceptIndex = -1) => {
      const stock = Number(menuById.get(menuId)?.quantity ?? 99)
      const inCart = cart.reduce((s, it, i) => (it.menu_id === menuId && i !== exceptIndex ? s + it.quantity : s), 0)
      return Math.max(0, stock - inCart)
    },
    [cart, menuById],
  )

  function addLine(line) {
    setCart((c) => {
      const key = lineKey(line)
      const i = c.findIndex((it) => lineKey(it) === key)
      if (i === -1) return [...c, line]
      return c.map((it, idx) => (idx === i ? { ...it, quantity: it.quantity + line.quantity } : it))
    })
  }

  async function pickMenu(m) {
    if (soldOut(m)) return
    if (remaining(m.id) <= 0) {
      notify(`${m.name} เหลือ ${m.quantity} ที่ ใส่ตะกร้าครบแล้ว`, 'error')
      return
    }
    setLoadingMenuId(m.id)
    try {
      let detail = menuCache.current.get(m.id)
      if (!detail) {
        detail = await getMenu(m.id)
        menuCache.current.set(m.id, detail)
      }
      if ((detail.option_groups || []).some((g) => g.options?.length)) {
        setDialog({ menu: { ...detail, option_groups: detail.option_groups.filter((g) => g.options?.length) } })
      } else {
        addLine({ menu_id: m.id, menu_name: m.name, unit_price: Number(m.price), quantity: 1, note: '', options: [] })
      }
    } catch (err) {
      notify(errorText(err), 'error')
    } finally {
      setLoadingMenuId(null)
    }
  }

  function editLine(index) {
    const line = cart[index]
    const detail = menuCache.current.get(line.menu_id)
    if (!detail?.option_groups?.length) return
    setDialog({ menu: { ...detail, option_groups: detail.option_groups.filter((g) => g.options?.length) }, initial: line, index })
  }

  function submitDialog(line) {
    const { index } = dialog
    if (index === undefined) addLine(line)
    else setCart((c) => c.map((it, i) => (i === index ? line : it)))
    setDialog(null)
  }

  function setQty(index, qty) {
    setCart((c) => (qty <= 0 ? c.filter((_, i) => i !== index) : c.map((it, i) => (i === index ? { ...it, quantity: qty } : it))))
  }

  // ---------- ส่งครัว ----------
  async function send() {
    if (!cart.length || sending) return
    setSending(true)
    try {
      const ticket = await sendTicket(order.id, cart)
      setCart([])
      setSent(ticket)
      setPrinting(ticket)
      // สต็อกเปลี่ยน → โหลดใหม่ (ไม่ต้องรอ)
      menuCache.current.clear()
      Promise.all([loadOrder(), loadMenus()]).catch(() => {})
    } catch (err) {
      notify(errorText(err), 'error')
      loadMenus().catch(() => {}) // เผื่อสต็อกหมดระหว่างสั่ง
    } finally {
      setSending(false)
    }
  }

  // ปิดโต๊ะที่เปิดไว้แต่ลูกค้าไม่สั่ง (ยังไม่เคยส่งอะไรเข้าครัว) → โต๊ะกลับเป็นว่าง
  async function closeEmptyTable() {
    setClosing(true)
    try {
      await cancelOrder(order.id)
      navigate('/tables')
    } catch (err) {
      notify(errorText(err), 'error')
      setClosing(false)
      setConfirm(null)
    }
  }

  async function bill() {
    setBilling(true)
    try {
      await requestPayment(order.id)
      navigate(`/checkout/${order.id}`)
    } catch (err) {
      notify(errorText(err), 'error')
      setBilling(false)
      setConfirm(null)
    }
  }

  // ---------- แสดงผล ----------
  if (loading) {
    return (
      <div className="pos-page">
        <div className="pos-skeleton" />
      </div>
    )
  }
  if (error || !order) {
    return (
      <div className="pos-page">
        <div className="pos-alert">
          {error || 'ไม่พบบิล'}
          <Link className="pos-btn" to="/tables">
            กลับผังโต๊ะ
          </Link>
        </div>
      </div>
    )
  }

  const tables = tablesText(order)
  const tickets = order.tickets || []
  const round = tickets.length + 1
  const draftTotal = itemsAmount(cart)
  const sentTotal = order.subtotal ?? tickets.reduce((s, t) => s + itemsAmount(t.items), 0)
  const isOpen = order.status === 'open'
  const staffName = user?.full_name || user?.username || ''

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">รับออร์เดอร์ · โต๊ะ {tables}</h1>
          <p className="pos-subtitle">
            {order.guest_count} คน · เปิดโต๊ะ {hhmm(order.opened_at)}
            {isOpen && ` · กำลังสั่งรอบที่ ${round}`}
          </p>
        </div>
      </header>

      <MockBanner show={POS_MOCK} />

      {!isOpen && (
        <div className="pos-alert">
          บิลนี้{order.status === 'waiting_payment' ? 'เรียกเก็บเงินแล้ว' : 'ปิดแล้ว'} สั่งอาหารเพิ่มไม่ได้
          {order.status === 'waiting_payment' ? (
            <Link className="pos-btn" to={`/checkout/${order.id}`}>
              ไปหน้าคิดเงิน
            </Link>
          ) : (
            <Link className="pos-btn" to="/tables">
              กลับผังโต๊ะ
            </Link>
          )}
        </div>
      )}

      <div className="pos-order-layout">
        {/* ---------- เมนู ---------- */}
        <section aria-label="เมนู">
          <div className="pos-menu-toolbar">
            <div className="pos-chips" role="tablist" aria-label="หมวดหมู่">
              <button type="button" className={`pos-chip ${category === ALL ? 'is-active' : ''}`} onClick={() => setCategory(ALL)}>
                ทั้งหมด
              </button>
              {categories.map(([cid, name]) => (
                <button key={cid} type="button" className={`pos-chip ${category === cid ? 'is-active' : ''}`} onClick={() => setCategory(cid)}>
                  {name}
                </button>
              ))}
            </div>
            <input className="pos-search" type="search" placeholder="ค้นหาเมนู" value={q} onChange={(e) => setQ(e.target.value)} aria-label="ค้นหาเมนู" />
          </div>

          {shown.length === 0 ? (
            <div className="pos-empty">{menus.length ? 'ไม่พบเมนูที่ค้นหา' : 'สาขานี้ยังไม่มีเมนู'}</div>
          ) : (
            <div className="pos-menu-grid">
              {shown.map((m) => {
                const out = soldOut(m)
                return (
                  <button
                    key={m.id}
                    type="button"
                    className="pos-menu-card"
                    onClick={() => pickMenu(m)}
                    disabled={out || !isOpen || loadingMenuId === m.id}
                    aria-label={`${m.name} ${thb(m.price)}${out ? ' หมด' : ''}`}
                  >
                    <div className="pos-menu-thumb">
                      {m.image_url ? <img src={m.image_url} alt="" loading="lazy" /> : <span>รูปเมนู</span>}
                      {out && <span className="pos-soldout">หมด</span>}
                    </div>
                    <div className="pos-menu-body">
                      <div className="pos-menu-name">{m.name}</div>
                      <div className="pos-menu-price">{thb(m.price)}</div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          <p className="pos-hint">เมนูที่สต็อกหมดจะขึ้น “หมด” และกดสั่งไม่ได้ · เมนูที่มีตัวเลือกเสริมจะให้เลือกก่อนเพิ่ม</p>
        </section>

        {/* ---------- ออร์เดอร์ ---------- */}
        <aside className="pos-cart" aria-label="ออร์เดอร์">
          <h2 className="pos-cart-title">ออร์เดอร์โต๊ะ {tables}</h2>
          <p className="pos-dialog-sub">
            {order.guest_count} คน · เปิดโต๊ะ {hhmm(order.opened_at)}
          </p>

          <div className="pos-cart-scroll">
            {tickets.map((t) => (
              <div key={t.id} className="pos-round">
                <div className="pos-round-head">
                  <span>
                    รอบ {t.round_no} · {hhmm(t.created_at)}
                  </span>
                  <span className={`pos-pill ${t.status === 'served' ? 'is-muted' : 'is-available'}`}>
                    {t.status === 'served' ? 'เสิร์ฟแล้ว' : 'ส่งครัวแล้ว'}
                  </span>
                </div>
                {(t.items || []).map((it, i) => (
                  <div key={it.id || i} className="pos-line">
                    <span className="pos-line-qty">{it.quantity}x</span>
                    <span>
                      {it.menu_name}
                      {it.options?.length > 0 && <span className="pos-line-sub">{optionText(it)}</span>}
                      {it.note && <span className="pos-line-sub">{it.note}</span>}
                    </span>
                    <span>{thb(lineAmount(it))}</span>
                  </div>
                ))}
              </div>
            ))}

            {isOpen && (
              <div className="pos-round">
                <div className="pos-round-head">
                  <span>รอบ {round} · กำลังสั่ง</span>
                  <span className="pos-pill is-occupied">ยังไม่ส่ง</span>
                </div>
                {cart.length === 0 ? (
                  <div className="pos-cart-empty">แตะเมนูทางซ้ายเพื่อเพิ่มรายการ</div>
                ) : (
                  cart.map((it, i) => (
                    <div key={`${i}-${lineKey(it)}`} className="pos-draft-line">
                      <Stepper
                        value={it.quantity}
                        onChange={(v) => setQty(i, v)}
                        min={0}
                        max={it.quantity + remaining(it.menu_id)}
                        size="sm"
                      />
                      <span
                        className="pos-line-name"
                        onClick={() => editLine(i)}
                        title={it.options?.length ? 'แตะเพื่อแก้ตัวเลือก' : undefined}
                      >
                        {it.menu_name}
                        {it.options?.length > 0 && <span className="pos-line-sub">{optionText(it)}</span>}
                        {it.note && <span className="pos-line-note">หมายเหตุ: {it.note}</span>}
                      </span>
                      <strong>{thb(lineAmount(it))}</strong>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="pos-cart-foot">
            <div className="pos-sum">
              <span>รอบนี้</span>
              <span>{thb(draftTotal)}</span>
            </div>
            {Number(order.discount_amount) > 0 && (
              <div className="pos-sum">
                <span>ส่วนลด (อนุมัติแล้ว)</span>
                <span>-{thb(order.discount_amount)}</span>
              </div>
            )}
            <div className="pos-sum is-total">
              <span>
                ยอดรวมทั้งโต๊ะ <small className="pos-muted" style={{ fontSize: 12, fontWeight: 400 }}>ก่อน VAT</small>
              </span>
              <strong>{thb(Number(sentTotal) - Number(order.discount_amount || 0) + draftTotal)}</strong>
            </div>
            {discounts.map((a) => (
              <div key={a.id} className="pos-approval">
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
            <button type="button" className="pos-btn pos-btn-primary pos-btn-block" onClick={send} disabled={!isOpen || !cart.length || sending}>
              {sending ? 'กำลังส่ง…' : 'ส่งเข้าครัว & พิมพ์ใบออร์เดอร์'}
            </button>
            <div className="pos-cart-links">
              <Link className="pos-btn" to="/tables">
                ← ผังโต๊ะ
              </Link>
              {isStaff && ['open', 'waiting_payment'].includes(order.status) && (
                <button
                  type="button"
                  className="pos-btn"
                  onClick={() => setAskDiscount(true)}
                  disabled={!tickets.length || discounts.some((a) => a.status === 'pending')}
                  title={discounts.some((a) => a.status === 'pending') ? 'มีคำขอส่วนลดรออนุมัติอยู่' : undefined}
                >
                  ขอส่วนลด
                </button>
              )}
              {isOpen && (
                <button type="button" className="pos-btn" onClick={() => setConfirm('bill')} disabled={!tickets.length || cart.length > 0} title={cart.length ? 'ส่งรายการที่ค้างเข้าครัวก่อน' : undefined}>
                  เรียกเก็บเงิน
                </button>
              )}
            </div>
            {isOpen && tickets.length === 0 && (
              <button type="button" className="pos-btn pos-btn-danger pos-btn-block pos-close-table" onClick={() => setConfirm('close')} disabled={closing || sending}>
                {closing ? 'กำลังปิดโต๊ะ…' : 'ปิดโต๊ะ (ลูกค้าไม่ได้สั่ง)'}
              </button>
            )}
          </div>
        </aside>
      </div>

      {dialog && (
        <MenuOptionDialog
          menu={dialog.menu}
          initial={dialog.initial}
          maxQty={remaining(dialog.menu.id, dialog.index ?? -1)}
          onClose={() => setDialog(null)}
          onSubmit={submitDialog}
        />
      )}

      {askDiscount && (
        <DiscountRequestDialog
          order={order}
          onClose={() => setAskDiscount(false)}
          onSent={() => {
            setAskDiscount(false)
            notify('ส่งคำขอส่วนลดแล้ว รอผู้จัดการอนุมัติ')
            loadDiscounts().catch(() => {})
          }}
        />
      )}

      {confirm === 'bill' && (
        <ConfirmDialog
          title={`เรียกเก็บเงินโต๊ะ ${tables}`}
          subtitle="หลังจากนี้จะสั่งอาหารเพิ่มไม่ได้"
          confirmLabel="เรียกเก็บเงิน"
          busy={billing}
          onConfirm={bill}
          onCancel={() => setConfirm(null)}
        >
          <div className="pos-infobox">
            <div>
              <span>โต๊ะ</span>
              <strong>{tables}</strong>
            </div>
            <div>
              <span>จำนวนรายการ</span>
              <strong>{tickets.reduce((s, t) => s + (t.items || []).reduce((q, it) => q + Number(it.quantity || 0), 0), 0)} รายการ · {tickets.length} รอบ</strong>
            </div>
            <div>
              <span>ยอดก่อน VAT</span>
              <strong>{thb(sentTotal)}</strong>
            </div>
            {Number(order.discount_amount) > 0 && (
              <div>
                <span>ส่วนลด</span>
                <strong>-{thb(order.discount_amount)}</strong>
              </div>
            )}
          </div>
          <p className="pos-dialog-sub" style={{ marginTop: 10 }}>ระบบจะคิด VAT 7% และพาไปหน้าคิดเงินต่อ</p>
        </ConfirmDialog>
      )}

      {confirm === 'close' && (
        <ConfirmDialog
          title={`ปิดโต๊ะ ${tables}`}
          subtitle="ลูกค้าไม่ได้สั่งอาหาร — บิลนี้จะถูกยกเลิกและโต๊ะกลับเป็นว่าง"
          confirmLabel="ปิดโต๊ะ"
          danger
          busy={closing}
          onConfirm={closeEmptyTable}
          onCancel={() => setConfirm(null)}
        >
          {cart.length > 0 && <p className="pos-note is-warn">รายการที่เลือกไว้แต่ยังไม่ได้ส่งเข้าครัว {cart.length} รายการ จะถูกล้างทิ้ง</p>}
        </ConfirmDialog>
      )}

      {sent && (
        <TicketSentDialog
          ticket={sent}
          order={order}
          branchName={branchName}
          staffName={staffName}
          onPrint={() => setPrinting(sent)}
          onBack={() => navigate('/tables')}
          onClose={() => setSent(null)}
        />
      )}

      {printing && (
        <KitchenTicketPrint
          ticket={{ created_by_name: staffName, ...printing }}
          order={order}
          branchName={branchName}
          autoPrint
          onAfterPrint={donePrinting}
        />
      )}

      <Toast toast={toast} />
    </div>
  )
}
