/* eslint-disable react-refresh/only-export-components */
import { useEffect } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useBranch } from '../app/providers.jsx'

// ===================== เมนูตาม role (1.2) =====================
// เมนูตาม role (1.2) — ใช้ทั้งสร้าง sidebar และกันเข้าหน้า (route guard ฝั่งเว็บ)
// owner: เจ้าของงานแต่ละหน้า (dev1 / dev2 / dev3) — หน้าที่ยังไม่ใช่ของ Dev 1 แสดงเป็นหน้าว่างรอเพื่อนทำ

export const MENU = [
  // ----- Dev 2: catalog + payment + รายงาน -----
  { path: '/dashboard', label: 'แดชบอร์ด', labelByRole: { owner: 'ภาพรวมทุกสาขา', manager: 'แดชบอร์ดสาขา' }, roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.34–1.37' },
  { path: '/menus', label: 'เมนู ตัวเลือก สต็อก', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.14–1.22' },
  { path: '/menu-availability', label: 'เปิด/ปิดขายเมนู', roles: ['staff'], dev: 'dev2', reqs: '1.15' },
  { path: '/expenses', label: 'รายจ่าย', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.32–1.33' },

  // ----- Dev 1: สาขา ผู้ใช้ -----
  { path: '/branches', label: 'จัดการสาขา', roles: ['owner'], dev: 'dev1' },
  { path: '/users', label: 'ผู้ใช้งาน', labelByRole: { manager: 'พนักงานในสาขา' }, roles: ['manager', 'owner'], dev: 'dev1' },

  // ----- Dev 3: pos -----
  { path: '/tables', label: 'ผังโต๊ะ', roles: ['staff', 'manager'], dev: 'dev3', reqs: '1.7–1.13' },
  { path: '/kitchen', label: 'จอครัว', roles: ['staff', 'manager'], dev: 'dev3', reqs: '1.9–1.10' },
  { path: '/approvals', label: 'คำขออนุมัติ', labelByRole: { staff: 'คำขอของฉัน' }, roles: ['staff', 'manager', 'owner'], dev: 'dev3', reqs: '1.27–1.31' },

  // ----- Dev 1: layout ใบพิมพ์ (1.10) -----
  { path: '/print', label: 'ตัวอย่างใบพิมพ์', roles: ['staff', 'manager', 'owner'], dev: 'dev1' },
]

export const DEV_LABEL = { dev1: 'Dev 1', dev2: 'Dev 2', dev3: 'Dev 3' }

export function menuFor(role) {
  return MENU.filter((m) => m.roles.includes(role)).map((m) => ({ ...m, label: m.labelByRole?.[role] ?? m.label }))
}

/** หน้าแรกหลัง login ของแต่ละ role */
export const HOME_BY_ROLE = { owner: '/dashboard', manager: '/dashboard', staff: '/tables' }

export const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', staff: 'Staff' }
export const ROLE_TONE = { owner: 'phase', manager: 'info', staff: 'neutral' }

// ===================== ชิ้นส่วน UI =====================
export function Button({ variant = 'primary', size, block, className = '', ...props }) {
  const cls = ['btn', `btn-${variant}`, size === 'sm' && 'btn-sm', block && 'btn-block', className].filter(Boolean).join(' ')
  return <button type="button" className={cls} {...props} />
}

export function Badge({ tone = 'neutral', children }) {
  return <span className={`badge badge-${tone}`}>{children}</span>
}

export function Card({ title, actions, children, className = '' }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-header">
          {title && <h2>{title}</h2>}
          <div className="grow" />
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Field({ label, hint, error, children }) {
  return (
    <label className="field">
      <span>
        {label} {hint && <em className="hint">{hint}</em>}
      </span>
      {children}
      {error && <em className="error">{error}</em>}
    </label>
  )
}

export function TextInput({ invalid, className = '', ...props }) {
  return <input className={`input ${invalid ? 'invalid' : ''} ${className}`} {...props} />
}

export function Select({ className = '', children, ...props }) {
  return (
    <select className={`select ${className}`} {...props}>
      {children}
    </select>
  )
}

export function Avatar({ name = '?', color = '#8a857c', size }) {
  return (
    <span className={`avatar ${size === 'sm' ? 'sm' : ''}`} style={{ background: color }}>
      {name.trim().match(/[ก-ฮA-Za-z0-9]/)?.[0] ?? '?'}
    </span>
  )
}

export function Alert({ tone = 'error', children }) {
  if (!children) return null
  return <div className={`alert alert-${tone}`}>{children}</div>
}

// แผงแก้ไขด้านขวา (ตาม Figma: หน้าผู้ใช้ — กว้าง 360px)
export function SidePanel({ title, onClose, footer, children }) {
  return (
    <aside className="side-panel" aria-label={title}>
      <div className="side-panel-head">
        <h3>{title}</h3>
        <button type="button" className="icon-close" onClick={onClose} aria-label="ปิด">
          ✕
        </button>
      </div>
      <div className="side-panel-body">{children}</div>
      {footer && <div className="side-panel-foot">{footer}</div>}
    </aside>
  )
}

export function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

/** ช่องเฟส 2 (สีม่วงเส้นประ) ตาม Prototype */
export function PhaseNote({ title, children }) {
  return (
    <div className="alert alert-phase">
      <Badge tone="phase">เฟส 2</Badge> <b>{title}</b>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

// ===================== Layout: sidebar + แถบหัว =====================
export const AVATAR_COLOR = { owner: '#6b3fd6', manager: '#2e6b5a', staff: '#8a857c' }

export function AppLayout() {
  const { user, logout } = useAuth()
  const items = menuFor(user.role)

  return (
    <div className="shell">
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
              <button className="linklike" onClick={logout}>
                ออกจากระบบ
              </button>
            </div>
          </div>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}

/** แถบหัวของแต่ละหน้า + ตัวเลือกสาขาของ owner (1.4) */
export function PageHeader({ title, subtitle, actions, showBranchSwitch = false }) {
  const { user } = useAuth()
  const { branches, selectedBranchId, selectBranch, canSwitch } = useBranch()
  const { pathname } = useLocation()
  return (
    <header className="topbar" data-path={pathname}>
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <div className="grow" />
      {showBranchSwitch && canSwitch && (
        <Select
          value={selectedBranchId}
          onChange={(e) => selectBranch(e.target.value)}
          style={{ width: 200 }}
          aria-label="เลือกสาขา"
        >
          <option value="">ทุกสาขา</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.code})
            </option>
          ))}
        </Select>
      )}
      {showBranchSwitch && !canSwitch && user.branch && <Badge tone="info">{user.branch.name}</Badge>}
      {actions}
    </header>
  )
}
