# POS CRM — ระบบหลังบ้านร้านอาหาร

## วิธีติดตั้งและใช้งาน

**Windows** (เปิด PowerShell แล้ววางบรรทัดเดียว)
```powershell
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements; winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); git clone -b dev1-identity https://github.com/noinahjajah/Pos_Crm.git; cd Pos_Crm\services; Copy-Item .env.example .env; npm.cmd run setup; Start-Process notepad .env -Wait; Start-Process powershell -ArgumentList '-NoExit','-Command','npm.cmd run dev'; Start-Sleep 12; Start-Process http://localhost:5173
```

**Mac** (เปิด Terminal แล้ววาง)
```bash
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install git node; git clone -b dev1-identity https://github.com/noinahjajah/Pos_Crm.git && cd Pos_Crm/services && cp .env.example .env && npm run setup && open -W -a TextEdit .env && (sleep 12 && open http://localhost:5173 &) && npm run dev
```

ระหว่างติดตั้งจะเปิดไฟล์ `services/.env` ให้ใส่ key ของ Supabase (ขอจาก Dev 1) แล้วบันทึกปิดไฟล์ ระบบจะเปิดต่อเอง

เปิด http://localhost:5173 · login `owner` / `manager1` / `staff1` รหัส `password123`

ครั้งต่อไป: เข้าโฟลเดอร์ `Pos_Crm/services` แล้วรัน `npm run dev` คำสั่งเดียว เปิดครบทั้ง identity, gateway, catalog, payment และเว็บ (Windows ใช้ `npm.cmd run dev`)

### ต่อ Supabase
- ระบบใช้ฐานข้อมูลจริงของทีมเสมอ (ไม่มีโหมดจำลองแล้ว) · ต้องใส่ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ใน `services/.env` ก่อนรัน (ขอ key จาก Dev 1 ทางส่วนตัว · key ถูกเก็บไว้ใน GitHub Secrets ของ repo ด้วย ใช้ได้ใน GitHub Actions เท่านั้น)
- schema `identity`, hook และผู้ใช้ทดสอบตั้งไว้ในโปรเจกต์ Supabase ของทีมแล้ว · schema `catalog` และ `payment` ของ Dev 2 ต้องอยู่ในโปรเจกต์เดียวกัน

## โครงสร้างโฟลเดอร์

โครงเดียวกับ branch `MO` ของ Dev 2: backend ทุก service อยู่ `services/<ชื่อ>/`, หน้าเว็บอยู่ `web/src/features/<ฟีเจอร์>/`

