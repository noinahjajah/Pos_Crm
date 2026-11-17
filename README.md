# POS CRM — ระบบหลังบ้านร้านอาหาร (Dev 1)

## วิธีติดตั้งและใช้งาน

**Windows** (เปิด PowerShell แล้ววางบรรทัดเดียว)
```powershell
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements; winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); git clone -b dev1-identity https://github.com/noinahjajah/Pos_Crm.git; cd Pos_Crm; Copy-Item .env.example .env; npm.cmd install; Start-Process powershell -ArgumentList '-NoExit','-Command','npm.cmd run dev'; Start-Sleep 12; Start-Process http://localhost:5173
```

**Mac** (เปิด Terminal แล้ววาง)
```bash
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install git node; git clone -b dev1-identity https://github.com/noinahjajah/Pos_Crm.git && cd Pos_Crm && cp .env.example .env && npm install && (sleep 12 && open http://localhost:5173 &) && npm run dev
```

เปิด http://localhost:5173 · login `owner` / `manager1` / `staff1` รหัส `password123`

ครั้งต่อไป: เข้าโฟลเดอร์ `Pos_Crm` แล้วรัน `npm run dev` คำสั่งเดียว เปิดครบทั้ง identity, gateway และเว็บ (Windows ใช้ `npm.cmd run dev`)

### ต่อ Supabase
- ค่าเริ่มต้นเป็น `DATA_MODE=memory` ใช้ได้ทันที ข้อมูลหายเมื่อปิดเซิร์ฟเวอร์
- ใช้ฐานข้อมูลจริง: ใส่ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ใน `.env` แล้วตั้ง `DATA_MODE=supabase` (ขอ key จาก Dev 1 ทางส่วนตัว · key ถูกเก็บไว้ใน GitHub Secrets ของ repo ด้วย ใช้ได้ใน GitHub Actions เท่านั้น)
- schema `identity`, hook และผู้ใช้ทดสอบตั้งไว้ในโปรเจกต์ Supabase ของทีมแล้ว

## โครงสร้างโฟลเดอร์

```
Pos_Crm/
├─ services/                  ← backend แยก service ละโฟลเดอร์ (1 service = 1 เจ้าของ)
│  ├─ gateway/                ← API Gateway :8080 ทางเข้าเดียวของเว็บ (Dev 1)
│  │  ├─ src/app.js           middleware 10 ตัว ตามลำดับใน spec ข้อ 2
│  │  ├─ src/permissions.js   ตารางสิทธิ์ { method, path, roles } ← Dev 2/3 เพิ่มสิทธิ์ของตัวเองที่นี่
│  │  └─ test/                เทสต์ของ gateway
│  ├─ identity/              ← login / ผู้ใช้ / role / สาขา :3001 (Dev 1)
│  │  ├─ src/routes.js        endpoint ทั้งหมดของ identity
│  │  ├─ src/memory.js        โหมดจำลอง (DATA_MODE=memory) ไม่ต้องต่อ Supabase
│  │  ├─ src/supabase.js      โหมดจริง (DATA_MODE=supabase)
│  │  ├─ tools.mjs            npm run tokens / npm run seed:users
│  │  └─ test/                เทสต์ของ identity
│  └─ catalog/ pos/ payment/  ← (ยังไม่มี) Dev 2 / Dev 3 สร้างโฟลเดอร์ของตัวเองแบบเดียวกับ identity
├─ packages/shared/           ← โค้ดกลางที่ทุก service ใช้: response/error, zod, อ่าน X-User-*
├─ supabase/                  ← migration ของ schema identity + seed 3 สาขา
├─ web/                       ← หน้าเว็บ React (Vite)
│  ├─ src/app/                ← ของที่ใช้ทั้งเว็บ
│  │  ├─ api.js               เรียก API ผ่าน gateway + เก็บ token
│  │  ├─ providers.jsx        ผู้ใช้ที่ login, สาขาที่เลือก, แจ้งเตือน
│  │  ├─ router.jsx           เส้นทางหน้าเว็บ + กันสิทธิ์ตาม role ← เพิ่มหน้าใหม่ใน PAGES
│  │  └─ ui.jsx               ปุ่ม ฟอร์ม เมนูซ้าย หน้าตาตาม Figma
│  ├─ src/pages/              ← หน้าเว็บ (Dev 2/3 สร้างหน้าของตัวเองที่นี่)
│  │  ├─ LoginPage.jsx        login + บัญชีของฉัน
│  │  ├─ ManagePages.jsx      จัดการผู้ใช้ + จัดการสาขา
│  │  └─ PrintPage.jsx        ใบเข้าครัว + ใบเสร็จ (Dev 3 ใช้ KitchenTicket, Receipt)
│  └─ nginx.conf              ใช้ตอนรันเว็บใน Docker (ส่ง /api ต่อให้ gateway)
├─ เอกสาร/                     ← spec เฟส 1 + ภาพ ERD ของทีม
├─ Dockerfile                 ← build ทุก service ฝั่ง Node
├─ docker-compose.yml         ← รันทั้งระบบด้วย Docker (เปิดแค่ :8080)
├─ .env.example               ← ตัวอย่างค่าตั้งค่า คัดลอกเป็น .env (ห้ามใส่ key จริง)
└─ package.json               ← npm workspaces: ติดตั้งครั้งเดียวที่นี่ · npm run dev / test / lint / build
```

