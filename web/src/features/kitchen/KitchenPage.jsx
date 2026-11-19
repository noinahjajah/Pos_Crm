import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { POS_MOCK, listKitchenTickets, updateKitchenTicket } from '../../api/pos'
import { errorText } from '../../lib/format'
import { hhmm, useNow, useToast } from '../../lib/posUtils'
import { MockBanner, Toast } from '../../components/ui/posUi'
import '../../styles/pos.css'

// จอครัว: ตั๋วออร์เดอร์ที่ส่งเข้าครัว เก่าสุดก่อน (ทำตามลำดับ)
// pending (รอทำ) → preparing (กำลังทำ) → served (เสิร์ฟแล้ว) ย้อนกลับไม่ได้
// รีเฟรชเองทุก 10 วินาที — เสียงแจ้งเตือนเมื่อมีตั๋วใหม่เข้ามา (กดปุ่มเสียงเพื่อเปิด/ปิด)

const REFRESH_MS = 10_000
const LATE_MIN = 15 // รอเกินกี่นาทีให้ขึ้นสีเตือน

const FILTERS = [
  { id: 'active', label: 'ที่ต้องทำ', status: 'pending,preparing' },
  { id: 'pending', label: 'รอทำ', status: 'pending' },
  { id: 'preparing', label: 'กำลังทำ', status: 'preparing' },
  { id: 'served', label: 'เสิร์ฟแล้ว', status: 'served' },
]
const STATUS = {
  pending: { label: 'รอทำ', cls: 'is-waiting', next: 'preparing', action: 'เริ่มทำ' },
  preparing: { label: 'กำลังทำ', cls: 'is-occupied', next: 'served', action: 'เสิร์ฟแล้ว' },
  served: { label: 'เสิร์ฟแล้ว', cls: 'is-available', next: null, action: null },
}

const tableText = (t) => (t.tables || []).map((x) => (typeof x === 'string' ? x : x.table_no)).filter(Boolean).join(', ') || '-'

/** เสียงสั้น ๆ ตอนมีตั๋วใหม่ (สร้างด้วย Web Audio ไม่ต้องมีไฟล์เสียง) */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = 880
    gain.gain.value = 0.15
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.25)
    osc.onended = () => ctx.close()
  } catch {
    /* เบราว์เซอร์ไม่อนุญาตเสียงก่อนผู้ใช้กดอะไร — ข้ามได้ */
  }
}

