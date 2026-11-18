-- =====================================================================
-- POS service (Dev 3) — schema `pos`
-- ตาราง: dining_tables, orders, order_tables, kitchen_tickets,
--        order_items, order_item_options, approvals, refund_items
-- อ้างอิง: เอกสาร/pos-crm-phase1-spec.md ข้อ 3 (ERD pos) และ 1.7–1.31
--
-- กติกา:
--  - ฟิลด์ที่อ้างข้าม service (branch_id, *_by, menu_id, option_id, customer_id)
--    เก็บแค่ uuid ไม่ผูก FK
--  - service pos ต่อ DB ด้วย role ที่ bypass RLS (service_role / postgres)
-- =====================================================================

create schema if not exists pos;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type pos.table_status        as enum ('available', 'occupied', 'waiting_payment');      -- 1.8
create type pos.order_status        as enum ('open', 'waiting_payment', 'paid', 'refunded');
create type pos.ticket_status       as enum ('pending', 'preparing', 'served');
create type pos.approval_type       as enum ('discount', 'refund');                             -- 1.27, 1.28
create type pos.approval_value_type as enum ('amount', 'percent');
create type pos.approval_status     as enum ('pending', 'approved', 'rejected');                -- 1.29

-- ---------------------------------------------------------------------
-- dining_tables — โต๊ะของสาขา
-- ---------------------------------------------------------------------
create table pos.dining_tables (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null,                       -- ref identity.branches
  table_no    text not null,
  seats       int  not null default 4 check (seats > 0),
  status      pos.table_status not null default 'available',
  is_active   boolean not null default true,       -- ปิด/ลบโต๊ะ (soft delete)
  created_at  timestamptz not null default now(),
  constraint dining_tables_branch_table_no_uk unique (branch_id, table_no)
);

create index dining_tables_branch_idx on pos.dining_tables (branch_id) where is_active;

-- ---------------------------------------------------------------------
-- orders — บิล (1 บิลใช้ได้หลายโต๊ะ, ไม่มีแยกบิล 1.13)
-- ---------------------------------------------------------------------
create sequence pos.order_no_seq;

create table pos.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text not null unique
                   default ('ORD' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD')
                            || '-' || lpad(nextval('pos.order_no_seq')::text, 6, '0')),
  branch_id        uuid not null,                  -- ref identity.branches
  opened_by        uuid not null,                  -- ref identity.profiles
  closed_by        uuid,                           -- ref identity.profiles
  customer_id      uuid,                           -- ref membership.customers (เฟส 2)
  guest_count      int  not null check (guest_count > 0),                  -- 1.7
  status           pos.order_status not null default 'open',
  subtotal         numeric(12,2) not null default 0 check (subtotal >= 0),
  discount_amount  numeric(12,2) not null default 0 check (discount_amount >= 0),
  vat_amount       numeric(12,2) not null default 0 check (vat_amount >= 0),
  total            numeric(12,2) not null default 0 check (total >= 0),
  opened_at        timestamptz not null default now(),                     -- 1.7 / heatmap
  closed_at        timestamptz,
  constraint orders_discount_le_subtotal check (discount_amount <= subtotal),
  constraint orders_closed_consistency check (
    (status in ('paid', 'refunded')) = (closed_at is not null)
  )
);

create index orders_branch_status_idx on pos.orders (branch_id, status);
create index orders_branch_opened_idx on pos.orders (branch_id, opened_at desc);

-- ---------------------------------------------------------------------
-- order_tables — โต๊ะที่บิลใช้ (ย้าย/รวมโต๊ะ 1.11, 1.12)
-- left_at = null คือยังใช้อยู่
-- ---------------------------------------------------------------------
create table pos.order_tables (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references pos.orders(id) on delete restrict,
  table_id   uuid not null references pos.dining_tables(id) on delete restrict,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  constraint order_tables_left_after_join check (left_at is null or left_at >= joined_at)
);

-- 1 โต๊ะอยู่ในบิลที่ใช้งานได้แค่บิลเดียว (กันเปิดโต๊ะซ้อน)
create unique index order_tables_active_table_uk on pos.order_tables (table_id) where left_at is null;
create index order_tables_order_idx on pos.order_tables (order_id);

