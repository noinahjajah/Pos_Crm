<div align="center">

# 🍽️ POS & CRM — ระบบขายหน้าร้าน 3 สาขา

ระบบ POS สำหรับร้านที่มี 3 สาขา (ร้านอาหาร · ร้านเครื่องดื่ม · บาร์)
เปิดโต๊ะ สั่งอาหาร ส่งเข้าครัว คิดเงิน ขออนุมัติส่วนลด/คืนเงิน จัดการเมนูและสต็อก พร้อมแดชบอร์ดกำไรรายสาขา

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3FCF8E?logo=supabase&logoColor=white)
![Architecture](https://img.shields.io/badge/Architecture-Microservices-orange)
![Phase](https://img.shields.io/badge/Phase-1-blue)

</div>

---
---

## 👥 ผู้จัดทำ

| ชื่อ-นามสกุล | บทบาท | GitHub |
|---|---|---|
| [67133846 วรัตถา เตนากุล] | full stack developer| [@warattha48](https://github.com/warattha48) |
| [67167033 เปมิกา เมฆลอย] | full stack developer | [@l0w0l-0](https://github.com/l0w0l-0) |
| [67180663 ภัทรพล ถ่อมดี] |full stack developer | [@noinahjajah](https://github.com/noinahjajah) |


> จัดทำในรายวิชา **CSI400 - เว็บเซอร์วิส**

---

## 📑 สารบัญ

- [ภาพรวมระบบ](#-ภาพรวมระบบ)
- [สถาปัตยกรรม](#️-สถาปัตยกรรม)
- [ทีมและขอบเขตงาน](#-ทีมและขอบเขตงาน)
- [โครงสร้าง Repository](#-โครงสร้าง-repository)
- [เริ่มต้นใช้งาน](#-เริ่มต้นใช้งาน)
- [ผู้ใช้และสิทธิ์](#-ผู้ใช้และสิทธิ์)
- [API](#-api)
- [ฐานข้อมูล](#️-ฐานข้อมูล)
- [Flow สำคัญ](#-flow-สำคัญ)
- [กติกาทางธุรกิจ](#-กติกาทางธุรกิจ)
- [แนวทางการทำงานร่วมกัน](#-แนวทางการทำงานร่วมกัน)

---

## ✨ ภาพรวมระบบ

| ด้าน | ทำอะไรได้ |
|---|---|
| 🪑 **หน้าร้าน** | เปิดโต๊ะ ย้าย/รวมโต๊ะ สั่งอาหารหลายรอบ เลือกตัวเลือก ใส่หมายเหตุ |
| 👨‍🍳 **ครัว** | ใบออร์เดอร์เข้าครัว จอครัวแจ้งตั๋วใหม่แบบ realtime |
| 💵 **คิดเงิน** | เงินสดพร้อมคิดเงินทอน · PromptPay (จำลอง) · ใบเสร็จแยก VAT |
| ✅ **อนุมัติ** | พนักงานขอส่วนลด/คืนเงิน → ผู้จัดการและเจ้าของอนุมัติแบบ realtime |
| 📦 **เมนูและสต็อก** | เมนูแยกตามสาขา กลุ่มตัวเลือก สต็อกตัดอัตโนมัติ หมดแล้วปิดขายเอง |
| 📊 **หลังร้าน** | รายจ่าย 4 หมวด · แดชบอร์ดรายวัน · เปรียบเทียบสาขา · กำไรรายเดือน |

---

## 🏗️ สถาปัตยกรรม

แยกเป็น **microservices** 4 ตัว ทุก request จากหน้าเว็บผ่าน **API Gateway** ที่เดียว
ใช้ Supabase project เดียว แต่แบ่ง **schema ตาม service** และไม่มี foreign key ข้าม schema



| | |
|---|---|
| 🔐 **Gateway** | ตรวจ JWT · เช็ก role · กำหนดสาขา · แนบ header `X-User-*` + `X-Internal-Key` แล้วส่งต่อ |
| 🔒 **Service** | ไม่เปิด port ออกนอก เชื่อ header เฉพาะเมื่อ `X-Internal-Key` ถูกต้อง |
| 🔗 **Internal API** | `/internal/*` ให้ service เรียกกันเองเท่านั้น gateway บล็อกจากภายนอกเสมอ |

---

## 👥 ทีมและขอบเขตงาน

| | Service | ขอบเขต (requirement เฟส 1) |
|---|---|---|
| **Dev 1** | 👤 identity · 🚪 gateway | ผู้ใช้ สิทธิ์ สาขา, login, gateway, Docker Compose, หน้า login/layout/ผู้ใช้/สาขา, layout งานพิมพ์ · `1.1–1.6`, `1.10` |
| **Dev 2** | 📦 catalog · 💵 payment | เมนู ตัวเลือก สต็อก, รับเงิน คืนเงิน รายจ่าย รายงาน, หน้าหลังร้านและคิดเงิน · `1.14–1.22`, `1.25`, `1.32–1.37` |
| **Dev 3** | 🧾 pos | โต๊ะ ออร์เดอร์ ตั๋วครัว คำขออนุมัติ, หน้าโต๊ะ สั่งอาหาร จอครัว · `1.7–1.13`, `1.23–1.24`, `1.26–1.31` |

---

## 📁 โครงสร้าง Repository

```text
Pos_Crm/
├── services/
│   ├── gateway/        🚪 :8080  ตรวจ JWT · route guard · proxy
│   ├── identity/       👤 :3001  login · ผู้ใช้ · สาขา
│   ├── catalog/        📦 :3002  หมวดหมู่ · เมนู · ตัวเลือก · สต็อก
│   ├── pos/            🧾 :3003  โต๊ะ · ออร์เดอร์ · ครัว · อนุมัติ
│   └── payment/        💵 :3004  รับเงิน · คืนเงิน · รายจ่าย · รายงาน
├── supabase/           🗄️  SQL สร้าง schema และฟังก์ชัน
├── web/
│   └── src/
│       ├── app/        router · providers
│       ├── api/        ที่เดียวที่เรียก backend (1 ไฟล์ต่อ 1 service)
│       ├── features/   1 โฟลเดอร์ = 1 ฟีเจอร์ (หน้า + component)
│       │   ├── auth/  tables/  orders/  kitchen/
│       │   ├── checkout/  approvals/
│       │   └── backoffice/  menus/ stocks/ users/ expenses/ reports/
│       ├── components/ ui/ · layout/
│       └── lib/        supabase (realtime) · format · constants
└── เอกสาร/             📄 spec · ER diagram · API gateway
```

---

## 🚀 เริ่มต้นใช้งาน

### สิ่งที่ต้องมี

- **Node.js 20** ขึ้นไป
- โปรเจกต์ **Supabase** (ขอ URL และ key จากหัวหน้าทีม)

### 1. ตั้งค่าฐานข้อมูล (ครั้งแรกครั้งเดียว)

1. รัน SQL ใน `supabase/migrations/` เรียงตามชื่อไฟล์ที่ **SQL Editor** (`identity1`, `catalog` และ `payment` รันซ้ำได้)
2. **Project Settings → Data API → Exposed schemas** เพิ่ม `identity1`, `catalog`, `pos`, `payment`
3. **Authentication → Hooks** เปิด *Custom access token hook* แล้วเลือก `identity1.custom_access_token_hook` (ใส่ `user_role` และ `branch_id` ลง JWT)
4. สร้างบัญชีใน **Authentication → Users** แล้วเพิ่มแถวใน `identity1.profiles` ให้แต่ละบัญชี

### 2. ตั้งค่า `.env` ของแต่ละ service

ทุก service มี `.env` ของตัวเอง โดยใช้ค่าร่วมกันแบบนี้

```env
PORT=3002                                   # ต่างกันทุก service
INTERNAL_KEY=ต้องเหมือนกันทุก service
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx    # ใช้ฝั่ง server เท่านั้น
```

> [!CAUTION]
> ห้าม commit ไฟล์ `.env` และห้ามใส่ `SUPABASE_SERVICE_ROLE_KEY` ในหน้าเว็บ key นี้ข้ามสิทธิ์ทุกอย่างในฐานข้อมูล

### 3. รัน

เปิด terminal แยกทีละ service

```bash
cd services/identity && npm install && npm run dev   # :3001
cd services/catalog  && npm install && npm run dev   # :3002
cd services/pos      && npm install && npm run dev   # :3003
cd services/payment  && npm install && npm run dev   # :3004
cd services/gateway  && npm install && npm run dev   # :8080
cd web               && npm install && npm run dev   # :5173
```

ทุก service มี `GET /health` ไว้เช็กว่าทำงานและต่อฐานข้อมูลได้

---

## 🔑 ผู้ใช้และสิทธิ์

| Role | ใคร | เห็นข้อมูล |
|---|---|---|
| **S** · `staff` | พนักงานหน้าร้าน (รวม waiter + cashier เพราะใช้ POS เครื่องเดียว) | สาขาตัวเอง |
| **M** · `manager` | ผู้จัดการสาขา | สาขาตัวเอง |
| **O** · `owner` | เจ้าของร้าน | ทุกสาขา เลือกดูทีละสาขาด้วย `?branch_id=` |

- ไม่มีสิทธิ์ → **403**
- staff/manager ส่ง `branch_id` ของสาขาอื่นมา → gateway ไม่สนใจ และใช้สาขาจาก JWT แทน

---

## 🔌 API

Base URL: `http://localhost:8080/api/v1/<service>`

<details>
<summary><b>👤 identity</b></summary>

| Method | Path | Role |
|---|---|---|
| POST | `/auth/login` · `/auth/refresh` | public |
| POST | `/auth/logout` | S M O |
| GET | `/me` · `/branches` | S M O |
| POST · PATCH · DELETE | `/branches` | O |
| GET | `/roles` | O |
| GET | `/users` | M O (manager เห็นเฉพาะสาขาตัวเอง) |
| POST · PATCH · DELETE | `/users` | O |

</details>

<details>
<summary><b>📦 catalog</b></summary>

| Method | Path | Role |
|---|---|---|
| GET | `/categories` · `/menus` · `/menus/:id` · `/option-groups` | S M O |
| PATCH | `/menus/:id/availability` | S M O |
| POST · PATCH · DELETE | `/menus` · `PUT /menus/:id/option-groups` | M O |
| POST · PATCH | `/option-groups` · `/option-groups/:id/options` · `/options/:id` | M O |
| GET · PATCH | `/stocks` · `/stocks/:menuId` (`{quantity}` หรือ `{add}`) | M O |
| POST · PATCH | `/categories` | O |
| POST | `/menus/:id/copy` | O |

</details>

<details>
<summary><b>🧾 pos</b></summary>

| Method | Path | Role |
|---|---|---|
| GET | `/tables` · `/orders` · `/orders/:id` | S M O |
| POST · PATCH | `/tables` | M O |
| POST | `/orders` · `/orders/:id/tickets` · `/orders/:id/request-payment` | S M |
| POST | `/orders/:id/tables/move` · `/orders/:id/tables/merge` | S M |
| GET · PATCH | `/kitchen/tickets` | S M |
| POST | `/orders/:id/approvals` | S |
| GET · POST | `/approvals` · `/approvals/:id/approve` · `/approvals/:id/reject` | M O |

</details>

<details>
<summary><b>💵 payment</b></summary>

| Method | Path | Role |
|---|---|---|
| POST | `/payments` (header `Idempotency-Key`) · `/refunds` | S M |
| GET | `/orders` · `/orders/:id` · `/refunds/approved` | S M |
| GET | `/payments` | M O |
| GET · POST · PATCH · DELETE | `/expenses` | M O |
| GET | `/reports/daily` | M O |
| GET | `/reports/branches` · `/reports/profit` | O |

</details>

<details>
<summary><b>🔗 Internal API</b> (service เรียกกันเอง ต้องมี <code>X-Internal-Key</code>)</summary>

| จาก → ไป | Endpoint | ใช้ตอนไหน |
|---|---|---|
| catalog, payment → identity | `GET /internal/branches/:id` | ตรวจว่าสาขามีจริงและเปิดใช้ |
| pos → catalog | `POST /internal/menus/lookup` | ดึงชื่อ/ราคาไปเก็บ snapshot |
| pos → catalog | `POST /internal/stocks/deduct` | ตัดสต็อกตอนสั่ง |
| pos → catalog | `POST /internal/stocks/restore` | คืนสต็อกเมื่อสั่งไม่สำเร็จ |
| payment → pos | `GET /internal/orders/:id/summary` | ยอดที่ต้องจ่ายและสถานะบิล |
| payment → pos | `POST /internal/orders/:id/mark-paid` | ปิดบิล คืนโต๊ะเป็นว่าง |
| payment → pos | `POST /internal/orders/:id/mark-refunded` | อัปเดตบิลหลังคืนเงิน |
| payment → pos | `GET /internal/approvals/:id` | ข้อมูลคำขอคืนเงิน |
| payment → pos | `GET /internal/orders?status=waiting_payment&branch_id=` | บิลรอชำระของสาขา |
| payment → pos | `GET /internal/approvals?type=refund&status=approved&branch_id=` | คำขอคืนเงินที่อนุมัติแล้ว |

</details>

### รูปแบบ response

```jsonc
// สำเร็จ
{ "data": { }, "meta": { "page": 1, "total": 42 } }

// ผิดพลาด
{ "error": { "code": "STOCK_NOT_ENOUGH", "message": "เมนูบางรายการหมด", "details": [] } }
```

| HTTP | ใช้เมื่อ |
|:---:|---|
| `400` | ข้อมูลไม่ถูกต้อง |
| `401` | ไม่ได้ login หรือ token หมดอายุ |
| `403` | role หรือสาขาไม่มีสิทธิ์ |
| `404` | ไม่พบข้อมูล |
| `409` | สถานะไม่ถูกต้อง เช่น สต็อกไม่พอ บิลจ่ายแล้ว |
| `429` | เรียกถี่เกินไป |
| `502` · `504` | service ปลายทางล่มหรือตอบช้า |

---

## 🗄️ ฐานข้อมูล

| Schema | ตาราง |
|---|---|
| 👤 `identity` | `branches` · `roles` · `profiles` (+ `auth.users` ของ Supabase) |
| 📦 `catalog` | `categories` · `menus` · `option_groups` · `options` · `menu_option_groups` · `stocks` · `stock_movements` |
| 🧾 `pos` | `dining_tables` · `orders` · `order_tables` · `kitchen_tickets` · `order_items` · `order_item_options` · `approvals` · `refund_items` |
| 💵 `payment` | `payments` · `expenses` |


---

## 🔄 Flow สำคัญ


## 📐 กติกาทางธุรกิจ

| เรื่อง | กติกา |
|---|---|
| 🧮 **VAT** | `vat = (subtotal − discount) × 7%` · `total = subtotal − discount + vat` |
| 🏷️ **ราคาในบิล** | เก็บชื่อและราคาตอนสั่งเป็น snapshot แก้เมนูทีหลังบิลเก่าไม่เปลี่ยน |
| 📦 **สต็อก** | ตัดทันทีตอนสั่ง (ตัดครบหรือไม่ตัดเลย) · เหลือ 0 ปิดขายอัตโนมัติ · เติมจาก 0 **ไม่**เปิดขายให้ ต้องกดเปิดเอง |
| 🏪 **เมนู** | เป็นของแต่ละสาขา · หมวดหมู่เป็นของกลาง (owner จัดการ) · owner คัดลอกเมนูข้ามสาขาได้ |
| 💳 **การจ่าย** | 1 บิลจ่ายได้ครั้งเดียว · กดซ้ำด้วย `Idempotency-Key` เดิมไม่รับเงินซ้ำ · ไม่มีการแยกบิล |
| ↩️ **คืนเงิน** | เฉพาะบิลที่จ่ายแล้ว · ต้องได้รับอนุมัติ · ไม่คืนสต็อก · คืนรวมไม่เกินยอดที่จ่าย |
| 📝 **คำขออนุมัติ** | บันทึกผู้ขอ ผู้อนุมัติ เวลา เหตุผล · **ห้ามลบ** |
| 📊 **รายงาน** | รายรับ = รับเงิน − คืนเงิน · กำไร = รายรับ − รายจ่าย · นับวันและเดือนตามเวลาไทย |

---

## 🤝 แนวทางการทำงานร่วมกัน

| เรื่อง | ข้อตกลง |
|---|---|
| 🌿 **Branch** | ทำงานใน branch ของตัวเอง → เปิด Pull Request เข้า `main` |
| 🔄 **ก่อน push** | `git fetch origin` → `git merge origin/main` แก้ conflict ให้เรียบร้อยก่อน |
| 🗂️ **ขอบเขตไฟล์** | แก้เฉพาะ service และโฟลเดอร์ใน `features/` ของตัวเอง ไฟล์กลางตกลงกันก่อน |
| 🗄️ **ฐานข้อมูล** | แต่ละ service ใช้ schema ของตัวเองเท่านั้น ข้อมูลข้าม service ขอผ่าน API |
| 🔐 **ความลับ** | `.env` ไม่ขึ้น git · แชร์ key ผ่านช่องทางส่วนตัวของทีม |

<div align="center">

---

**POS & CRM** · เฟส 1 · โปรเจกต์กลุ่ม

</div>
