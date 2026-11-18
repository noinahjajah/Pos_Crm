import { Navigate, Outlet, useLocation } from 'react-router'
import { HOME_BY_ROLE } from '../../lib/constants'
import { useAuth } from './AuthContext'

// ด่านตรวจสิทธิ์ของหน้า (1.2)
// - ยังไม่ login → ไป /login (จำหน้าที่จะเข้าไว้ใน state.from)
// - role ไม่อยู่ใน roles → กลับหน้าแรกของ role ตัวเอง
// ใช้เป็น layout route: <Route element={<RequireRole roles={['manager','owner']} />}>…</Route>
// ไม่ส่ง roles = แค่ต้อง login

export default function RequireRole({ roles, children }) {
  const { status, role } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="auth-loading" role="status">
        กำลังโหลด…
      </div>
    )
  }
  if (status !== 'authenticated') {
    return <Navigate to="/login" replace state={{ from: location }} />
  }
  if (roles && !roles.includes(role)) {
    return <Navigate to={HOME_BY_ROLE[role] || '/login'} replace />
  }
  return children ?? <Outlet />
}
