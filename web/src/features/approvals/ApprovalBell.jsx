import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useApprovalFeed } from '../../api/approvalFeed'
import { listApprovals } from '../../api/pos'
import '../../styles/pos.css' // อยู่บนแถบบนทุกหน้า ต้องโหลดสไตล์เอง

// กระดิ่งบนแถบบนของผู้จัดการ/เจ้าของ (1.29)
// - ตัวเลข = คำขอที่รออนุมัติ · กด → หน้าคำขออนุมัติ
// - มีคำขอใหม่เข้ามา → การ์ดแจ้งเตือนมุมขวาบน 8 วินาที (ทุกหน้า ไม่ต้องเปิดหน้าอนุมัติค้างไว้)

const POLL_LIVE = 60_000
const POLL_OFFLINE = 15_000
const POPUP_MS = 8000

const thb = (n) => `${new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(Number(n) || 0)} ฿`

function BellIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

export default function ApprovalBell() {
  const navigate = useNavigate()
  const [count, setCount] = useState(0)
  const [popup, setPopup] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const seen = useRef(null) // id คำขอที่เคยเห็นแล้ว (null = ยังไม่โหลดครั้งแรก ไม่เด้งของเก่า)
  const timer = useRef(null)

  const show = useCallback((a) => {
    clearTimeout(timer.current)
    setPopup(a)
    timer.current = setTimeout(() => setPopup(null), POPUP_MS)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])

  const onEvent = useCallback(
    ({ approval }) => {
      if (approval?.status === 'pending' && seen.current && !seen.current.has(approval.id)) {
        seen.current.add(approval.id)
        show(approval)
      }
      setReloadKey((k) => k + 1)
    },
    [show],
  )
  const live = useApprovalFeed(onEvent)

  // จำนวนรออนุมัติ · โหลดสำรองเป็นระยะ และเด้งคำขอใหม่ที่หลุดจาก stream
  useEffect(() => {
    let cancelled = false
    const load = () =>
      listApprovals({ status: 'pending' })
        .then((rows) => {
          if (cancelled) return
          const list = rows || []
          setCount(list.length)
          if (seen.current) {
            const fresh = list.filter((a) => !seen.current.has(a.id))
            fresh.forEach((a) => seen.current.add(a.id))
            if (fresh.length) show(fresh[0])
          } else {
            seen.current = new Set(list.map((a) => a.id))
          }
        })
        .catch(() => {})
    load()
    const id = setInterval(load, live ? POLL_LIVE : POLL_OFFLINE)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [reloadKey, live, show])

  function open(id) {
    setPopup(null)
    navigate(id ? `/approvals?id=${id}` : '/approvals')
  }

  return (
    <>
      <button
        type="button"
        className="pos-bell"
        onClick={() => open()}
        aria-label={count ? `คำขอรออนุมัติ ${count} รายการ` : 'ไม่มีคำขอรออนุมัติ'}
        title="คำขออนุมัติ"
      >
        <BellIcon />
        {count > 0 && <span className="pos-bell-count">{count > 99 ? '99+' : count}</span>}
      </button>

      {popup && (
        <div className="pos-popup" role="alert">
          <span className="pos-popup-icon">
            <BellIcon />
          </span>
          <span className="pos-popup-text">
            <strong>
              คำขอใหม่: {popup.type === 'refund' ? 'คืนเงิน' : 'ส่วนลด'} {thb(popup.amount)}
            </strong>
            <span>
              จาก{popup.requested_by_name || 'พนักงาน'} · บิล {popup.order_no || popup.order_id?.slice(0, 8)}
            </span>
          </span>
          <button type="button" className="pos-link" onClick={() => open(popup.id)}>
            ดู
          </button>
          <button type="button" className="pos-close" onClick={() => setPopup(null)} aria-label="ปิดการแจ้งเตือน">
            ×
          </button>
        </div>
      )}
    </>
  )
}
