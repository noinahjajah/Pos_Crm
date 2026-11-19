# โครงสร้างโฟลเดอร์ Frontend (React + Vite)

แบ่งตามฟีเจอร์ (หน้าจอที่พนักงานใช้) ไฟล์ใน `api/` แยกตาม service หลัง gateway

## ภาพรวมทั้งโปรเจกต์

```
pos-crm/
├── web/          ← React + Vite (frontend)
├── gateway/      ← API Gateway :8080
└── services/     ← identity, catalog, pos, payment
```

`web/` ไม่มีโค้ด server ข้อมูลทุกอย่างดึงผ่าน gateway

## โครงสร้าง `web/`

```
web/
├── index.html
├── vite.config.js
├── .env                      ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (ใช้กับ Realtime — ยังไม่ได้ใช้)
└── src/
    ├── main.jsx
    ├── App.jsx
    │
    ├── app/                  ← ตั้งค่าแอปทั้งระบบ
    │   ├── router.jsx        ← เส้นทางทั้งหมด + กำหนด role ต่อหน้า
    │   ├── routeElements.jsx ← Home, CheckoutRoute, Placeholder
    │   └── providers.jsx     ← QueryClient, AuthProvider
    │
    ├── api/                  ← ที่เดียวที่เรียก backend
    │   ├── client.js         ← base /api/v1, แนบ token, refresh เมื่อเจอ 401, แปลง error
    │   ├── identity.js       ← login, me, users, branches
    │   ├── catalog.js        ← categories, menus, option-groups, stocks
    │   ├── pos.js            ← tables, orders, tickets, kitchen, approvals
    │   ├── posMock.js        ← ข้อมูลจำลองของ pos (VITE_POS_MODE=mock)
    │   ├── approvalFeed.js   ← รับแจ้งเตือนอนุมัติ realtime (SSE)
    │   └── payment.js        ← payments, refunds, expenses, reports
    │
    ├── features/             ← 1 โฟลเดอร์ = 1 ฟีเจอร์ (หน้า + component + hook ของมัน)
    │   ├── auth/
    │   │   ├── LoginPage.jsx
    │   │   ├── AuthContext.jsx
    │   │   └── RequireRole.jsx
    │   ├── tables/           ← ผังโต๊ะ เปิดบิล เพิ่มโต๊ะ ย้าย/รวมโต๊ะ
    │   │   ├── TablesPage.jsx
    │   │   ├── OpenTableDialog.jsx
    │   │   ├── AddTableDialog.jsx
    │   │   └── MoveMergeDialog.jsx
    │   ├── orders/           ← เลือกเมนู ตัวเลือก ส่งเข้าครัว ปิดโต๊ะที่ไม่ได้สั่ง
    │   │   ├── OrderPage.jsx
    │   │   ├── MenuOptionDialog.jsx
    │   │   └── TicketSentDialog.jsx
    │   ├── kitchen/          ← จอครัว (ยังไม่เปิดใช้: คอมเมนต์ route + เมนูไว้)
    │   │   └── KitchenPage.jsx
    │   ├── checkout/         ← รับเงิน เงินสด / PromptPay จำลอง
    │   │   ├── CashierPage.jsx
    │   │   ├── CheckoutPage.jsx
    │   │   ├── BillSummary.jsx
    │   │   ├── CashForm.jsx
    │   │   ├── PromptPayQR.jsx
    │   │   ├── Receipt.jsx
    │   │   ├── BillPrint.jsx
    │   │   └── checkoutUtils.js
    │   ├── approvals/        ← ขอ/อนุมัติ ส่วนลดและคืนเงิน
    │   │   ├── ApprovalsPage.jsx
    │   │   ├── ApprovalBell.jsx
    │   │   ├── DiscountRequestDialog.jsx
    │   │   └── RefundRequestPage.jsx
    │   └── backoffice/       ← หลังร้าน
    │       ├── menus/        ← เมนู กลุ่มตัวเลือก หมวดหมู่ เปิด/ปิดขาย
    │       ├── stocks/
    │       ├── users/        ← ผู้ใช้ และสาขา
    │       ├── expenses/
    │       ├── payments/
    │       ├── reports/      ← แดชบอร์ด และกำไร-ขาดทุน
    │       └── (ของใช้ร่วมในหลังร้าน: useBranchScope.js, menuLinks.js, GroupedBarChart.jsx, seriesColors.js)
    │
    ├── components/           ← ของที่ใช้ร่วมกันหลายฟีเจอร์
    │   ├── ui/
    │   │   └── posUi.jsx     ← Dialog, ConfirmDialog, Stepper, Toast, MockBanner
    │   ├── layout/           ← AppLayout, Sidebar, Topbar, navItems.js (เมนูตาม role)
    │   └── print/            ← KitchenTicketPrint, ReceiptPrint, PrintSlip, PrintPreviewPage
    │
    ├── lib/
    │   ├── constants.js      ← ROLES, HOME_BY_ROLE
    │   ├── format.js         ← จัดรูปแบบเงินบาท วันที่แบบไทย
    │   └── posUtils.js       ← ตัวช่วยหน้าร้าน: thb, hhmm, useNow, useToast, สถานะโต๊ะ
    └── styles/
        ├── index.css
        └── pos.css           ← สไตล์ร่วมของหน้าร้านและหลังร้าน (ปุ่ม การ์ด ฟอร์ม dialog)
```

