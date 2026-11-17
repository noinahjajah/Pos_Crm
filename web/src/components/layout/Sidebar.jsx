// แถบเมนูซ้าย: เมนูตาม role + กล่องผู้ใช้ (ออกจากระบบ)

import { NavLink } from 'react-router-dom'
import { useNotice } from '../ui/Notice.jsx'
import { Avatar } from '../ui/index.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { AVATAR_COLOR, menuFor, ROLE_LABEL } from '../../lib/constants.js'

export function Sidebar() {
  const { user, logout } = useAuth()
  const { toast } = useNotice()
  const items = menuFor(user.role)

  return (
  <aside className="sidebar">
    <div className="brand">
      <div className="brand-mark">ค</div>
      <div>
        <div className="brand-name">ครัวโอทอป</div>
        <div className="brand-sub">ระบบหลังบ้าน · {ROLE_LABEL[user.role]}</div>
      </div>
    </div>
    <div className="nav-label">เมนูหลัก</div>
    <nav>
      {items.map((m) => (
        <NavLink key={m.path} to={m.path} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
          {m.label}
        </NavLink>
      ))}
    </nav>
    <div className="sidebar-spacer" />
    <div className="user-box">
      <Avatar name={user.full_name} color={AVATAR_COLOR[user.role]} />
      <div style={{ minWidth: 0 }}>
        <NavLink to="/account" className="name" title="บัญชีของฉัน / เปลี่ยนรหัสผ่าน">
          {user.full_name}
        </NavLink>
        <div className="sub">
          {ROLE_LABEL[user.role]}
          {user.branch ? ` · ${user.branch.name}` : ' · ทุกสาขา'} ·{' '}
          <button
            type="button"
            className="linklike"
            onClick={() => {
              logout()
              toast('ออกจากระบบแล้ว', 'info')
            }}
          >
            ออกจากระบบ
          </button>
        </div>
      </div>
    </div>
  </aside>
  )
}