```
Pos_Crm/
├─ web/                        ← หน้าเว็บ React (Vite) · โครงเดิมของทีม
│  ├─ .env.example             ค่าตั้งค่าเว็บ (ไม่บังคับ) คัดลอกเป็น web/.env
│  └─ src/
│     ├─ main.jsx              จุดเริ่ม → App.jsx
│     ├─ App.jsx               providers + router
│     ├─ app/
│     │  ├─ router.jsx         เส้นทางทั้งหมด + กำหนด role ต่อหน้า ← ผูกหน้าใหม่ใน PAGES
│     │  └─ providers.jsx      แจ้งเตือน, ผู้ใช้ที่ login, สาขาที่เลือก
│     ├─ api/                  ← ที่เดียวที่เรียก backend
│     │  ├─ client.js          base /api/v1, แนบ token, refresh เมื่อใกล้หมดอายุ
│     │  ├─ identity.js        login, me, users, branches (Dev 1)
│     │  ├─ catalog.js         categories, menus, option-groups, stocks (Dev 2)
│     │  ├─ pos.js             tables, orders, tickets, approvals (Dev 3)
│     │  └─ payment.js         payments, refunds, expenses, reports (Dev 2)
│     ├─ features/             ← 1 โฟลเดอร์ = 1 ฟีเจอร์ (หน้า + component)
│     │  ├─ auth/              LoginPage, AccountPage, AuthContext, RequireRole (Dev 1)
│     │  ├─ backoffice/
│     │  │  ├─ users/          UsersPage (Dev 1)
│     │  │  ├─ branches/       BranchesPage (Dev 1)
│     │  │  ├─ menus/          MenusPage, CategoriesPage, OptionGroupsPage, MenuFormDialog (Dev 2)
│     │  │  ├─ stocks/         StocksPage (Dev 2)
│     │  │  ├─ expenses/       ExpensesPage (Dev 2)
│     │  │  └─ reports/        ReportsPage = แดชบอร์ด (Dev 2)
│     │  ├─ checkout/          CheckoutPage, CashForm, PromptPayQR, Receipt (Dev 2) · ReceiptSlip, bill.js, PrintPreviewPage (Dev 1)
│     │  ├─ kitchen/           KitchenTicket ใบเข้าครัว (Dev 1) · Dev 3 เพิ่ม KitchenPage, TicketCard
│     │  └─ (tables/ orders/ approvals/)  Dev 3 สร้างตามโครงนี้
│     ├─ components/
│     │  ├─ ui/                index.jsx (Button, Badge, Card, Field, SidePanel …) + Notice.jsx (toast, ยืนยัน)
│     │  └─ layout/            AppLayout, Sidebar, Topbar
│     ├─ hooks/                useForm, usePrintSlip
│     ├─ lib/                  constants.js (ROLES, เมนูตาม role), format.js (เงินบาท วันที่ไทย)
│     └─ styles/index.css
├─ services/                   ← backend ทุก service (1 โฟลเดอร์ = 1 service)
│  ├─ gateway/                 API Gateway :8080 (Dev 1)
│  │  ├─ app.js                middleware 10 ตัวตาม spec + proxy ไป service
│  │  ├─ permissions.js        ตารางสิทธิ์ {method, path, roles} ← เพิ่มสิทธิ์ของ endpoint ใหม่ที่นี่
│  │  └─ server.js
│  ├─ identity/                login / ผู้ใช้ / role / สาขา :3001 (Dev 1)
│  │  ├─ app.js, routes.js, supabase.js, server.js
│  │  └─ tools.mjs             npm run tokens / seed:users
│  ├─ catalog/                 หมวดหมู่ เมนู กลุ่มตัวเลือก สต็อก :3002 (Dev 2 · package.json ของตัวเอง)
│  ├─ payment/                 รับเงิน คืนเงิน รายจ่าย รายงาน :3004 (Dev 2 · package.json ของตัวเอง)
│  ├─ (pos/)                   โต๊ะ ออร์เดอร์ จอครัว คำขออนุมัติ :3003 (Dev 3 สร้างตามแบบ catalog)
│  ├─ shared.js                โค้ดกลางของ gateway + identity
│  ├─ test/                    npm test (gateway, identity) · e2e.mjs = npm run e2e กับ Supabase จริง
│  ├─ supabase/                migration ของ schema identity + seed 3 สาขา
│  ├─ Dockerfile               build gateway / identity
│  ├─ docker-compose.yml       รันทุก service ด้วย Docker (เปิดแค่ :8080)
│  ├─ .env.example             ค่าตั้งค่าใช้ร่วมทุก service คัดลอกเป็น services/.env (ห้ามใส่ key จริง)
│  └─ package.json             package ของ gateway + identity และคำสั่งรันทุก service พร้อมกัน
├─ เอกสาร/                      ← spec เฟส 1 + ภาพ ERD ของทีม
└─ .github/workflows/ci.yml    ← CI ตรวจ services + web + docker
```

