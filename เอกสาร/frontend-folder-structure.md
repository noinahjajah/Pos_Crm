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
├── .env                      ← VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY (ใช้กับ Realtime)
└── src/
    ├── main.jsx
    ├── App.jsx
    │
    ├── app/                  ← ตั้งค่าแอปทั้งระบบ
    │   ├── router.jsx        ← เส้นทางทั้งหมด + กำหนด role ต่อหน้า
    │   └── providers.jsx     ← QueryClient, AuthProvider
    │
    ├── api/                  ← ที่เดียวที่เรียก backend
    │   ├── client.js         ← base /api/v1, แนบ token, refresh เมื่อเจอ 401, แปลง error
    │   ├── identity.js       ← login, me, users, branches
    │   ├── catalog.js        ← categories, menus, option-groups, stocks
    │   ├── pos.js            ← tables, orders, tickets, approvals
    │   └── payment.js        ← payments, refunds, expenses, reports
    │
    ├── features/             ← 1 โฟลเดอร์ = 1 ฟีเจอร์ (หน้า + component + hook ของมัน)
    │   ├── auth/
    │   │   ├── LoginPage.jsx
    │   │   ├── AuthContext.jsx
    │   │   └── RequireRole.jsx
    │   ├── tables/           ← ผังโต๊ะ เปิดบิล ย้าย/รวมโต๊ะ
    │   │   ├── TablesPage.jsx
    │   │   ├── TableCard.jsx
    │   │   └── MoveMergeDialog.jsx
    │   ├── orders/           ← เลือกเมนู ตัวเลือก ส่งเข้าครัว
    │   │   ├── OrderPage.jsx
    │   │   ├── MenuGrid.jsx
    │   │   ├── OptionDialog.jsx
    │   │   └── CartPanel.jsx
    │   ├── kitchen/          ← จอครัว
    │   │   ├── KitchenPage.jsx
    │   │   ├── TicketCard.jsx
    │   │   └── useKitchenRealtime.js
    │   ├── checkout/         ← รับเงิน เงินสด / PromptPay จำลอง
    │   │   ├── CheckoutPage.jsx
    │   │   ├── CashForm.jsx
    │   │   ├── PromptPayQR.jsx
    │   │   └── Receipt.jsx
    │   ├── approvals/        ← ขอ/อนุมัติ ส่วนลดและคืนเงิน
    │   │   ├── RequestDialog.jsx
    │   │   └── ApprovalsPage.jsx
    │   └── backoffice/       ← หลังร้าน
    │       ├── menus/
    │       ├── stocks/
    │       ├── users/
    │       ├── expenses/
    │       └── reports/
    │
    ├── components/           ← ของที่ใช้ร่วมกันหลายฟีเจอร์
    │   ├── ui/               ← Button, Modal, Badge, DataTable, Spinner
    │   └── layout/           ← AppLayout, Sidebar, Topbar
    │
    ├── hooks/                ← hook กลาง เช่น useDebounce
    ├── lib/
    │   ├── supabase.js       ← ใช้เฉพาะ Realtime (จอครัว, แจ้งเตือนอนุมัติ)
    │   ├── format.js         ← จัดรูปแบบเงินบาท วันที่แบบไทย
    │   └── constants.js      ← ROLES, ORDER_STATUS, TABLE_STATUS
    └── styles/
        └── index.css
```

## เส้นทางและ role

S = staff, M = manager, O = owner

| Path | หน้า | Role |
|---|---|---|
| `/login` | LoginPage | ทุกคน |
| `/tables` | ผังโต๊ะ | S M |
| `/orders/:id` | สั่งอาหาร | S M |
| `/kitchen` | จอครัว | S M |
| `/checkout/:orderId` | รับเงิน | S M |
| `/approvals` | รายการรออนุมัติ | M O |
| `/admin/menus` | จัดการเมนูและตัวเลือก | M O |
| `/admin/stocks` | สต็อก | M O |
| `/admin/users` | พนักงานและสาขา | M O |
| `/admin/expenses` | รายจ่าย | M O |
| `/admin/reports` | รายงาน / แดชบอร์ด | M O |

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
