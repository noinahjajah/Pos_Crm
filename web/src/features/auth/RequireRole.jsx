// กันหน้าที่ต้อง login และกันสิทธิ์ตาม role

import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { PageHeader } from '../../components/layout/Topbar.jsx'
import { Card } from '../../components/ui/index.jsx'
import { useAuth } from './AuthContext.jsx'

// ต้อง login · ถ้ายังใช้รหัสชั่วคราวจะถูกพาไปเปลี่ยนรหัสก่อน
export function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password && location.pathname !== '/account') return <Navigate to="/account" replace />
  return <Outlet />
}

export function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!roles.includes(user.role)) return <ForbiddenPage />
  return children
}

function ForbiddenPage() {
  return (
    <>
      <PageHeader title="ไม่มีสิทธิ์เข้าหน้านี้" subtitle="403 · role ของคุณเข้าหน้านี้ไม่ได้" />
      <div className="content">
        <Card>
          <a href="/">กลับหน้าแรก</a>
        </Card>
      </div>
    </>
  )
}
