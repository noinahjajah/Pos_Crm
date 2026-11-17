/* eslint-disable react-refresh/only-export-components */
import { createBrowserRouter, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './providers.jsx'
import { AppLayout, Badge, Card, DEV_LABEL, HOME_BY_ROLE, MENU, PageHeader } from '../components/ui.jsx'
import { AccountPage, LoginPage } from '../pages/LoginPage.jsx'
import { BranchesPage, UsersPage } from '../pages/ManagePages.jsx'
import { PrintPreviewPage } from '../pages/PrintPage.jsx'

// หน้าที่ Dev 1 ทำเสร็จแล้ว — Dev 2 / Dev 3 เพิ่มหน้าของตัวเองใน map นี้
const PAGES = {
  '/branches': <BranchesPage />,
  '/users': <UsersPage />,
  '/print': <PrintPreviewPage />,
}

/** ต้อง login ก่อน */
function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.must_change_password && location.pathname !== '/account') return <Navigate to="/account" replace />
  return <Outlet />
}

/** ต้องมี role ที่อนุญาต (1.2) — ฝั่ง API มี gateway ตรวจซ้ำอีกชั้น */
function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!roles.includes(user.role)) return <ForbiddenPage />
  return children
}

function HomeRedirect() {
  const { user } = useAuth()
  return <Navigate to={HOME_BY_ROLE[user.role] || '/print'} replace />
}

// หน้าว่างรอเพื่อน / 403 / 404
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
            {DEV_LABEL[item.dev]} สร้างหน้าใน <code>web/src/pages/</code> แล้วผูกใน <code>web/src/app/router.jsx</code> แทนหน้านี้
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

// เส้นทาง
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
