import { NavLink } from 'react-router'
import { useAuth } from '../../features/auth/AuthContext'
import { navFor } from './navItems'

// เมนูข้าง แสดงเฉพาะหน้าที่ role ของผู้ใช้เข้าได้ (1.2)
// จอเล็ก: เลื่อนออกมาจากซ้ายเมื่อกดปุ่มเมนูใน Topbar (open / onClose)

export default function Sidebar({ open, onClose }) {
  const { role } = useAuth()
  const sections = navFor(role)

  return (
    <>
      <aside className={`app-sidebar ${open ? 'is-open' : ''}`} aria-label="เมนูหลัก">
        <div className="app-logo">
          <span className="app-logo-mark" aria-hidden="true">
            POS
          </span>
          <span className="app-logo-text">POS CRM</span>
        </div>
        <nav>
          {sections.map((section) => (
            <div className="app-nav-section" key={section.title}>
              <div className="app-nav-title">{section.title}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `app-nav-link ${isActive ? 'is-active' : ''}`}
                  onClick={onClose}
                >
                  <span className="app-nav-icon" aria-hidden="true">
                    {item.icon}
                  </span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="app-scrim" onClick={onClose} aria-hidden="true" />}
    </>
  )
}
