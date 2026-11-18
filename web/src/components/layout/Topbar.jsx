import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { listBranches } from '../../api/identity'
import { useAuth } from '../../features/auth/AuthContext'
import ApprovalBell from '../../features/pos/approvals/ApprovalBell'
import { ROLE_LABELS } from '../../lib/constants'

// แถบบน: ชื่อผู้ใช้ role สาขา และปุ่มออกจากระบบ
// owner ไม่มีสาขาประจำ (เห็นทุกสาขา 1.4) — เลือกสาขาที่ตัวกรองของแต่ละหน้า

export default function Topbar({ onMenu }) {
  const { user, isOwner, isManager, logout } = useAuth()
  const navigate = useNavigate()
  const [branchName, setBranchName] = useState(user?.branch?.name || user?.branch_name || '')
  const [loggingOut, setLoggingOut] = useState(false)

  // /me ไม่ได้ส่งชื่อสาขามา → หาจากรายชื่อสาขา
  useEffect(() => {
    if (isOwner || branchName || !user?.branch_id) return
    let cancelled = false
    listBranches()
      .then((branches) => {
        const found = (branches || []).find((b) => b.id === user.branch_id)
        if (!cancelled && found) setBranchName(found.name)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isOwner, branchName, user?.branch_id])

  async function handleLogout() {
    setLoggingOut(true)
    await logout()
    navigate('/login', { replace: true })
  }

  const displayName = user?.full_name || user?.username || ''

  return (
    <header className="app-topbar">
      <button type="button" className="app-menu-btn" onClick={onMenu} aria-label="เปิดเมนู">
        ☰
      </button>

      <div className="app-branch">
        <span className="app-branch-label">สาขา</span>
        <strong>{isOwner ? 'ทุกสาขา' : branchName || '—'}</strong>
      </div>

      <div className="app-user">
        {/* แจ้งเตือนคำขอส่วนลด/คืนเงินแบบ realtime (1.29) */}
        {(isManager || isOwner) && <ApprovalBell />}
        <div className="app-avatar" aria-hidden="true">
          {displayName.slice(0, 1).toUpperCase()}
        </div>
        <div className="app-user-text">
          <strong>{displayName}</strong>
          <span>{ROLE_LABELS[user?.role] || user?.role}</span>
        </div>
        <button type="button" className="app-logout" onClick={handleLogout} disabled={loggingOut}>
          {loggingOut ? 'กำลังออก…' : 'ออกจากระบบ'}
        </button>
      </div>
    </header>
  )
}
