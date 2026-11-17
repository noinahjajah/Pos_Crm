// เส้นทางของเว็บและการกันสิทธิ์ตาม role

import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './providers.jsx'
import { AppLayout, Badge, Card, DEV_LABEL, HOME_BY_ROLE, MENU, PageHeader } from './ui.jsx'
import { AccountPage, LoginPage } from './pages/LoginPage.jsx'
import { BranchesPage, UsersPage } from './pages/ManagePages.jsx'
import { PrintPreviewPage } from './pages/PrintPage.jsx'

// หน้าที่ทำเสร็จแล้ว · หน้าอื่นในเมนูจะแสดงหน้ารอ (Dev 2/3 เพิ่มหน้าของตัวเองที่นี่)
const PAGES = {
  '/branches': <BranchesPage />,
  '/users': <UsersPage />,
  '/print': <PrintPreviewPage />,
}

// ต้อง login · ถ้ายังใช้รหัสชั่วคราวจะถูกพาไปเปลี่ยนรหัสก่อน
function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password && location.pathname !== '/account') return <Navigate to="/account" replace />
  return <Outlet />
}

function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!roles.includes(user.role)) return <ForbiddenPage />
  return children
}

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={HOME_BY_ROLE[user.role] || '/print'} replace />
}

function PlaceholderPage({ item }) {
  const { user } = useAuth()
  return (
    <>
      <PageHeader title={item.label} subtitle={`ข้อกำหนด ${item.reqs ?? '-'} · เปิดได้สำหรับ ${item.roles.join(', ')}`} showBranchSwitch />
      <div className="content">
        <Card className="placeholder" title="ยังไม่ได้ทำหน้านี้" actions={<Badge tone="warning">งานของ {DEV_LABEL[item.dev]}</Badge>}>
          <p style={{ margin: 0, lineHeight: 1.6 }}>
            เส้นทาง <code>{item.path}</code> และสิทธิ์ตาม role พร้อมแล้ว ({user.role} เข้าได้)
            <br />
            {DEV_LABEL[item.dev]} สร้างหน้าใน <code>web/src/pages/</code> แล้วผูกใน <code>web/src/router.jsx</code> แทนหน้านี้
          </p>
        </Card>
      </div>
    </>
  )
}

function NotFoundPage() {
  return (
    <div className="content">
      <Card title="ไม่พบหน้านี้">
        <a href="/">กลับหน้าแรก</a>
      </Card>
    </div>
  )
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

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },
          { path: '/account', element: <AccountPage /> },
          ...MENU.map((item) => ({
            path: item.path,
            element: <RequireRole roles={item.roles}>{PAGES[item.path] ?? <PlaceholderPage item={item} />}</RequireRole>,
          })),
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
])
