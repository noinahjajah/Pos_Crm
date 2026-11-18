import { createBrowserRouter } from 'react-router'
import AppLayout from '../components/layout/AppLayout'
import PrintPreviewPage from '../components/print/PrintPreviewPage'
import LoginPage from '../features/auth/LoginPage'
import RequireRole from '../features/auth/RequireRole'
import ExpensesPage from '../features/backoffice/expenses/ExpensesPage'
import MenuAvailabilityPage from '../features/backoffice/menus/MenuAvailabilityPage'
import CategoriesPage from '../features/backoffice/menus/CategoriesPage'
import MenusPage from '../features/backoffice/menus/MenusPage'
import OptionGroupsPage from '../features/backoffice/menus/OptionGroupsPage'
import PaymentsPage from '../features/backoffice/payments/PaymentsPage'
import ReportsPage from '../features/backoffice/reports/ReportsPage'
import StocksPage from '../features/backoffice/stocks/StocksPage'
import UsersPage from '../features/backoffice/users/UsersPage'
import CashierPage from '../features/checkout/CashierPage'
import { CheckoutRoute, Home, Placeholder } from './routeElements'

// เส้นทางทั้งหมด + role ต่อหน้า (ตามตารางใน เอกสาร/frontend-folder-structure.md)
// S = staff, M = manager, O = owner · เมนูข้างอยู่ที่ components/layout/navItems.js ต้องแก้ให้ตรงกัน

const SM = ['staff', 'manager']
const MO = ['manager', 'owner']

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  ...(import.meta.env.DEV ? [{ path: '/dev/print', element: <PrintPreviewPage /> }] : []),
  {
    element: <RequireRole />,
    children: [
      {
        element: <AppLayout />,
        children: [
          { index: true, element: <Home /> },

          // หน้าร้าน S M
          {
            element: <RequireRole roles={SM} />,
            children: [
              { path: '/tables', element: <Placeholder title="ผังโต๊ะ" owner="Dev 3" /> },
              { path: '/orders/:id', element: <Placeholder title="สั่งอาหาร" owner="Dev 3" /> },
              { path: '/kitchen', element: <Placeholder title="จอครัว" owner="Dev 3" /> },
              { path: '/cashier', element: <CashierPage /> },
              { path: '/checkout/:orderId', element: <CheckoutRoute /> },
              { path: '/menus/availability', element: <MenuAvailabilityPage /> },
            ],
          },

          // อนุมัติ + หลังร้าน M O
          {
            element: <RequireRole roles={MO} />,
            children: [
              { path: '/approvals', element: <Placeholder title="รายการรออนุมัติ" owner="Dev 3" /> },
              { path: '/admin/menus', element: <MenusPage /> },
              { path: '/admin/menus/option-groups', element: <OptionGroupsPage /> },
              { path: '/admin/stocks', element: <StocksPage /> },
              { path: '/admin/users', element: <UsersPage /> },
              { path: '/admin/expenses', element: <ExpensesPage /> },
              { path: '/admin/payments', element: <PaymentsPage /> },
              { path: '/admin/reports', element: <ReportsPage /> },
            ],
          },

          // หมวดหมู่เป็นของกลาง owner จัดการเท่านั้น (1.14) — หน้าของ Dev 2 ก็ไม่ให้ manager เข้า
          {
            element: <RequireRole roles={['owner']} />,
            children: [{ path: '/admin/menus/categories', element: <CategoriesPage /> }],
          },

          { path: '*', element: <Home /> },
        ],
      },
    ],
  },
])