**คำสั่งที่ใช้บ่อย** (รันในโฟลเดอร์ `services` · Windows ใช้ `npm.cmd`)

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run setup` | ติดตั้งทุกอย่าง (gateway, identity, catalog, payment, web) |
| `npm run dev` | เปิด identity, gateway, catalog, payment และเว็บพร้อมกัน |
| `npm run dev:catalog` (หรือ `dev:payment` …) | เปิดทีละ service |
| `npm test` | เทสต์ backend |
| `npm run e2e` | ตรวจการเชื่อมต่อจริง gateway → identity → ฐานข้อมูล 36 รายการ (เปิด `npm run dev` ไว้ก่อน) |
| `npm run tokens` | login จริงกับ Supabase ได้ token 3 role ไว้เรียก API ผ่าน gateway |
| `npm --prefix ../web run lint` / `run build` | ตรวจโค้ดเว็บ / build เว็บ |

### Dev 2 / Dev 3 ใช้ต่อยังไง
- สิทธิ์ของ endpoint: เพิ่มใน `services/gateway/permissions.js`
- service ใหม่: สร้างโฟลเดอร์ `services/<ชื่อ>/` ที่มี `server.js` + `package.json` ของตัวเอง (แบบ `services/catalog/`) แล้วเพิ่ม `dev:<ชื่อ>` ใน `services/package.json` และ service ใน `docker-compose.yml` · อ่านค่าจาก `services/.env` ไฟล์เดียว
- หน้าเว็บ: สร้างใน `web/src/features/<ฟีเจอร์>/` แล้วผูกใน `web/src/app/router.jsx` (`PAGES`) · เรียก API ผ่าน `web/src/api/`
- ใบพิมพ์ 80 มม.: `KitchenTicket` (`features/kitchen/`), `ReceiptSlip` + `calcBill` (`features/checkout/`), `usePrintSlip` (`hooks/`)
- token ทดสอบ 3 role: `npm run tokens` (ในโฟลเดอร์ `services`)

## มีอะไรบ้าง
- `services/identity/` :3001 — login / refresh / logout / เปลี่ยนรหัสผ่าน, ล็อกบัญชีเมื่อใส่ผิด 5 ครั้ง, `GET /me`, สาขา, role, ผู้ใช้ (owner จัดการ, manager ดูเฉพาะสาขาตัวเอง)
- `services/gateway/` :8080 — middleware 10 ตัว, ตารางสิทธิ์ `{method, path, roles}` ครบทุก service, branch scope, บล็อก `/internal/*`, 502/504
- `services/shared.js` — response/error มาตรฐาน, zod, อ่าน `X-User-*` + `X-Internal-Key`
- `services/supabase/` — schema identity + custom access token hook + seed 3 สาขา
- `services/Dockerfile`, `services/docker-compose.yml` (เปิดแค่ 8080), `services/.env.example`
- `services/catalog/`, `services/payment/` (Dev 2) — เมนู หมวดหมู่ กลุ่มตัวเลือก สต็อก, รับเงิน คืนเงิน รายจ่าย รายงาน · payment ใช้บิลจำลอง (`POS_MODE=mock`) จนกว่า pos ของ Dev 3 จะพร้อม
- `web/` — login, เมนูตาม role, จัดการผู้ใช้/สาขา, บัญชีของฉัน, แจ้งเตือน, ใบพิมพ์ 80mm (Dev 1) · แดชบอร์ด เมนู หมวดหมู่ กลุ่มตัวเลือก สต็อก รายจ่าย รับเงิน (Dev 2) · หน้าของ Dev 3 เป็นหน้ารอพร้อมสิทธิ์

## สิ่งที่อยากให้ทีมช่วยยืนยัน
- เพิ่ม `GET /branches/:id` และ `GET /users/:id` (ไม่มีใน spec)
- ปิดสาขาที่ยังมีผู้ใช้อยู่ไม่ได้ → 409 `BRANCH_HAS_ACTIVE_USERS`
- ใส่ `GET /pos/kitchen/stream` (S M) ไว้ในตารางสิทธิ์ก่อน (ประเด็นเปิด 9.4)
- โครงสร้าง: backend ทุก service อยู่ `services/<ชื่อ>/` ตามแบบของ Dev 2 · gateway + identity ใช้ package.json กลางใน `services/`

## ทดสอบ
- [x] `npm test` — identity 27, gateway 20 ผ่าน
- [x] เว็บ lint + build ผ่าน · CI ผ่านรวม `docker compose`
- [x] ทดสอบกับ Supabase จริง 60 รายการ (login, สิทธิ์, สาขา, ผู้ใช้, session)
- [x] `npm run e2e` กับ Supabase จริงผ่าน 36/36
- [x] ทดสอบหน้าเว็บ 3 role ในเบราว์เซอร์
