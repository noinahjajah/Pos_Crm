# POS CRM — เฟส 1

เอกสาร requirement / ERD / API อยู่ที่ [`เอกสาร/pos-crm-phase1-spec.md`](เอกสาร/pos-crm-phase1-spec.md)

```
packages/shared/      ของที่ทุก service ใช้ร่วมกัน (response/error, zod helper, อ่าน header X-User-*)
services/gateway/     API Gateway :8080 — middleware 10 ตัว + ตารางสิทธิ์ (permissions.js)     ← Dev 1
services/identity/    identity :3001 — login, me, สาขา, role, ผู้ใช้                            ← Dev 1
services/catalog|pos|payment/                                                                    ← Dev 2 / Dev 3 เพิ่มเอง
supabase/             migration ของ schema identity + custom access token hook, seed สาขา
scripts/              ออก token ทดสอบ 3 role / สร้างผู้ใช้ทดสอบใน Supabase
web/                  React (Vite) — login, layout + เมนูตาม role, ผู้ใช้, สาขา, layout พิมพ์ 80mm
```

## รันบนเครื่อง (ยังไม่ต่อ Supabase)

ตอนนี้ตั้งค่าเริ่มต้นเป็น `DATA_MODE=memory`: identity เก็บข้อมูลในหน่วยความจำและออก JWT เอง (claim เหมือน Supabase) ไม่ต้องมี Supabase

```bash
cp .env.example .env
npm install                 # backend (workspaces)
npm run dev                 # identity :3001 + gateway :8080

cd web && npm install && npm run dev   # เว็บ http://localhost:5173 (ส่ง /api ต่อให้ gateway)
```

ผู้ใช้ทดสอบ (รหัสผ่าน `password123`): `owner`, `manager1` (สาขาร้านอาหาร), `staff1` (สาขาร้านอาหาร)

หรือใช้ Docker: `docker compose up --build` (เปิดแค่ :8080) · เพิ่ม `--profile web` เพื่อเปิดเว็บที่ :5173

## ระบบเข้าสู่ระบบ (1.2)

- login ด้วย username + password → ได้ access token (อายุ 15 นาที) + refresh token (ใช้ได้ครั้งเดียว) · เว็บต่ออายุให้อัตโนมัติก่อนหมด 1 นาที และซิงก์กันทุกแท็บ
- ใส่รหัสผิดติดกัน 5 ครั้ง → ล็อก username 15 นาที (`ACCOUNT_LOCKED`) · gateway จำกัด `/auth/login` 10 ครั้ง/นาที/IP อีกชั้น
- owner สร้างผู้ใช้หรือรีเซ็ตรหัส = รหัสชั่วคราว → ผู้ใช้ถูกพาไปหน้า "บัญชีของฉัน" ให้ตั้งรหัสใหม่ก่อนใช้งาน (รีเซ็ตแล้วปลดล็อกให้ด้วย)
- เปลี่ยนรหัสผ่านเอง `POST /identity/auth/change-password` → session อื่นทุกเครื่องถูกยกเลิก
- รหัสผ่าน: 8–72 ตัว มีตัวอักษรภาษาอังกฤษและตัวเลข · บันทึกเวลาเข้าใช้ล่าสุด (`last_login_at`)
- ลบผู้ใช้ / ปิดบัญชี → refresh ไม่ได้และ login ไม่ได้ทันที

## ทดสอบ

```bash
npm test                    # identity 26 เคส + gateway 17 เคส
cd web && npm run lint && npm run build
```

## token ทดสอบ 3 role (สำหรับ Dev 2 / Dev 3)

```bash
npm run tokens              # พิมพ์ export TOKEN_STAFF / TOKEN_MANAGER / TOKEN_OWNER
curl -H "Authorization: Bearer $TOKEN_STAFF" http://localhost:8080/api/v1/identity/me
```

## Dev 2 / Dev 3: เพิ่ม service ของตัวเอง

1. สร้าง `services/<ชื่อ>/` มี `package.json` (`"name": "@pos/<ชื่อ>"`, dependency `"@pos/shared": "*"`) และ `src/server.js` ที่ตอบ `GET /health`
2. ใช้ middleware กลาง — service จะรับเฉพาะ request จาก gateway และได้ `req.user = { id, role, branchId }`

   ```js
   import { internalAuth, requestId, requireRole, ok, errors, errorHandler, branchFilter, resolveBranchId } from '@pos/shared';
   app.use(requestId());
   app.use(internalAuth({ internalKey: process.env.INTERNAL_KEY }));
   app.get('/menus', requireRole('staff', 'manager', 'owner'), (req, res) => ok(res, rows));
   app.use(errorHandler());
   ```
   `branchFilter(req)` = สาขาที่ต้องกรอง (null = owner ดูทุกสาขา) · `resolveBranchId(req, body.branch_id)` = สาขาที่ใช้ตอนสร้างข้อมูล
3. สิทธิ์ของ endpoint แก้ที่ `services/gateway/src/permissions.js` ไฟล์เดียว (ใส่ไว้ครบตาม spec ข้อ 4 แล้ว)
4. หน้าเว็บ: เมนูและสิทธิ์อยู่ใน `MENU` (`web/src/components/ui.jsx`) · ผูกหน้าใน `PAGES` ของ `web/src/app/router.jsx` แทนหน้าว่าง
5. ใบพิมพ์: ใช้ `<KitchenTicket>` และ `<Receipt>` จาก `web/src/pages/PrintPage.jsx` ส่งข้อมูลจาก `POST /orders/:id/tickets` และ `GET /orders/:id`

## ตอนพร้อมต่อ Supabase

1. รัน `supabase/migrations/20261117000100_identity.sql` แล้ว `supabase/seed.sql`
2. Dashboard → Authentication → Hooks → Customize Access Token → เลือก `identity.custom_access_token_hook`
3. Dashboard → Project Settings → API → Exposed schemas → เพิ่ม `identity`
4. ใน `.env` ตั้ง `DATA_MODE=supabase`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (gateway ตรวจ token ผ่าน JWKS อัตโนมัติ)
5. `SEED_PASSWORD=... npm run seed:users` สร้างผู้ใช้ทดสอบ 3 role

## สิ่งที่ Dev 1 ตัดสินใจเพิ่มจาก spec (ให้ทีมยืนยัน)

- เพิ่ม `GET /branches/:id` (S M O) และ `GET /users/:id` (M O) ไว้ใช้กับฟอร์มแก้ไข
- ปิด/ลบสาขาที่ยังมีผู้ใช้ใช้งานอยู่ไม่ได้ → 409 `BRANCH_HAS_ACTIVE_USERS` (ต้องย้ายหรือลบผู้ใช้ก่อน)
- owner ลบตัวเอง / ลด role ตัวเองไม่ได้ · staff/manager ต้องมีสาขา, owner ไม่มีสาขา
- endpoint ที่ไม่อยู่ในตารางสิทธิ์ → 404 (ปฏิเสธไว้ก่อน) · method ผิด → 405
- ใส่ `GET /pos/kitchen/stream` (S M) ในตารางสิทธิ์ไว้ก่อน ตามประเด็นที่ยังเปิด 9.4
- Supabase mode: เปลี่ยน role/สาขาของผู้ใช้มีผลเมื่อ access token หมดอายุแล้ว refresh (ตั้ง JWT expiry สั้น เช่น 15 นาที) · ลบผู้ใช้ = ban ใน Supabase Auth
- ใบเสร็จแสดงตามสูตร 1.24 (ราคาเมนูยังไม่รวม VAT) ซึ่งยังเป็นประเด็นเปิด 9.1
