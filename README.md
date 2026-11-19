<div align="center">

# 🍽️ POS & CRM — ระบบขายหน้าร้าน 3 สาขา

ระบบ POS สำหรับร้านที่มี 3 สาขา (ร้านอาหาร · ร้านเครื่องดื่ม · บาร์)<br>
เปิดโต๊ะ สั่งอาหาร ส่งเข้าครัว คิดเงิน ขออนุมัติส่วนลด/คืนเงิน จัดการเมนูและสต็อก พร้อมแดชบอร์ดกำไรรายสาขา

![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)
![Express](https://img.shields.io/badge/Express-5-000000?logo=express&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-646CFF?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3FCF8E?logo=supabase&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?logo=docker&logoColor=white)
![Architecture](https://img.shields.io/badge/Architecture-Microservices-orange)
![Phase](https://img.shields.io/badge/Phase-1-blue)

[![Figma Prototype](https://img.shields.io/badge/▶_Figma-Prototype-F24E1E?logo=figma&logoColor=white)](https://www.figma.com/proto/pWc3YWHYawV6L3Ykm57Ke5?node-id=3-2&starting-point-node-id=3%3A2)
[![Figma Design](https://img.shields.io/badge/Figma-Design_File-A259FF?logo=figma&logoColor=white)](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5)
[![Report](https://img.shields.io/badge/📄-รายงานโปรเจกต์-555)](เอกสาร/REPORT.md)
[![UAT](https://img.shields.io/badge/🧪-UAT_49_เคส-2E6B5A)](เอกสาร/UAT.md)

</div>

---

## 👥 ผู้จัดทำ

| รหัสนักศึกษา | ชื่อ-นามสกุล | ตำแหน่ง | รับผิดชอบ | GitHub |
|---|---|---|---|---|
| 67167033 | เปมิกา เมฆลอย | Full Stack Developer | **Dev 1** · identity · gateway · Docker | [@l0w0l-0](https://github.com/l0w0l-0) |
| 67133846 | วรัตถา เตนากุล | Full Stack Developer | **Dev 2** · catalog · payment · รายงาน | [@warattha48](https://github.com/warattha48) |
| 67180663 | ภัทรพล ถ่อมดี | Full Stack Developer | **Dev 3** · pos (โต๊ะ ออร์เดอร์ ครัว อนุมัติ) | [@noinahjajah](https://github.com/noinahjajah) |

> จัดทำในรายวิชา **CSI400 – เว็บเซอร์วิส**

---

## 📑 สารบัญ

- [ภาพรวมระบบ](#-ภาพรวมระบบ)
- [Prototype (Figma)](#-prototype-figma)
- [สถาปัตยกรรม](#️-สถาปัตยกรรม)
- [ความคืบหน้า](#-ความคืบหน้า)
- [โครงสร้าง Repository](#-โครงสร้าง-repository)
- [เริ่มต้นใช้งาน](#-เริ่มต้นใช้งาน)
- [ผู้ใช้และสิทธิ์](#-ผู้ใช้และสิทธิ์)
- [API](#-api)
- [ฐานข้อมูล](#️-ฐานข้อมูล)
- [Flow สำคัญ](#-flow-สำคัญ)
- [กติกาทางธุรกิจ](#-กติกาทางธุรกิจ)
- [เอกสาร รายงาน และ UAT](#-เอกสาร-รายงาน-และ-uat)
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

## 🎨 Prototype (Figma)

ออกแบบหน้าจอก่อนลงมือเขียนโค้ด สี ฟอนต์ และ component ของเว็บใช้ตามไฟล์นี้

| | ลิงก์ |
|---|---|
| ▶️ **ทดลองกดใช้งาน** | [เปิด Prototype](https://www.figma.com/proto/pWc3YWHYawV6L3Ykm57Ke5?node-id=3-2&starting-point-node-id=3%3A2) · เริ่มที่หน้า Login |
| 🎨 **ไฟล์ออกแบบ** | [เปิดไฟล์ Figma](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5) |

| # | หน้าจอ | Role | Requirement |
|:---:|---|:---:|---|
| 01 | [Login](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5?node-id=3-2) · บัญชีทดสอบแยกตาม role | ทุก role | 1.1 · 1.2 |
| 02 | [Owner Dashboard](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5?node-id=3-74) · ภาพรวมทุกสาขา | O | 1.4 · 1.34 · 1.36 |
| 03 | [Manager Dashboard](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5?node-id=4-56) · เห็นเฉพาะสาขาตัวเอง | M | 1.3 · 1.27 |
| 04 | [จัดการผู้ใช้](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5?node-id=4-237) · กำหนด role และสาขา | O | 1.5 |
| 05 | [คำขอรออนุมัติ](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5?node-id=5-137) · อนุมัติ/ปฏิเสธ ส่วนลดและคืนเงิน | M O | 1.29 – 1.31 |
| 06 | [Audit Log](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5?node-id=5-385) · ใคร ทำอะไร ที่ไหน เมื่อไหร่ | O | 1.31 |

**วิธีดู:** เปิดลิงก์ Prototype แล้วคลิกบนหน้าจอได้เลย — **เข้าสู่ระบบ** → Owner Dashboard · บัญชีทดสอบ Owner/Manager → แดชบอร์ดของ role นั้น · เมนูซ้ายสลับหน้า · ชื่อผู้ใช้มุมล่างซ้าย → กลับหน้า Login

**Design system:** Button · Badge · NavItem · KPI · Input (กรอบ 🧩 Components ในไฟล์) · ฟอนต์ IBM Plex Sans Thai

| สี | Hex | ใช้กับ |
|---|---|---|
| 🟩 เขียว | `#2E6B5A` | ปุ่มหลัก เมนูที่เลือก |
| 🟫 น้ำตาล | `#B5481E` | ปุ่มอันตราย คืนเงิน |
| ⬛ เข้ม | `#1E1C1A` | แถบเมนูด้านซ้าย ตัวอักษร |
| ⬜ พื้น | `#F4F2EE` | พื้นหลังหน้า |

---

## 🏗️ สถาปัตยกรรม

แยกเป็น **microservices** ทุก request จากหน้าเว็บผ่าน **API Gateway** ที่เดียว
ใช้ Supabase project เดียว แต่แบ่ง **schema ตาม service** และไม่มี foreign key ข้าม schema

```mermaid
flowchart LR
  web["🖥️ web<br/>React + Vite<br/>:5173 / :8000"] -->|/api/v1/*| gw["🚪 gateway :8080<br/>JWT · role · สาขา"]
  gw -->|X-User-* + X-Internal-Key| id["👤 identity :3001"]
  gw --> cat["📦 catalog :3002"]
  gw --> pos["🧾 pos :3003"]
  gw --> pay["💵 payment :3004"]
  pos -.->|/internal/menus · stocks| cat
  pay -.->|/internal/orders · approvals| pos
  id & cat & pos & pay --> db[("🗄️ Supabase<br/>1 project · แยก schema")]
```

| | |
|---|---|
| 🔐 **Gateway** | ตรวจ JWT · เช็ก role · กำหนดสาขา · แนบ header `X-User-*` + `X-Internal-Key` แล้วส่งต่อ |
| 🔒 **Service** | ไม่เปิด port ออกนอก เชื่อ header เฉพาะเมื่อ `X-Internal-Key` ถูกต้อง |
| 🔗 **Internal API** | `/internal/*` ให้ service เรียกกันเองเท่านั้น gateway บล็อกจากภายนอกเสมอ |
| ⚡ **Realtime** | จอครัวและการแจ้งคำขออนุมัติ อัปเดตทันทีโดยไม่ต้องรีเฟรช |

---

## 📈 ความคืบหน้า

> ✅ อยู่ใน `main` แล้ว · 🔄 ทำเสร็จใน branch ของผู้รับผิดชอบ รอ Pull Request · 🧩 มีไฟล์แล้ว ยังไม่ได้เชื่อมเข้าแอป · ⏳ ยังไม่เริ่ม

| ส่วน | ผู้รับผิดชอบ | สถานะ | หมายเหตุ |
|---|---|:---:|---|
| 📦 catalog service | Dev 2 | ✅ | หมวด เมนู (รูป) ตัวเลือก สต็อก คัดลอกเมนู internal API |
| 💵 payment service | Dev 2 | ✅ | รับเงิน คืนเงิน รายจ่าย รายงาน · ตอนนี้ใช้บิลจำลอง (`POS_MODE=mock`) |
| 🐳 Docker Compose (catalog · payment · web) | Dev 2 | ✅ | `docker compose up` และโหมดพัฒนา `watch` |
| 🖥️ หน้าหลังร้าน + หน้าคิดเงิน | Dev 2 | 🧩 | ไฟล์อยู่ใน `web/src/features/` รอ router และ `api/client.js` |
| 👤 identity · 🚪 gateway | Dev 1 | 🔄 | branch `dev1-identity` · login, ผู้ใช้, สาขา, JWT, route guard |
| 🖥️ login · layout · ผู้ใช้ · สาขา · งานพิมพ์ | Dev 1 | 🔄 | branch `dev1-identity` · router, `api/client.js` และ layout ของทั้งแอป |
| 🧾 pos service + หน้าโต๊ะ สั่งอาหาร จอครัว อนุมัติ | Dev 3 | ⏳ | — |
| 🗄️ SQL ของฐานข้อมูล (`supabase/`) | ทุกคน | ⏳ | ตารางสร้างใน Supabase แล้ว ยังไม่ได้เก็บไฟล์ SQL ใน repo |

รายละเอียดดูที่ [📄 รายงานโปรเจกต์](เอกสาร/REPORT.md)

---

## 📁 โครงสร้าง Repository

```text
Pos_Crm/
├── services/
│   ├── catalog/        📦 :3002  หมวดหมู่ · เมนู · ตัวเลือก · สต็อก
│   │   ├── server.js         จุดเริ่ม + /health
│   │   ├── categories.js · menus.js · optionGroups.js · stocks.js
│   │   ├── internal.js       /internal/* ให้ pos เรียก
│   │   └── db.js · helpers.js · Dockerfile · .env.example
│   ├── payment/        💵 :3004  รับเงิน · คืนเงิน · รายจ่าย · รายงาน
│   │   ├── server.js
│   │   ├── payments.js · expenses.js · reports.js
│   │   ├── pos.js            เรียก pos (หรือบิลจำลองเมื่อ POS_MODE=mock)
│   │   └── db.js · helpers.js · Dockerfile · .env.example
│   ├── identity/       👤 :3001  login · ผู้ใช้ · สาขา            (🔄 dev1-identity)
│   ├── gateway/        🚪 :8080  ตรวจ JWT · route guard · proxy  (🔄 dev1-identity)
│   └── pos/            🧾 :3003  โต๊ะ · ออร์เดอร์ · ครัว · อนุมัติ  (⏳ Dev 3)
├── web/                🖥️  React 19 + Vite
│   ├── src/
│   │   ├── app/        router · providers
│   │   ├── api/        ที่เดียวที่เรียก backend (1 ไฟล์ต่อ 1 service)
│   │   └── features/
│   │       ├── checkout/     รับเงิน · PromptPay จำลอง · ใบเสร็จ
│   │       └── backoffice/   menus/ stocks/ expenses/ reports/
│   ├── Dockerfile      dev (Vite) / build / nginx
│   └── nginx.conf      ส่ง /api ต่อให้ gateway
├── docker-compose.yml      รันทั้งระบบ
├── docker-compose.dev.yml  โหมดพัฒนา แก้โค้ดแล้ว reload เอง
└── เอกสาร/
    ├── pos-crm-phase1-spec.md         requirement · ERD · API · แบ่งงาน
    ├── frontend-folder-structure.md   โครงสร้าง web
    ├── POS-CRM-Database-Microservices.png
    ├── REPORT.md                      รายงานโปรเจกต์
    └── UAT.md                         แผนและผลการทดสอบ
```

---

## 🚀 เริ่มต้นใช้งาน

### สิ่งที่ต้องมี

- **Node.js 20** ขึ้นไป (หรือ **Docker Desktop**)
- โปรเจกต์ **Supabase** ของทีม (ขอ URL และ key จากหัวหน้าทีม)

### 1. ตั้งค่า `.env` ของแต่ละ service

คัดลอก `.env.example` เป็น `.env` ในโฟลเดอร์ของ service แล้วใส่ค่าจริง

```bash
cp services/catalog/.env.example services/catalog/.env
cp services/payment/.env.example services/payment/.env
```

```env
INTERNAL_KEY=ต้องเหมือนกันทุก service
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxx    # ใช้ฝั่ง server เท่านั้น
MENU_IMAGE_BUCKET=menu-images               # catalog: bucket รูปเมนู
POS_MODE=mock                               # payment: mock = บิลจำลอง · http = เรียก pos จริง
```

> [!CAUTION]
> ห้าม commit ไฟล์ `.env` และห้ามใส่ `SUPABASE_SERVICE_ROLE_KEY` ในหน้าเว็บ key นี้ข้ามสิทธิ์ทุกอย่างในฐานข้อมูล

### 2a. รันด้วย Docker (แนะนำ)

```bash
docker compose up -d --build       # เว็บ http://localhost:8000
docker compose down                # ปิด

# โหมดพัฒนา: แก้โค้ดแล้ว reload เอง · เว็บ http://localhost:5173
docker compose -f docker-compose.yml -f docker-compose.dev.yml watch
```

### 2b. รันทีละ service (ไม่ใช้ Docker)

เปิด terminal แยกทีละตัว

```bash
cd services/catalog && npm install && npm run dev   # :3002
cd services/payment && npm install && npm run dev   # :3004
cd web              && npm install && npm run dev   # :5173
```

### 3. เช็กว่าทำงาน

ทุก service มี `GET /health` ตอบ `{"status":"ok"}` เมื่อทำงานและต่อฐานข้อมูลได้

```bash
curl http://localhost:3002/health   # catalog
curl http://localhost:3004/health   # payment
```

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

Base URL: `http://localhost:8080/api/v1/<service>` (ผ่าน gateway)

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
<summary><b>📦 catalog</b> ✅</summary>

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
<summary><b>💵 payment</b> ✅</summary>

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
| pos → catalog | `POST /internal/menus/lookup` ✅ | ดึงชื่อ/ราคาไปเก็บ snapshot |
| pos → catalog | `POST /internal/stocks/deduct` ✅ | ตัดสต็อกตอนสั่ง |
| pos → catalog | `POST /internal/stocks/restore` ✅ | คืนสต็อกเมื่อสั่งไม่สำเร็จ |
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

![ER Diagram](เอกสาร/POS-CRM-Database-Microservices.png)

| Schema | ตาราง |
|---|---|
| 👤 `identity` | `branches` · `roles` · `profiles` (+ `auth.users` ของ Supabase) |
| 📦 `catalog` | `categories` · `menus` · `option_groups` · `options` · `menu_option_groups` · `stocks` · `stock_movements` |
| 🧾 `pos` | `dining_tables` · `orders` · `order_tables` · `kitchen_tickets` · `order_items` · `order_item_options` · `approvals` · `refund_items` |
| 💵 `payment` | `payments` · `expenses` |

รายละเอียดคอลัมน์และความสัมพันธ์อยู่ใน [`เอกสาร/pos-crm-phase1-spec.md`](เอกสาร/pos-crm-phase1-spec.md) หัวข้อ 3

---

## 🔄 Flow สำคัญ

### สั่งอาหาร 1 รอบ

```mermaid
sequenceDiagram
  actor S as staff
  participant P as pos
  participant C as catalog
  S->>P: POST /orders/:id/tickets
  P->>C: /internal/menus/lookup (ชื่อ ราคา ตัวเลือก)
  P->>C: /internal/stocks/deduct (ตัดครบหรือไม่ตัดเลย)
  P->>P: บันทึกตั๋วครัว + รายการ (snapshot ราคา)
  P-->>S: ใบออร์เดอร์เข้าครัว
  Note over P: จอครัวได้ตั๋วใหม่แบบ realtime
```

### รับเงิน

```mermaid
sequenceDiagram
  actor S as staff
  participant Y as payment
  participant P as pos
  S->>Y: POST /payments (Idempotency-Key)
  Y->>P: /internal/orders/:id/summary (ยอดที่ต้องจ่าย)
  Y->>Y: บันทึกการรับเงิน คิดเงินทอน
  Y->>P: /internal/orders/:id/mark-paid
  Note over P: บิลปิด · ทุกโต๊ะของบิลกลับเป็นว่าง
  Y-->>S: ใบเสร็จ (ก่อน VAT · VAT · สุทธิ)
```

### ขอส่วนลด / คืนเงิน

```mermaid
sequenceDiagram
  actor S as staff
  participant P as pos
  actor M as manager / owner
  S->>P: POST /orders/:id/approvals (เหตุผล)
  P-->>M: แจ้งคำขอใหม่ realtime
  M->>P: approve / reject
  Note over P: มีผลเฉพาะคำขอที่ approved · บันทึกผู้ขอ ผู้อนุมัติ เวลา (ห้ามลบ)
```

---

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

## 📚 เอกสาร รายงาน และ UAT

| เอกสาร | เนื้อหา |
|---|---|
| 📄 [รายงานโปรเจกต์](เอกสาร/REPORT.md) | ที่มา ขอบเขต สถาปัตยกรรม การออกแบบ ความคืบหน้า ปัญหาและแนวทางต่อ |
| 🧪 [UAT](เอกสาร/UAT.md) | แผนทดสอบการยอมรับของผู้ใช้ 49 เคส ครบ requirement `1.1 – 1.37` พร้อมช่องบันทึกผลและลงนาม |
| 📋 [Spec เฟส 1](เอกสาร/pos-crm-phase1-spec.md) | requirement · ERD · API gateway · แบ่งงาน |
| 🗂️ [โครงสร้าง Frontend](เอกสาร/frontend-folder-structure.md) | การแบ่งโฟลเดอร์ของ `web/` |
| 🎨 [Figma](https://www.figma.com/design/pWc3YWHYawV6L3Ykm57Ke5) | Prototype หน้าจอและ design system |

| หมวด UAT | Requirement | เคส |
|---|---|:---:|
| 👤 ผู้ใช้ สิทธิ์ และสาขา | 1.1 – 1.6 | 10 |
| 🪑 โต๊ะและออร์เดอร์ | 1.7 – 1.13 | 9 |
| 📦 เมนู ตัวเลือก สต็อก | 1.14 – 1.22 | 11 |
| 💵 ชำระเงินและอนุมัติ | 1.23 – 1.31 | 12 |
| 📊 รายจ่ายและแดชบอร์ด | 1.32 – 1.37 | 7 |
| **รวม** | | **49** |

---

## 🤝 แนวทางการทำงานร่วมกัน

| เรื่อง | ข้อตกลง |
|---|---|
| 🌿 **Branch** | ทำงานใน branch ของตัวเอง → เปิด Pull Request เข้า `main` ให้เพื่อนตรวจก่อน merge |
| 🔄 **ก่อน push** | `git fetch origin` → `git merge origin/main` แก้ conflict ให้เรียบร้อยก่อน |
| 🗂️ **ขอบเขตไฟล์** | แก้เฉพาะ service และโฟลเดอร์ใน `features/` ของตัวเอง ไฟล์กลางตกลงกันก่อน |
| 🗄️ **ฐานข้อมูล** | แต่ละ service ใช้ schema ของตัวเองเท่านั้น ข้อมูลข้าม service ขอผ่าน API |
| 🔐 **ความลับ** | `.env` ไม่ขึ้น git · แชร์ key ผ่านช่องทางส่วนตัวของทีม |

<div align="center">

---

**POS & CRM** · เฟส 1 · CSI400 เว็บเซอร์วิส

</div>
