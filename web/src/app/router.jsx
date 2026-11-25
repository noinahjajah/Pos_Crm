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
import ProfitPage from '../features/backoffice/reports/ProfitPage'
import ReportsPage from '../features/backoffice/reports/ReportsPage'
import BranchesPage from '../features/backoffice/users/BranchesPage'
import StocksPage from '../features/backoffice/stocks/StocksPage'
import UsersPage from '../features/backoffice/users/UsersPage'
import CashierPage from '../features/checkout/CashierPage'
import ApprovalsPage from '../features/approvals/ApprovalsPage'
import RefundRequestPage from '../features/approvals/RefundRequestPage'
// import KitchenPage from '../features/kitchen/KitchenPage' // จอครัว: ยังไม่เปิดใช้
import OrderPage from '../features/orders/OrderPage'
import TablesPage from '../features/tables/TablesPage'
import { CheckoutRoute, Home } from './routeElements'

// เส้นทางทั้งหมด + role ต่อหน้า (ตามตารางใน เอกสาร/frontend-folder-structure.md)
// S = staff, M = manager, O = owner · เมนูข้างอยู่ที่ components/layout/navItems.js ต้องแก้ให้ตรงกัน

const SM = ['staff', 'manager']
const MO = ['manager', 'owner']
const SMO = ['staff', 'manager', 'owner']

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

          // ผังโต๊ะ + รับออร์เดอร์ + คิดเงินจากโต๊ะ S M O — owner ทำได้เหมือนพนักงาน (ใช้สาขาของบิล/โต๊ะ)
          {
            element: <RequireRole roles={SMO} />,
            children: [
              { path: '/tables', element: <TablesPage /> },
              { path: '/orders/:id', element: <OrderPage /> },
              { path: '/checkout/:orderId', element: <CheckoutRoute /> },
            ],
          },

          // หน้าร้าน S M
          {
            element: <RequireRole roles={SM} />,
            children: [
              // { path: '/kitchen', element: <KitchenPage /> }, // จอครัว: ยังไม่เปิดใช้ (เปิดคอมเมนต์ที่นี่ + import ด้านบน + เมนูใน navItems.js)
              { path: '/cashier', element: <CashierPage /> },
              { path: '/menus/availability', element: <MenuAvailabilityPage /> },
            ],
          },

          // ขอคืนเงิน — ส่งคำขอได้เฉพาะ staff (POST /pos/orders/:id/approvals = S)
          {
            element: <RequireRole roles={['staff']} />,
            children: [{ path: '/refunds/request', element: <RefundRequestPage /> }],
          },

          // อนุมัติ + หลังร้าน M O
          {
            element: <RequireRole roles={MO} />,
            children: [
              { path: '/approvals', element: <ApprovalsPage /> },
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
            children: [
              { path: '/admin/menus/categories', element: <CategoriesPage /> },
              { path: '/admin/profit', element: <ProfitPage /> },
              { path: '/admin/branches', element: <BranchesPage /> },
            ],
          },

          { path: '*', element: <Home /> },
        ],
      },
    ],
  },
])
