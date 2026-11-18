# pos — Database (Dev 3)

Schema `pos` บน Supabase · ตามสเปก [`เอกสาร/pos-crm-phase1-spec.md`](../../../เอกสาร/pos-crm-phase1-spec.md) ข้อ 3 (ERD pos)

## ไฟล์

| ไฟล์ | เนื้อหา |
|---|---|
| `migrations/0001_pos_schema.sql` | schema, enum, 8 ตาราง, constraint, index |
| `migrations/0002_pos_functions_triggers.sql` | คำนวณยอดบิล/VAT, sync สถานะโต๊ะ, guard ต่าง ๆ, approvals ห้ามลบ |
| `migrations/0003_pos_rls_realtime.sql` | RLS + เพิ่ม `kitchen_tickets`, `approvals` เข้า Supabase Realtime |
| `tests/supabase_stub.sql` | จำลอง `auth.jwt()`, role, publication ของ Supabase สำหรับรันบน Postgres เปล่า |
| `tests/smoke_test.sql` | ทดสอบ flow เปิดโต๊ะ → สั่ง → ส่วนลด → จ่าย → คืนเงิน + RLS (rollback ท้ายไฟล์) |

## รัน

**Supabase:** วาง 0001 → 0002 → 0003 ใน SQL Editor ตามลำดับ (หรือ copy ไป `supabase/migrations/`)
แล้วไป Settings → API → Exposed schemas เพิ่ม `pos` ถ้าต้องให้ client subscribe Realtime

**Postgres local (ทดสอบ):**

```bash
docker run -d --name pos-db -e POSTGRES_PASSWORD=pw -p 5432:5432 postgres:15
for f in tests/supabase_stub.sql migrations/*.sql tests/smoke_test.sql; do
  psql -v ON_ERROR_STOP=1 -h localhost -U postgres -f "$f"
done
```

## สิ่งที่ DB ทำให้อัตโนมัติ (service ไม่ต้องเขียนซ้ำ)

- **ยอดบิล** `subtotal / discount_amount / vat_amount / total` คำนวณใหม่ทุกครั้งที่ `order_items`, `order_item_options` เปลี่ยน หรือส่วนลดถูกอนุมัติ
  `vat = round((subtotal − discount) × 0.07, 2)` · ส่วนลด percent คิดจาก subtotal ปัจจุบัน · บิล `paid` แล้วยอดไม่เปลี่ยน
  เรียกเองได้: `select * from pos.recalc_order_totals(:order_id)`
- **สถานะโต๊ะ** sync จากบิลที่ใช้โต๊ะอยู่ (`order_tables.left_at is null`): `open → occupied`, `waiting_payment → waiting_payment`, ไม่มีบิล → `available`
- **mark-paid**: แค่ `update orders set status='paid', closed_by=...` → DB ตั้ง `closed_at`, ปิด `order_tables` และคืนโต๊ะเป็นว่าง (1.26)
- **ย้ายโต๊ะ** = set `left_at` แถวเดิม + insert แถวใหม่ · **รวมโต๊ะ** = insert `order_tables` เพิ่มในบิลเดียว
- `pos.next_round_no(order_id)` ใช้ตอนสร้าง `kitchen_tickets` (มี unique `(order_id, round_no)` กันชน)
- `order_no` สร้างให้เอง รูปแบบ `ORD<YYMMDD>-<running 6 หลัก>`

## Guard (error ขึ้นต้นด้วย code → map เป็น HTTP 409/400 ใน service)

| code | เมื่อไหร่ |
|---|---|
| `ORDER_NOT_OPEN` | สั่งอาหาร/แก้รายการในบิลที่ไม่ใช่ `open` |
| `BRANCH_MISMATCH` | โต๊ะ / ticket / approval คนละสาขากับบิล |
| `TABLE_INACTIVE` | ใช้โต๊ะที่ปิดใช้งาน |
| `INVALID_STATUS` | ย้อนสถานะบิล เช่น `paid → open`, คืนเงินบิลที่ยังไม่จ่าย |
| `ORDER_ALREADY_PAID` / `ORDER_NOT_PAID` | ขอส่วนลดบิลที่จ่ายแล้ว / ขอคืนเงินบิลที่ยังไม่จ่าย (1.28) |
| `APPROVAL_DECIDED` / `APPROVAL_IMMUTABLE` / `APPROVAL_UNDELETABLE` | log คำขอแก้/ลบไม่ได้ (1.31) |
| `VALIDATION_ERROR` | refund_items คืนเกินจำนวนที่สั่ง หรือไม่ใช่รายการในบิล |
| unique violation `order_tables_active_table_uk` | เปิดโต๊ะที่มีบิลอยู่แล้ว |

## RLS

- service pos ต่อ DB ด้วย `service_role` (bypass RLS) — **ห้ามให้ client ใช้ key นี้**
- client (`authenticated`) select ได้แค่:
  - `kitchen_tickets`: staff/manager สาขาตัวเอง, owner ทุกสาขา
  - `approvals`: manager สาขาตัวเอง, owner ทุกสาขา, staff เฉพาะคำขอตัวเอง
- อาศัย claim `user_role`, `branch_id` จาก custom access token hook ของ Dev 1

## เพิ่มจาก ERD เดิม (แจ้งทีม)

- `dining_tables.is_active`, `created_at` — ใช้ปิด/ลบโต๊ะแบบ soft delete
- `kitchen_tickets.created_at` — เวลาสั่งที่พิมพ์ลงใบออร์เดอร์ (1.10)
- `order_items.created_at`