**คำสั่งที่ใช้บ่อย** (รันที่โฟลเดอร์ `Pos_Crm` · Windows ใช้ `npm.cmd`)

| คำสั่ง | ทำอะไร |
|---|---|
| `npm install` | ติดตั้งทุกอย่าง (backend + เว็บ) |
| `npm run dev` | เปิด identity, gateway และเว็บพร้อมกัน |
| `npm test` | เทสต์ backend |
| `npm run lint` / `npm run build` | ตรวจโค้ดเว็บ / build เว็บ |
| `npm run tokens` | token ทดสอบ 3 role ไว้เรียก API ผ่าน gateway |

### Dev 2 / Dev 3 ใช้ต่อยังไง
- สิทธิ์ของ endpoint: เพิ่มใน `services/gateway/src/permissions.js`
- service ใหม่: สร้าง `services/<ชื่อ>` ใช้ `@pos/shared` (`internalAuth()`, `requireRole()`, `branchFilter()`, `validate()`, `ok()`)
- หน้าเว็บ: สร้างใน `web/src/pages/` แล้วผูกใน `web/src/app/router.jsx` (`PAGES`)
- ใบพิมพ์: `KitchenTicket`, `Receipt`, `usePrintSlip` จาก `web/src/pages/PrintPage.jsx`
- token ทดสอบ 3 role: `npm run tokens`

## มีอะไรบ้าง
- `services/identity` :3001 — login / refresh / logout / เปลี่ยนรหัสผ่าน, ล็อกบัญชีเมื่อใส่ผิด 5 ครั้ง, `GET /me`, สาขา, role, ผู้ใช้ (owner จัดการ, manager ดูเฉพาะสาขาตัวเอง)
- `services/gateway` :8080 — middleware 10 ตัว, ตารางสิทธิ์ `{method, path, roles}` ครบทุก service, branch scope, บล็อก `/internal/*`, 502/504
- `packages/shared` — response/error มาตรฐาน, zod, อ่าน `X-User-*` + `X-Internal-Key`
- `supabase/` — schema identity + custom access token hook + seed 3 สาขา
- `Dockerfile`, `docker-compose.yml` (เปิดแค่ 8080), `.env.example`
- `web/` — login, เมนูตาม role, จัดการผู้ใช้/สาขา, บัญชีของฉัน, แจ้งเตือนในระบบ, ใบเข้าครัวและใบเสร็จ 80mm (สูตร VAT 1.24) · หน้าของ Dev 2/3 เป็นหน้ารอพร้อมสิทธิ์

## สิ่งที่อยากให้ทีมช่วยยืนยัน
- เพิ่ม `GET /branches/:id` และ `GET /users/:id` (ไม่มีใน spec)
- ปิดสาขาที่ยังมีผู้ใช้อยู่ไม่ได้ → 409 `BRANCH_HAS_ACTIVE_USERS`
- ใส่ `GET /pos/kitchen/stream` (S M) ไว้ในตารางสิทธิ์ก่อน (ประเด็นเปิด 9.4)
- โครงสร้าง monorepo: `services/<ชื่อ>` + `packages/shared` + `web` อยู่ใน npm workspaces เดียวกัน (ติดตั้งครั้งเดียวที่ root)

## ทดสอบ
- [x] `npm test` — identity 27, gateway 20 ผ่าน
- [x] เว็บ lint + build ผ่าน · CI ผ่านรวม `docker compose`
- [x] ทดสอบกับ Supabase จริง 60 รายการ (login, สิทธิ์, สาขา, ผู้ใช้, session)
- [x] ทดสอบหน้าเว็บ 3 role ในเบราว์เซอร์
