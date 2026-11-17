# POS CRM — ระบบหลังบ้านร้านอาหาร (Dev 1)

## วิธีติดตั้งและใช้งาน

**Windows** (เปิด PowerShell แล้ววางบรรทัดเดียว)
```powershell
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements; winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements; $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User'); git clone -b dev1/identity-gateway https://github.com/noinahjajah/Pos_Crm.git; cd Pos_Crm; Copy-Item .env.example .env; npm.cmd install; npm.cmd --prefix web install; Start-Process powershell -ArgumentList '-NoExit','-Command','npm.cmd run dev'; Start-Process powershell -ArgumentList '-NoExit','-Command','npm.cmd --prefix web run dev'; Start-Sleep 10; Start-Process http://localhost:5173
```

**Mac** (เปิด Terminal แล้ววาง)
```bash
command -v brew >/dev/null || /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"; eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv)"; brew install git node; git clone -b dev1/identity-gateway https://github.com/noinahjajah/Pos_Crm.git && cd Pos_Crm && cp .env.example .env && npm install && npm --prefix web install && (npm run dev & npm --prefix web run dev & sleep 10; open http://localhost:5173; wait)
```

เปิด http://localhost:5173 · login `owner` / `manager1` / `staff1` รหัส `password123`

ครั้งต่อไป: เข้าโฟลเดอร์ `Pos_Crm` แล้วรัน `npm run dev` กับ `npm --prefix web run dev` คนละหน้าต่าง (Windows ใช้ `npm.cmd`)

### ต่อ Supabase
- ค่าเริ่มต้นเป็น `DATA_MODE=memory` ใช้ได้ทันที ข้อมูลหายเมื่อปิดเซิร์ฟเวอร์
- ใช้ฐานข้อมูลจริง: ใส่ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` ใน `.env` แล้วตั้ง `DATA_MODE=supabase` (ขอ key จาก Dev 1 ทางส่วนตัว · key ถูกเก็บไว้ใน GitHub Secrets ของ repo ด้วย ใช้ได้ใน GitHub Actions เท่านั้น)
- schema `identity`, hook และผู้ใช้ทดสอบตั้งไว้ในโปรเจกต์ Supabase ของทีมแล้ว

### Dev 2 / Dev 3 ใช้ต่อยังไง
- สิทธิ์ของ endpoint: เพิ่มใน `services/gateway/src/permissions.js`
- service ใหม่: สร้าง `services/<ชื่อ>` ใช้ `@pos/shared` (`internalAuth()`, `requireRole()`, `branchFilter()`, `validate()`, `ok()`)
- หน้าเว็บ: สร้างใน `web/src/pages/` แล้วผูกใน `web/src/router.jsx` (`PAGES`)
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
- โครงสร้าง monorepo: `services/<ชื่อ>` + `packages/shared` + npm workspaces

## ทดสอบ
- [x] `npm test` — identity 27, gateway 20 ผ่าน
- [x] เว็บ lint + build ผ่าน · CI ผ่านรวม `docker compose`
- [x] ทดสอบกับ Supabase จริง 60 รายการ (login, สิทธิ์, สาขา, ผู้ใช้, session)
- [x] ทดสอบหน้าเว็บ 3 role ในเบราว์เซอร์
