import { AuthProvider } from '../features/auth/AuthContext'

// provider ทั้งแอป
// หมายเหตุ: เอกสารวาง QueryClient (@tanstack/react-query) ไว้ที่นี่ แต่หน้าปัจจุบันดึงข้อมูลด้วย useEffect
// ถ้าทีมตกลงใช้ react-query ค่อยติดตั้งแล้วครอบ <QueryClientProvider> เพิ่มตรงนี้

export default function Providers({ children }) {
  return <AuthProvider>{children}</AuthProvider>
}
