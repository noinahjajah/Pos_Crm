import { Navigate, useNavigate, useParams } from 'react-router'
import { useAuth } from '../features/auth/AuthContext'
import CheckoutPage from '../features/checkout/CheckoutPage'
import { HOME_BY_ROLE } from '../lib/constants'

// component เล็ก ๆ ที่ router.jsx ใช้ (แยกไฟล์ให้ fast refresh ทำงาน)

/** หน้าที่ยังไม่ได้ทำ */
export function Placeholder({ title }) {
  return (
    <div className="app-placeholder">
      <h1>{title}</h1>
      <p>หน้านี้กำลังพัฒนา</p>
    </div>
  )
}

/** /checkout/:orderId → หน้าคิดเงินของ Dev 2 */
export function CheckoutRoute() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  return <CheckoutPage orderId={orderId} onDone={() => navigate('/cashier')} onBack={() => navigate(-1)} />
}

/** / → หน้าแรกของ role */
export function Home() {
  const { role } = useAuth()
  return <Navigate to={HOME_BY_ROLE[role] || '/login'} replace />
}