-- ---------------------------------------------------------------------
-- kitchen_tickets — สั่งอาหารแต่ละรอบ (1.9, 1.10) · Realtime จอครัว
-- ---------------------------------------------------------------------
create table pos.kitchen_tickets (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references pos.orders(id) on delete restrict,
  branch_id   uuid not null,                       -- ref identity.branches (RLS ของ Realtime)
  created_by  uuid not null,                       -- ref identity.profiles
  round_no    int  not null check (round_no > 0),
  status      pos.ticket_status not null default 'pending',
  created_at  timestamptz not null default now(),  -- เวลาที่พิมพ์ลงใบออร์เดอร์
  printed_at  timestamptz,
  constraint kitchen_tickets_order_round_uk unique (order_id, round_no),
  constraint kitchen_tickets_id_order_uk unique (id, order_id)  -- ให้ order_items อ้าง (ticket_id, order_id)
);

create index kitchen_tickets_branch_status_idx on pos.kitchen_tickets (branch_id, status, created_at);

-- ---------------------------------------------------------------------
-- order_items — รายการอาหาร + snapshot ชื่อ/ราคา
-- ---------------------------------------------------------------------
create table pos.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references pos.orders(id) on delete restrict,
  ticket_id   uuid not null,
  menu_id     uuid not null,                       -- ref catalog.menus
  menu_name   text not null,                       -- snapshot
  quantity    int  not null check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),  -- snapshot ราคาสาขา
  note        text,
  created_at  timestamptz not null default now(),
  -- ticket ต้องเป็นของบิลเดียวกัน
  constraint order_items_ticket_fk foreign key (ticket_id, order_id)
    references pos.kitchen_tickets (id, order_id) on delete restrict
);

create index order_items_order_idx  on pos.order_items (order_id);
create index order_items_ticket_idx on pos.order_items (ticket_id);
create index order_items_menu_idx   on pos.order_items (menu_id);   -- เมนูขายดี

-- ---------------------------------------------------------------------
-- order_item_options — ตัวเลือกที่เลือก + snapshot
-- ---------------------------------------------------------------------
create table pos.order_item_options (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references pos.order_items(id) on delete cascade,
  option_id      uuid not null,                    -- ref catalog.options
  option_name    text not null,                    -- snapshot
  extra_price    numeric(12,2) not null default 0 check (extra_price >= 0),  -- snapshot
  constraint order_item_options_uk unique (order_item_id, option_id)
);

-- ---------------------------------------------------------------------
-- approvals — คำขอส่วนลด/คืนเงิน (1.27–1.31) · ห้ามลบ · Realtime แจ้ง M/O
-- ---------------------------------------------------------------------
create table pos.approvals (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references pos.orders(id) on delete restrict,
  branch_id     uuid not null,                     -- ref identity.branches (RLS ของ Realtime)
  requested_by  uuid not null,                     -- ref identity.profiles (staff)
  approved_by   uuid,                              -- ref identity.profiles (ผู้ตัดสิน)
  type          pos.approval_type not null,
  value_type    pos.approval_value_type not null default 'amount',
  value         numeric(12,2) not null check (value > 0),
  amount        numeric(12,2) not null check (amount >= 0),   -- ยอดเงินที่คำนวณได้
  reason        text not null check (length(btrim(reason)) > 0),
  status        pos.approval_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  constraint approvals_percent_range check (value_type <> 'percent' or value <= 100),
  constraint approvals_decision_consistency check (
    (status = 'pending' and approved_by is null and decided_at is null)
    or (status <> 'pending' and approved_by is not null and decided_at is not null)
  )
);

create index approvals_branch_status_idx on pos.approvals (branch_id, status, requested_at desc);
create index approvals_requested_by_idx  on pos.approvals (requested_by, requested_at desc);
create index approvals_order_idx         on pos.approvals (order_id);

-- ---------------------------------------------------------------------
-- refund_items — คืนเงินบางรายการ (คืนทั้งบิล = ไม่มีแถว)
-- ---------------------------------------------------------------------
create table pos.refund_items (
  id             uuid primary key default gen_random_uuid(),
  approval_id    uuid not null references pos.approvals(id) on delete restrict,
  order_item_id  uuid not null references pos.order_items(id) on delete restrict,
  quantity       int not null check (quantity > 0),
  amount         numeric(12,2) not null check (amount >= 0),
  constraint refund_items_uk unique (approval_id, order_item_id)
);

create index refund_items_order_item_idx on pos.refund_items (order_item_id);
