# ER Diagram ราย Service — POS CRM

Supabase 1 project แบ่ง schema ตาม service: `identity`, `catalog`, `pos`, `payment`, `membership`, `coupon`

- PK เป็น `uuid` ทุกตาราง (`default gen_random_uuid()`) ยกเว้น `roles` ที่ใช้ `smallint`
- `FK` = foreign key จริงภายใน schema เดียวกัน
- ฟิลด์ที่มีหมายเหตุ `ref <schema>.<table>` = อ้างข้าม service: เก็บแค่ id ไม่ผูก FK
- enum ทำเป็น Postgres enum หรือ `text` + `check` ก็ได้
- เส้นทึบ `--` = FK จริง, เส้นประ `..` = อ้างข้าม service (ในภาพรวม)

---

## ภาพรวม (แสดงเฉพาะความสัมพันธ์)

```mermaid
erDiagram
  %% ===== identity =====
  branches |o--o{ profiles : "สังกัด"
  roles ||--o{ profiles : "กำหนดสิทธิ์"

  %% ===== catalog =====
  categories ||--o{ menus : "จัดกลุ่ม"
  menus ||--o{ menu_option_groups : "มีตัวเลือก"
  option_groups ||--o{ menu_option_groups : "ใช้กับเมนู"
  option_groups ||--|{ options : "ประกอบด้วย"
  menus ||--o{ stocks : "สต็อกรายสาขา"

  %% ===== pos =====
  orders ||--|{ order_tables : "ใช้โต๊ะ"
  dining_tables ||--o{ order_tables : "ถูกใช้"
  orders ||--o{ kitchen_tickets : "สั่งแต่ละรอบ"
  kitchen_tickets ||--|{ order_items : "มีรายการ"
  orders ||--|{ order_items : "มีรายการ"
  order_items ||--o{ order_item_options : "เลือก"
  orders ||--o{ approvals : "ขออนุมัติ"
  approvals ||--o{ refund_items : "คืนรายการ"
  order_items ||--o{ refund_items : "ถูกคืน"

  %% ===== membership (เฟส 2) =====
  membership_tiers ||--o{ customers : "ระดับ"
  customers ||--o{ point_transactions : "แต้ม"
  customers ||--o{ visits : "การมาใช้บริการ"

  %% ===== coupon (เฟส 3) =====
  coupon_campaigns ||--o{ coupon_branches : "ใช้ได้ที่สาขา"
  coupon_campaigns ||--o{ customer_coupons : "แจก"
  customer_coupons ||--o| coupon_redemptions : "ถูกใช้"

  %% ===== cross-service (logical ref, ไม่มี FK) =====
  branches ||..o{ stocks : "branch_id"
  branches ||..o{ dining_tables : "branch_id"
  branches ||..o{ orders : "branch_id"
  branches ||..o{ expenses : "branch_id"
  branches ||..o{ coupon_branches : "branch_id"
  profiles ||..o{ orders : "opened_by/closed_by"
  profiles ||..o{ payments : "received_by"
  menus ||..o{ order_items : "menu_id + snapshot"
  options ||..o{ order_item_options : "option_id + snapshot"
  orders ||..o{ payments : "order_id"
  approvals ||..o| payments : "refund"
  customers |o..o{ orders : "customer_id"
  orders ||..o| visits : "order_id"
  orders ||..o{ point_transactions : "order_id"
  customers ||..o{ customer_coupons : "customer_id"
  orders ||..o| coupon_redemptions : "order_id"
```

---

## identity (เฟส 1)

`auth.users` เป็นตารางของ Supabase Auth ไม่ต้องสร้างเอง และไม่ต้องเก็บ `password_hash`
ถ้าอยากให้พนักงาน login ด้วย username ให้แปลงเป็นอีเมล เช่น `somchai@pos.local`

```mermaid
erDiagram
  auth_users ||--|| profiles : "บัญชี login"
  branches |o--o{ profiles : "สังกัด"
  roles ||--o{ profiles : "กำหนดสิทธิ์"

  auth_users {
    uuid id PK "Supabase Auth จัดการเอง"
    text email UK
  }
  branches {
    uuid id PK
    text code UK "เช่น BAR01"
    text name
    enum branch_type "restaurant, drinks, bar"
    text address
    text phone
    boolean is_active
    timestamptz created_at
  }
  roles {
    smallint id PK
    text name UK "waiter, cashier, manager, owner"
  }
  profiles {
    uuid id PK, FK "= auth.users.id"
    uuid branch_id FK "null = เจ้าของ"
    smallint role_id FK
    text username UK
    text full_name
    boolean is_active
    timestamptz created_at
  }
```

- `role` และ `branch_id` ใส่ลง JWT ด้วย custom access token hook แล้ว API Gateway เป็นคนตรวจ token และส่งต่อให้ service เป็น header

---

## catalog (เฟส 1)