export default function KitchenPage() {
  const now = useNow(15_000)
  const [filter, setFilter] = useState('active')
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState(null)
  const [sound, setSound] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [toast, notify] = useToast()
  const seen = useRef(null) // id ตั๋วที่เคยเห็นแล้ว (null = ยังไม่โหลดครั้งแรก ไม่ต้องส่งเสียง)
  const soundRef = useRef(sound)
  useEffect(() => {
    soundRef.current = sound
  }, [sound])

  const status = FILTERS.find((f) => f.id === filter).status

  useEffect(() => {
    let cancelled = false
    const load = () =>
      listKitchenTickets(status)
        .then((rows) => {
          if (cancelled) return
          const list = rows || []
          setTickets(list)
          setError('')
          if (status.includes('pending')) {
            const ids = new Set(list.filter((t) => t.status === 'pending').map((t) => t.id))
            if (seen.current && soundRef.current && [...ids].some((id) => !seen.current.has(id))) beep()
            seen.current = ids
          }
        })
        .catch((err) => !cancelled && setError(errorText(err)))
        .finally(() => !cancelled && setLoading(false))
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [status, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  async function advance(ticket) {
    const next = STATUS[ticket.status]?.next
    if (!next) return
    setBusyId(ticket.id)
    try {
      await updateKitchenTicket(ticket.id, next)
      notify(next === 'served' ? `โต๊ะ ${tableText(ticket)} รอบ ${ticket.round_no} เสิร์ฟแล้ว` : `เริ่มทำโต๊ะ ${tableText(ticket)} รอบ ${ticket.round_no}`)
      reload()
    } catch (err) {
      notify(errorText(err), 'error')
      reload() // สถานะอาจถูกเครื่องอื่นเปลี่ยนไปแล้ว โหลดใหม่
    } finally {
      setBusyId(null)
    }
  }

  const counts = useMemo(() => {
    const c = { pending: 0, preparing: 0 }
    for (const t of tickets) if (c[t.status] !== undefined) c[t.status] += 1
    return c
  }, [tickets])

  return (
    <div className="pos-page">
      <header className="pos-header">
        <div>
          <h1 className="pos-title">จอครัว</h1>
          <p className="pos-subtitle">เรียงตามเวลาที่สั่ง เก่าสุดก่อน · รีเฟรชอัตโนมัติทุก {REFRESH_MS / 1000} วินาที</p>
        </div>
        <div className="pos-header-actions">
          <button type="button" className={`pos-btn ${sound ? 'pos-btn-primary' : ''}`} onClick={() => setSound((v) => !v)} aria-pressed={sound}>
            {sound ? '🔔 เสียงแจ้งเตือน: เปิด' : '🔕 เสียงแจ้งเตือน: ปิด'}
          </button>
          <button type="button" className="pos-btn" onClick={reload}>
            รีเฟรช
          </button>
        </div>
      </header>

      <MockBanner show={POS_MOCK} />

      {error && (
        <div className="pos-alert">
          {error}
          <button type="button" className="pos-btn" onClick={reload}>
            ลองใหม่
          </button>
        </div>
      )}

      <div className="pos-toolbar">
        <div className="pos-pills" role="tablist" aria-label="กรองตั๋ว">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              className={`pos-btn pos-k-filter ${filter === f.id ? 'pos-btn-primary' : ''}`}
              onClick={() => {
                setLoading(true)
                setFilter(f.id)
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="pos-pills" aria-label="สรุป">
          <span className="pos-pill is-waiting">รอทำ {counts.pending}</span>
          <span className="pos-pill is-occupied">กำลังทำ {counts.preparing}</span>
        </div>
      </div>

      {loading ? (
        <div className="pos-skeleton" />
      ) : tickets.length === 0 ? (
        !error && <div className="pos-empty">{filter === 'served' ? 'ยังไม่มีตั๋วที่เสิร์ฟแล้ว' : 'ไม่มีออร์เดอร์ค้าง 🎉'}</div>
      ) : (
        <div className="pos-k-grid">
          {tickets.map((t) => (
            <TicketCard key={t.id} ticket={t} now={now} busy={busyId === t.id} onAdvance={() => advance(t)} />
          ))}
        </div>
      )}

      <Toast toast={toast} />
    </div>
  )
}

function TicketCard({ ticket: t, now, busy, onAdvance }) {
  const st = STATUS[t.status] || STATUS.pending
  const minutes = Math.max(0, Math.floor((now - new Date(t.created_at)) / 60_000))
  const late = t.status !== 'served' && minutes >= LATE_MIN
  const qty = (t.items || []).reduce((s, i) => s + Number(i.quantity || 0), 0)

  return (
    <article className={`pos-k-card ${late ? 'is-late' : ''} is-${t.status}`} aria-label={`โต๊ะ ${tableText(t)} รอบ ${t.round_no} ${st.label}`}>
      <header className="pos-k-head">
        <div>
          <div className="pos-k-table">โต๊ะ {tableText(t)}</div>
          <div className="pos-k-meta">
            {t.order_no ? `${t.order_no} · ` : ''}รอบ {t.round_no}
            {t.guest_count ? ` · ${t.guest_count} คน` : ''}
          </div>
        </div>
        <span className={`pos-pill ${st.cls}`}>{st.label}</span>
      </header>

      <div className="pos-k-time">
        สั่งเมื่อ {hhmm(t.created_at)} · <strong className={late ? 'is-late' : ''}>{minutes < 1 ? 'เมื่อกี้' : `${minutes} นาทีที่แล้ว`}</strong>
        {t.created_by_name ? ` · ${t.created_by_name}` : ''}
      </div>

      <ul className="pos-k-items">
        {(t.items || []).map((it) => (
          <li key={it.id}>
            <span className="pos-k-qty">{it.quantity}×</span>
            <div>
              <div className="pos-k-name">{it.menu_name}</div>
              {(it.options || []).length > 0 && <div className="pos-k-opt">{it.options.map((o) => o.option_name || o.name).join(' · ')}</div>}
              {it.note && <div className="pos-k-note">หมายเหตุ: {it.note}</div>}
            </div>
          </li>
        ))}
      </ul>

      <footer className="pos-k-foot">
        <span className="pos-k-total">{qty} รายการ</span>
        {st.next && (
          <button type="button" className="pos-btn pos-btn-primary" onClick={onAdvance} disabled={busy}>
            {busy ? 'กำลังบันทึก…' : st.action}
          </button>
        )}
      </footer>
    </article>
  )
}