## เส้นทางและ role

S = staff, M = manager, O = owner

| Path | หน้า | Role |
|---|---|---|
| `/login` | LoginPage | ทุกคน |
| `/tables` | ผังโต๊ะ (manager/owner เพิ่มโต๊ะได้ · owner ดูอย่างเดียว) | S M O |
| `/orders/:id` | สั่งอาหาร | S M |
| `/kitchen` | จอครัว (ยังไม่เปิดใช้) | S M |
| `/cashier` | รายการบิลรอชำระ | S M |
| `/checkout/:orderId` | รับเงิน | S M |
| `/menus/availability` | เปิด/ปิดขายเมนู | S M |
| `/refunds/request` | ขอคืนเงิน | S |
| `/approvals` | รายการรออนุมัติ | M O |
| `/admin/menus` | จัดการเมนู | M O |
| `/admin/menus/option-groups` | กลุ่มตัวเลือกเสริม | M O |
| `/admin/stocks` | สต็อก | M O |
| `/admin/users` | ผู้ใช้ | M O |
| `/admin/expenses` | รายจ่าย | M O |
| `/admin/payments` | รายการรับเงิน | M O |
| `/admin/reports` | แดชบอร์ด | M O |
| `/admin/menus/categories` | หมวดหมู่ | O |
| `/admin/profit` | กำไร-ขาดทุน | O |
| `/admin/branches` | สาขา | O |

ถ้าเข้าหน้าที่ role ไม่มีสิทธิ์ `RequireRole` จะพากลับไปหน้าแรกของ role นั้น
สิทธิ์ละเอียดระดับปุ่ม (เช่น หมวดหมู่แก้ได้เฉพาะ O) ให้ยึดตารางสิทธิ์ใน `api-gateway-phase1.md`

## กติกา 3 ข้อ

1. **เรียก backend ผ่าน `api/` เท่านั้น** component ห้ามเรียก `fetch` เอง
2. **ของในฟีเจอร์อยู่ในโฟลเดอร์ฟีเจอร์นั้น** ย้ายไปไว้ที่ `components/` ก็ต่อเมื่อมีฟีเจอร์ที่ 2 ต้องใช้ด้วย
3. **ใช้ `supabase.js` แค่รับแจ้งเตือน realtime** ข้อมูลอื่นทั้งหมดดึงผ่าน gateway

## Library

```bash
npm i react-router @tanstack/react-query
npm i @supabase/supabase-js   # ตอนเริ่มทำจอครัว / แจ้งเตือนอนุมัติ
```

## `vite.config.js`

```js
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname, 'src') } },
  server: {
    proxy: { '/api': 'http://localhost:8080' },   // ส่ง /api ไป gateway ตอนพัฒนา
  },
})
```

ใช้ alias แบบนี้: `import { getOrders } from '@/api/pos'`

## ตอนใช้งานจริง

`npm run build` ได้ไฟล์ static ใน `web/dist/` ให้ gateway เสิร์ฟด้วย `express.static` หรือ deploy ขึ้น Vercel / Netlify