เมนูเป็นชุดกลางที่ทุกสาขาใช้ร่วมกัน ส่วนสต็อกและสถานะเปิด/ปิดขายแยกตามสาขา

```mermaid
erDiagram
  categories ||--o{ menus : "จัดกลุ่ม"
  menus ||--o{ menu_option_groups : "มีตัวเลือก"
  option_groups ||--o{ menu_option_groups : "ใช้กับเมนู"
  option_groups ||--|{ options : "ประกอบด้วย"
  menus ||--o{ stocks : "สต็อกรายสาขา"

  categories {
    uuid id PK
    text name
    int sort_order
    boolean is_active
  }
  menus {
    uuid id PK
    uuid category_id FK
    text name
    text description
    numeric price
    text image_url "Supabase Storage"
    boolean is_deleted "soft delete"
    timestamptz created_at
    timestamptz updated_at
  }
  option_groups {
    uuid id PK
    text name "เช่น ระดับความหวาน"
    boolean is_required
    int max_select
  }
  options {
    uuid id PK
    uuid option_group_id FK
    text name "เช่น หวานน้อย"
    numeric extra_price
    boolean is_active
  }
  menu_option_groups {
    uuid menu_id PK, FK
    uuid option_group_id PK, FK
    int sort_order
  }
  stocks {
    uuid id PK
    uuid branch_id "ref identity.branches"
    uuid menu_id FK
    int quantity
    boolean is_available "quantity = 0 ตั้งเป็น false อัตโนมัติ"
    timestamptz updated_at
  }
```

- `stocks` มี unique (`branch_id`, `menu_id`)
- ตัดสต็อกผ่าน API ของ catalog เท่านั้น เช่น `POST /stocks/deduct` และควรมี `POST /stocks/restore` ไว้คืนสต็อกเมื่อสั่งไม่สำเร็จ

---

## pos (เฟส 1)

```mermaid
erDiagram
  dining_tables ||--o{ order_tables : "ถูกใช้"
  orders ||--|{ order_tables : "ใช้โต๊ะ"
  orders ||--o{ kitchen_tickets : "สั่งแต่ละรอบ"
  kitchen_tickets ||--|{ order_items : "มีรายการ"
  orders ||--|{ order_items : "มีรายการ"
  order_items ||--o{ order_item_options : "เลือก"
  orders ||--o{ approvals : "ขออนุมัติ"
  approvals ||--o{ refund_items : "คืนรายการ"
  order_items ||--o{ refund_items : "ถูกคืน"

  dining_tables {
    uuid id PK
    uuid branch_id "ref identity.branches"
    text table_no
    int seats
    enum status "available, occupied, waiting_payment"
  }
  orders {
    uuid id PK
    text order_no UK "เลขบิลที่แสดงบนใบเสร็จ"
    uuid branch_id "ref identity.branches"
    uuid opened_by "ref identity.profiles"
    uuid closed_by "ref identity.profiles, null ได้"
    uuid customer_id "ref membership.customers, null ได้"
    int guest_count
    enum status "open, waiting_payment, paid, refunded"
    numeric subtotal "ก่อน VAT"
    numeric discount_amount "ส่วนลดอนุมัติ + คูปอง"
    numeric vat_amount
    numeric total "ยอดสุทธิ"
    timestamptz opened_at "ใช้ทำ heatmap"
    timestamptz closed_at
  }
  order_tables {
    uuid id PK
    uuid order_id FK
    uuid table_id FK
    timestamptz joined_at
    timestamptz left_at "null = ยังใช้อยู่"
  }
  kitchen_tickets {
    uuid id PK
    uuid order_id FK
    uuid created_by "ref identity.profiles"
    int round_no
    enum status "pending, preparing, served"
    timestamptz printed_at
  }
  order_items {
    uuid id PK
    uuid order_id FK
    uuid ticket_id FK
    uuid menu_id "ref catalog.menus"
    text menu_name "snapshot ตอนสั่ง"
    int quantity
    numeric unit_price "snapshot ตอนสั่ง"
    text note
  }
  order_item_options {
    uuid id PK
    uuid order_item_id FK
    uuid option_id "ref catalog.options"
    text option_name "snapshot ตอนสั่ง"
    numeric extra_price "snapshot ตอนสั่ง"
  }
  approvals {
    uuid id PK
    uuid order_id FK
    uuid requested_by "ref identity.profiles แคชเชียร์"
    uuid approved_by "ref identity.profiles, null = ยังไม่ตัดสิน"
    enum type "discount, refund"
    enum value_type "amount, percent"
    numeric value "ตัวเลขที่ขอ"
    numeric amount "ยอดเงินที่คำนวณได้"
    text reason
    enum status "pending, approved, rejected"
    timestamptz requested_at
    timestamptz decided_at
  }
  refund_items {
    uuid id PK
    uuid approval_id FK
    uuid order_item_id FK
    int quantity
    numeric amount
  }
```

