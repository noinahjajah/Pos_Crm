// ชิ้นส่วนหน้าตา (ปุ่ม, ป้าย, ฟอร์ม, layout) ตาม Prototype ใน Figma

import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth, useBranch, useNotice } from './app/providers.jsx'

// เมนูด้านซ้ายตาม role
export const MENU = [
  { path: '/dashboard', label: 'แดชบอร์ด', labelByRole: { owner: 'ภาพรวมทุกสาขา', manager: 'แดชบอร์ดสาขา' }, roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.34–1.37' },
  { path: '/menus', label: 'เมนู ตัวเลือก สต็อก', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.14–1.22' },
  { path: '/menu-availability', label: 'เปิด/ปิดขายเมนู', roles: ['staff'], dev: 'dev2', reqs: '1.15' },
  { path: '/expenses', label: 'รายจ่าย', roles: ['manager', 'owner'], dev: 'dev2', reqs: '1.32–1.33' },

  { path: '/branches', label: 'จัดการสาขา', roles: ['owner'], dev: 'dev1' },
  { path: '/users', label: 'ผู้ใช้งาน', labelByRole: { manager: 'พนักงานในสาขา' }, roles: ['manager', 'owner'], dev: 'dev1' },

  { path: '/tables', label: 'ผังโต๊ะ', roles: ['staff', 'manager'], dev: 'dev3', reqs: '1.7–1.13' },
  { path: '/kitchen', label: 'จอครัว', roles: ['staff', 'manager'], dev: 'dev3', reqs: '1.9–1.10' },
  { path: '/approvals', label: 'คำขออนุมัติ', labelByRole: { staff: 'คำขอของฉัน' }, roles: ['staff', 'manager', 'owner'], dev: 'dev3', reqs: '1.27–1.31' },

  { path: '/print', label: 'ตัวอย่างใบพิมพ์', roles: ['staff', 'manager', 'owner'], dev: 'dev1' },
]

export const DEV_LABEL = { dev1: 'Dev 1', dev2: 'Dev 2', dev3: 'Dev 3' }

export function menuFor(role) {
  return MENU.filter((m) => m.roles.includes(role)).map((m) => ({ ...m, label: m.labelByRole?.[role] ?? m.label }))
}

export const HOME_BY_ROLE = { owner: '/dashboard', manager: '/dashboard', staff: '/tables' }

export const ROLE_LABEL = { owner: 'Owner', manager: 'Manager', staff: 'Staff' }
export const ROLE_TONE = { owner: 'phase', manager: 'info', staff: 'neutral' }

// ชิ้นส่วนพื้นฐาน
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

// แผงแก้ไขด้านขวา (หน้าผู้ใช้)
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

// state ของฟอร์ม + ส่งข้อมูล + แสดง error รายช่อง
export function useForm(initial) {
  const [form, setForm] = useState(initial)
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const reset = (next = initial) => {
    setForm(next)
    setErrors({})
    setError('')
  }
  async function submit(action, errorText = (e) => e.message) {
    setBusy(true)
    setErrors({})
    setError('')
    try {
      await action()
    } catch (e) {
      setErrors(e.fieldErrors || {})
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return { form, setForm, set, errors, setErrors, error, setError, busy, submit, reset }
}

export function BranchOptions({ branches }) {
  return branches.map((b) => (
    <option key={b.id} value={b.id}>
      {b.name} ({b.code})
    </option>
  ))
}

// ช่องบอกว่าส่วนนี้ทำในเฟส 2
export function PhaseNote({ title, children }) {
  return (
    <div className="alert alert-phase">
      <Badge tone="phase">เฟส 2</Badge> <b>{title}</b>
      <div style={{ marginTop: 4 }}>{children}</div>
    </div>
  )
}

export const AVATAR_COLOR = { owner: '#6b3fd6', manager: '#2e6b5a', staff: '#8a857c' }

// โครงหน้า: แถบเมนูซ้าย + เนื้อหา
export function AppLayout() {
  const { user, logout } = useAuth()
  const { toast } = useNotice()
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
      <div className="main">
        <Outlet />
      </div>
    </div>
  )
}

// หัวหน้า + ตัวเลือกสาขา (owner)
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
          <BranchOptions branches={branches} />
        </Select>
      )}
      {showBranchSwitch && !canSwitch && user.branch && <Badge tone="info">{user.branch.name}</Badge>}
      {actions}
    </header>
  )
}
