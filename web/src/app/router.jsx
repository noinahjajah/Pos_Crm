// เส้นทางทั้งหมด + กำหนด role ต่อหน้า (ดูเมนูใน lib/constants.js)

import { Navigate, createBrowserRouter } from 'react-router-dom'
import { AppLayout } from '../components/layout/AppLayout.jsx'
import { PageHeader } from '../components/layout/Topbar.jsx'
import { Badge, Card } from '../components/ui/index.jsx'
import { AccountPage } from '../features/auth/AccountPage.jsx'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { LoginPage } from '../features/auth/LoginPage.jsx'
import { RegisterPage } from '../features/auth/RegisterPage.jsx'
import { RequireAuth, RequireRole } from '../features/auth/RequireRole.jsx'
import { BranchesPage } from '../features/backoffice/branches/BranchesPage.jsx'
import { UsersPage } from '../features/backoffice/users/UsersPage.jsx'
import { PrintPreviewPage } from '../features/checkout/PrintPreviewPage.jsx'
import CheckoutPage from '../features/checkout/CheckoutPage.jsx'
import ReportsPage from '../features/backoffice/reports/ReportsPage.jsx'
import MenusPage from '../features/backoffice/menus/MenusPage.jsx'
import CategoriesPage from '../features/backoffice/menus/CategoriesPage.jsx'
import OptionGroupsPage from '../features/backoffice/menus/OptionGroupsPage.jsx'
import StocksPage from '../features/backoffice/stocks/StocksPage.jsx'
import ExpensesPage from '../features/backoffice/expenses/ExpensesPage.jsx'
import { DEV_LABEL, HOME_BY_ROLE, MENU } from '../lib/constants.js'

// หน้าที่ทำเสร็จแล้ว · หน้าอื่นในเมนูจะแสดงหน้ารอ (Dev 2/3 เพิ่มหน้าของตัวเองที่นี่)
const PAGES = {
  '/dashboard': <ReportsPage />,
  '/menus': <MenusPage />,
  '/categories': <CategoriesPage />,
  '/option-groups': <OptionGroupsPage />,
  '/stocks': <StocksPage />,
  '/expenses': <ExpensesPage />,
  '/checkout': <CheckoutPage />,
  '/branches': <BranchesPage />,
  '/users': <UsersPage />,
  '/print': <PrintPreviewPage />,
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
            {DEV_LABEL[item.dev]} สร้างหน้าใน <code>web/src/features/</code> แล้วผูกใน <code>web/src/app/router.jsx</code> แทนหน้านี้
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

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
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