- `kitchen_tickets` เปิด Supabase Realtime ให้จอครัวรับตั๋วใหม่ได้ทันที
- คืนเงินทั้งบิล: ไม่มี `refund_items` และ `amount` เท่ากับ `orders.total`
- คืนเงินบางรายการ: มี `refund_items` ระบุรายการและจำนวน

---

## payment (เฟส 1)

```mermaid
erDiagram
  payments {
    uuid id PK
    uuid order_id "ref pos.orders"
    uuid branch_id "ref identity.branches ไว้ทำรายงาน"
    enum type "charge, refund"
    uuid approval_id "ref pos.approvals, ใช้เมื่อ type = refund"
    enum method "cash, promptpay"
    numeric amount
    numeric cash_received
    numeric change_amount
    uuid received_by "ref identity.profiles"
    timestamptz paid_at
  }
  expenses {
    uuid id PK
    uuid branch_id "ref identity.branches"
    uuid created_by "ref identity.profiles ผู้จัดการ"
    enum category "labor, rent_utilities, ingredients, other"
    numeric amount
    date expense_date
    text note
    timestamptz created_at
  }
```

- ไม่มี FK ภายใน service นี้ ทุกฟิลด์อ้างข้าม service
- `payments` เก็บ `branch_id` ซ้ำไว้ จะได้ทำรายงานรายรับรายจ่ายรายสาขาโดยไม่ต้องเรียก pos
- เมื่อรับเงินครบ payment เรียก pos ให้เปลี่ยน `orders.status = paid` โดยใช้ `order_id` กันการเรียกซ้ำ

---

## membership (เฟส 2)

```mermaid
erDiagram
  membership_tiers ||--o{ customers : "ระดับ"
  customers ||--o{ point_transactions : "แต้ม"
  customers ||--o{ visits : "การมาใช้บริการ"

  membership_tiers {
    uuid id PK
    text name UK "เช่น Silver, Gold"
    int min_points
    numeric point_rate "แต้มต่อ 1 บาท"
  }
  customers {
    uuid id PK
    uuid tier_id FK
    text phone UK "ใช้ค้นหาตอนจ่ายเงิน"
    text full_name
    date birth_date
    int points_balance
    uuid registered_branch_id "ref identity.branches"
    timestamptz created_at
  }
  point_transactions {
    uuid id PK
    uuid customer_id FK
    uuid order_id "ref pos.orders, null ได้"
    uuid branch_id "ref identity.branches"
    enum type "earn, redeem, adjust, expire"
    int points "บวก/ลบ"
    timestamptz created_at
  }
  visits {
    uuid id PK
    uuid customer_id FK
    uuid order_id UK "ref pos.orders"
    uuid branch_id "ref identity.branches"
    numeric spent_amount
    timestamptz visited_at
  }
```

- `visits` บันทึกเมื่อบิลของสมาชิกถูกปิด ทำให้ membership วิเคราะห์พฤติกรรมลูกค้าได้เองโดยไม่ต้องอ่าน DB ของ pos
- heatmap ช่วงเวลาคนเยอะของทุกบิล (รวมลูกค้าที่ไม่ใช่สมาชิก) ยังใช้ `pos.orders.opened_at`

---

## coupon (เฟส 3)

คูปองที่ออกจากสาขาหนึ่งใช้ที่สาขาอื่นได้ โดยกำหนดสาขาที่ใช้ได้ใน `coupon_branches`

```mermaid
erDiagram
  coupon_campaigns ||--o{ coupon_branches : "ใช้ได้ที่สาขา"
  coupon_campaigns ||--o{ customer_coupons : "แจก"
  customer_coupons ||--o| coupon_redemptions : "ถูกใช้"

  coupon_campaigns {
    uuid id PK
    text name
    uuid issued_branch_id "ref identity.branches, null = ส่วนกลาง"
    enum discount_type "amount, percent"
    numeric discount_value
    numeric min_spend
    numeric max_discount
    timestamptz starts_at
    timestamptz ends_at
    int limit_per_customer
    boolean is_active
  }
  coupon_branches {
    uuid campaign_id PK, FK
    uuid branch_id PK "ref identity.branches"
  }
  customer_coupons {
    uuid id PK
    uuid campaign_id FK
    uuid customer_id "ref membership.customers"
    text code UK
    enum status "issued, used, expired"
    timestamptz issued_at
    timestamptz expires_at
  }
  coupon_redemptions {
    uuid id PK
    uuid customer_coupon_id FK, UK
    uuid order_id "ref pos.orders"
    uuid branch_id "ref identity.branches"
    numeric discount_amount
    uuid redeemed_by "ref identity.profiles"
    timestamptz redeemed_at
  }
```

---

## สรุปจำนวนตาราง

| Service | ตาราง | เฟส |
|---|---|---|
| identity | 3 (+ auth.users ของ Supabase) | 1 |
| catalog | 6 | 1 |
| pos | 8 | 1 |
| payment | 2 | 1 |
| membership | 4 | 2 |
| coupon | 4 | 3 |
| **รวม** | **27** | |
