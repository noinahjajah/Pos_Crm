-- orders: service pos ของ Dev 3 (โต๊ะ บิล สั่งอาหาร จอครัว ส่วนลด/คืนเงิน)
-- แบบตารางและกติกาจาก services/pos/db/migrations ของ Dev 3 (commit 74e7510) ยกมาทั้งหมด
-- ต่างจากต้นฉบับ: ใช้ schema `orders` (มีอยู่แล้วและเปิดใน Data API แล้ว) แทน `pos` · รันซ้ำได้
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

create schema if not exists orders;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
do $$ begin create type orders.table_status as enum ('available', 'occupied', 'waiting_payment'); exception when duplicate_object then null; end $$;
do $$ begin create type orders.order_status as enum ('open', 'waiting_payment', 'paid', 'refunded'); exception when duplicate_object then null; end $$;
do $$ begin create type orders.ticket_status as enum ('pending', 'preparing', 'served'); exception when duplicate_object then null; end $$;
do $$ begin create type orders.approval_type as enum ('discount', 'refund'); exception when duplicate_object then null; end $$;
do $$ begin create type orders.approval_value_type as enum ('amount', 'percent'); exception when duplicate_object then null; end $$;
do $$ begin create type orders.approval_status as enum ('pending', 'approved', 'rejected'); exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- dining_tables — โต๊ะของสาขา
-- ---------------------------------------------------------------------
create table if not exists orders.dining_tables (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null,                       -- ref identity.branches
  table_no    text not null,
  seats       int  not null default 4 check (seats > 0),
  status      orders.table_status not null default 'available',
  is_active   boolean not null default true,       -- ปิด/ลบโต๊ะ (soft delete)
  created_at  timestamptz not null default now(),
  constraint dining_tables_branch_table_no_uk unique (branch_id, table_no)
);

create index if not exists dining_tables_branch_idx on orders.dining_tables (branch_id) where is_active;

-- ---------------------------------------------------------------------
-- orders — บิล (1 บิลใช้ได้หลายโต๊ะ, ไม่มีแยกบิล 1.13)
-- ---------------------------------------------------------------------
create sequence if not exists orders.order_no_seq;

create table if not exists orders.orders (
  id               uuid primary key default gen_random_uuid(),
  order_no         text not null unique
                   default ('ORD' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD')
                            || '-' || lpad(nextval('orders.order_no_seq')::text, 6, '0')),
  branch_id        uuid not null,                  -- ref identity.branches
  opened_by        uuid not null,                  -- ref identity.profiles
  closed_by        uuid,                           -- ref identity.profiles
  customer_id      uuid,                           -- ref membership.customers (เฟส 2)
  guest_count      int  not null check (guest_count > 0),                  -- 1.7
  status           orders.order_status not null default 'open',
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

create index if not exists orders_branch_status_idx on orders.orders (branch_id, status);
create index if not exists orders_branch_opened_idx on orders.orders (branch_id, opened_at desc);

-- ---------------------------------------------------------------------
-- order_tables — โต๊ะที่บิลใช้ (ย้าย/รวมโต๊ะ 1.11, 1.12)
-- left_at = null คือยังใช้อยู่
-- ---------------------------------------------------------------------
create table if not exists orders.order_tables (
  id         uuid primary key default gen_random_uuid(),
  order_id   uuid not null references orders.orders(id) on delete restrict,
  table_id   uuid not null references orders.dining_tables(id) on delete restrict,
  joined_at  timestamptz not null default now(),
  left_at    timestamptz,
  constraint order_tables_left_after_join check (left_at is null or left_at >= joined_at)
);

-- 1 โต๊ะอยู่ในบิลที่ใช้งานได้แค่บิลเดียว (กันเปิดโต๊ะซ้อน)
create unique index if not exists order_tables_active_table_uk on orders.order_tables (table_id) where left_at is null;
create index if not exists order_tables_order_idx on orders.order_tables (order_id);

-- ---------------------------------------------------------------------
-- kitchen_tickets — สั่งอาหารแต่ละรอบ (1.9, 1.10) · Realtime จอครัว
-- ---------------------------------------------------------------------
create table if not exists orders.kitchen_tickets (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders.orders(id) on delete restrict,
  branch_id   uuid not null,                       -- ref identity.branches (RLS ของ Realtime)
  created_by  uuid not null,                       -- ref identity.profiles
  round_no    int  not null check (round_no > 0),
  status      orders.ticket_status not null default 'pending',
  created_at  timestamptz not null default now(),  -- เวลาที่พิมพ์ลงใบออร์เดอร์
  printed_at  timestamptz,
  constraint kitchen_tickets_order_round_uk unique (order_id, round_no),
  constraint kitchen_tickets_id_order_uk unique (id, order_id)  -- ให้ order_items อ้าง (ticket_id, order_id)
);

create index if not exists kitchen_tickets_branch_status_idx on orders.kitchen_tickets (branch_id, status, created_at);

-- ---------------------------------------------------------------------
-- order_items — รายการอาหาร + snapshot ชื่อ/ราคา
-- ---------------------------------------------------------------------
create table if not exists orders.order_items (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders.orders(id) on delete restrict,
  ticket_id   uuid not null,
  menu_id     uuid not null,                       -- ref catalog.menus
  menu_name   text not null,                       -- snapshot
  quantity    int  not null check (quantity > 0),
  unit_price  numeric(12,2) not null check (unit_price >= 0),  -- snapshot ราคาสาขา
  note        text,
  created_at  timestamptz not null default now(),
  -- ticket ต้องเป็นของบิลเดียวกัน
  constraint order_items_ticket_fk foreign key (ticket_id, order_id)
    references orders.kitchen_tickets (id, order_id) on delete restrict
);

create index if not exists order_items_order_idx  on orders.order_items (order_id);
create index if not exists order_items_ticket_idx on orders.order_items (ticket_id);
create index if not exists order_items_menu_idx   on orders.order_items (menu_id);   -- เมนูขายดี

-- ---------------------------------------------------------------------
-- order_item_options — ตัวเลือกที่เลือก + snapshot
-- ---------------------------------------------------------------------
create table if not exists orders.order_item_options (
  id             uuid primary key default gen_random_uuid(),
  order_item_id  uuid not null references orders.order_items(id) on delete cascade,
  option_id      uuid not null,                    -- ref catalog.options
  option_name    text not null,                    -- snapshot
  extra_price    numeric(12,2) not null default 0 check (extra_price >= 0),  -- snapshot
  constraint order_item_options_uk unique (order_item_id, option_id)
);

-- ---------------------------------------------------------------------
-- approvals — คำขอส่วนลด/คืนเงิน (1.27–1.31) · ห้ามลบ · Realtime แจ้ง M/O
-- ---------------------------------------------------------------------
create table if not exists orders.approvals (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders.orders(id) on delete restrict,
  branch_id     uuid not null,                     -- ref identity.branches (RLS ของ Realtime)
  requested_by  uuid not null,                     -- ref identity.profiles (staff)
  approved_by   uuid,                              -- ref identity.profiles (ผู้ตัดสิน)
  type          orders.approval_type not null,
  value_type    orders.approval_value_type not null default 'amount',
  value         numeric(12,2) not null check (value > 0),
  amount        numeric(12,2) not null check (amount >= 0),   -- ยอดเงินที่คำนวณได้
  reason        text not null check (length(btrim(reason)) > 0),
  status        orders.approval_status not null default 'pending',
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  constraint approvals_percent_range check (value_type <> 'percent' or value <= 100),
  constraint approvals_decision_consistency check (
    (status = 'pending' and approved_by is null and decided_at is null)
    or (status <> 'pending' and approved_by is not null and decided_at is not null)
  )
);

create index if not exists approvals_branch_status_idx on orders.approvals (branch_id, status, requested_at desc);
create index if not exists approvals_requested_by_idx  on orders.approvals (requested_by, requested_at desc);
create index if not exists approvals_order_idx         on orders.approvals (order_id);

-- ---------------------------------------------------------------------
-- refund_items — คืนเงินบางรายการ (คืนทั้งบิล = ไม่มีแถว)
-- ---------------------------------------------------------------------
create table if not exists orders.refund_items (
  id             uuid primary key default gen_random_uuid(),
  approval_id    uuid not null references orders.approvals(id) on delete restrict,
  order_item_id  uuid not null references orders.order_items(id) on delete restrict,
  quantity       int not null check (quantity > 0),
  amount         numeric(12,2) not null check (amount >= 0),
  constraint refund_items_uk unique (approval_id, order_item_id)
);

create index if not exists refund_items_order_item_idx on orders.refund_items (order_item_id);

-- =====================================================================
-- POS service — functions & triggers
--  - คำนวณยอดบิล (subtotal / ส่วนลดที่อนุมัติ / VAT 7% / total)  1.23, 1.24, 1.30
--  - sync สถานะโต๊ะตามบิล (ว่าง / มีลูกค้า / รอชำระ)            1.8, 1.26
--  - ป้องกันข้อมูลผิด: สาขาไม่ตรง, สั่งอาหารในบิลที่ปิดแล้ว ฯลฯ
--  - approvals ห้ามลบ และแก้ได้แค่ตอนตัดสิน                      1.31
-- =====================================================================

-- ---------------------------------------------------------------------
-- คำนวณยอดบิล
--   vat   = round((subtotal - discount) * 0.07, 2)
--   total = subtotal - discount + vat
-- คำนวณเฉพาะบิลที่ยังไม่จ่าย (open / waiting_payment) บิลที่จ่ายแล้วยอดไม่เปลี่ยน
-- ---------------------------------------------------------------------
create or replace function orders.recalc_order_totals(p_order_id uuid)
returns orders.orders
language plpgsql
as $$
declare
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_vat      numeric(12,2);
  v_order    orders.orders;
begin
  select coalesce(sum(oi.quantity * (oi.unit_price + coalesce(opt.extra, 0))), 0)
    into v_subtotal
  from orders.order_items oi
  left join lateral (
    select sum(oio.extra_price) as extra
    from orders.order_item_options oio
    where oio.order_item_id = oi.id
  ) opt on true
  where oi.order_id = p_order_id;

  -- ส่วนลดมีผลเฉพาะที่ approved (1.30) · percent คิดจาก subtotal ปัจจุบัน
  select coalesce(sum(
           case a.value_type
             when 'percent' then round(v_subtotal * a.value / 100, 2)
             else a.value
           end), 0)
    into v_discount
  from orders.approvals a
  where a.order_id = p_order_id
    and a.type = 'discount'
    and a.status = 'approved';

  v_discount := least(v_discount, v_subtotal);
  v_vat      := round((v_subtotal - v_discount) * 0.07, 2);

  update orders.orders o
     set subtotal        = v_subtotal,
         discount_amount = v_discount,
         vat_amount      = v_vat,
         total           = v_subtotal - v_discount + v_vat
   where o.id = p_order_id
     and o.status in ('open', 'waiting_payment')
  returning o.* into v_order;

  if v_order.id is null then
    select * into v_order from orders.orders where id = p_order_id;
  end if;
  return v_order;
end;
$$;

-- trigger: order_items เปลี่ยน → คำนวณใหม่
create or replace function orders.trg_order_items_recalc()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform orders.recalc_order_totals(new.order_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.order_id <> new.order_id) then
    perform orders.recalc_order_totals(old.order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists order_items_recalc on orders.order_items;
create trigger order_items_recalc
after insert or update or delete on orders.order_items
for each row execute function orders.trg_order_items_recalc();

-- trigger: order_item_options เปลี่ยน → คำนวณใหม่
create or replace function orders.trg_order_item_options_recalc()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid;
begin
  select order_id into v_order_id
  from orders.order_items
  where id = coalesce(new.order_item_id, old.order_item_id);

  if v_order_id is not null then   -- null = order_item ถูกลบไปพร้อมกัน (cascade)
    perform orders.recalc_order_totals(v_order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists order_item_options_recalc on orders.order_item_options;
create trigger order_item_options_recalc
after insert or update or delete on orders.order_item_options
for each row execute function orders.trg_order_item_options_recalc();

-- ---------------------------------------------------------------------
-- กันสั่งอาหารในบิลที่ไม่ใช่ open และ ticket ต้องอยู่สาขาเดียวกับบิล
-- ---------------------------------------------------------------------
create or replace function orders.trg_kitchen_tickets_guard()
returns trigger
language plpgsql
as $$
declare
  v_order orders.orders;
begin
  select * into v_order from orders.orders where id = new.order_id;

  if tg_op = 'INSERT' and v_order.status <> 'open' then
    raise exception 'ORDER_NOT_OPEN: สั่งอาหารได้เฉพาะบิลที่ยังเปิดอยู่ (status = %)', v_order.status
      using errcode = 'P0001';
  end if;
  if new.branch_id <> v_order.branch_id then
    raise exception 'BRANCH_MISMATCH: kitchen_ticket.branch_id ไม่ตรงกับบิล'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists kitchen_tickets_guard on orders.kitchen_tickets;
create trigger kitchen_tickets_guard
before insert or update of order_id, branch_id on orders.kitchen_tickets
for each row execute function orders.trg_kitchen_tickets_guard();

create or replace function orders.trg_order_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_status orders.order_status;
begin
  select status into v_status from orders.orders where id = new.order_id;
  if v_status <> 'open' then
    raise exception 'ORDER_NOT_OPEN: แก้รายการได้เฉพาะบิลที่ยังเปิดอยู่ (status = %)', v_status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists order_items_guard on orders.order_items;
create trigger order_items_guard
before insert or update on orders.order_items
for each row execute function orders.trg_order_items_guard();

-- รอบถัดไปของบิล (ใช้ตอนสร้าง kitchen_ticket; unique(order_id, round_no) กันชนกัน)
create or replace function orders.next_round_no(p_order_id uuid)
returns int
language sql
stable
as $$
  select coalesce(max(round_no), 0) + 1 from orders.kitchen_tickets where order_id = p_order_id;
$$;

-- ---------------------------------------------------------------------
-- สถานะโต๊ะ: คำนวณจากบิลที่ใช้โต๊ะอยู่ (order_tables.left_at is null)
--   open → occupied, waiting_payment → waiting_payment, ไม่มีบิล → available
-- ---------------------------------------------------------------------
create or replace function orders.sync_table_status(p_table_id uuid)
returns void
language plpgsql
as $$
declare
  v_order_status orders.order_status;
begin
  select o.status into v_order_status
  from orders.order_tables ot
  join orders.orders o on o.id = ot.order_id
  where ot.table_id = p_table_id
    and ot.left_at is null
  limit 1;

  update orders.dining_tables t
     set status = case v_order_status
                    when 'open'            then 'occupied'::orders.table_status
                    when 'waiting_payment' then 'waiting_payment'::orders.table_status
                    else 'available'::orders.table_status
                  end
   where t.id = p_table_id;
end;
$$;

-- order_tables: เช็กสาขา/โต๊ะ active ก่อนใช้โต๊ะ
create or replace function orders.trg_order_tables_guard()
returns trigger
language plpgsql
as $$
declare
  v_order_branch uuid;
  v_table        orders.dining_tables;
begin
  if new.left_at is not null then
    return new;   -- ปิดการใช้โต๊ะ ไม่ต้องเช็ก
  end if;

  select branch_id into v_order_branch from orders.orders where id = new.order_id;
  select * into v_table from orders.dining_tables where id = new.table_id;

  if v_table.branch_id <> v_order_branch then
    raise exception 'BRANCH_MISMATCH: โต๊ะไม่ได้อยู่สาขาเดียวกับบิล' using errcode = 'P0001';
  end if;
  if not v_table.is_active then
    raise exception 'TABLE_INACTIVE: โต๊ะถูกปิดใช้งาน' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists order_tables_guard on orders.order_tables;
create trigger order_tables_guard
before insert or update on orders.order_tables
for each row execute function orders.trg_order_tables_guard();

create or replace function orders.trg_order_tables_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform orders.sync_table_status(new.table_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.table_id <> new.table_id) then
    perform orders.sync_table_status(old.table_id);
  end if;
  return null;
end;
$$;

drop trigger if exists order_tables_sync on orders.order_tables;
create trigger order_tables_sync
after insert or update or delete on orders.order_tables
for each row execute function orders.trg_order_tables_sync();

-- orders: ห้ามย้อนสถานะจากบิลที่ปิดแล้ว + ตั้ง closed_at ให้อัตโนมัติ
create or replace function orders.trg_orders_status_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'paid' and new.status <> 'refunded' then
    raise exception 'INVALID_STATUS: บิลที่จ่ายแล้วเปลี่ยนได้เป็น refunded เท่านั้น' using errcode = 'P0001';
  end if;
  if old.status = 'refunded' then
    raise exception 'INVALID_STATUS: บิลที่คืนเงินแล้วเปลี่ยนสถานะไม่ได้' using errcode = 'P0001';
  end if;
  if new.status = 'refunded' and old.status <> 'paid' then
    raise exception 'INVALID_STATUS: คืนเงินได้เฉพาะบิลที่จ่ายแล้ว' using errcode = 'P0001';
  end if;

  if new.status = 'paid' and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists orders_status_guard on orders.orders;
create trigger orders_status_guard
before update of status on orders.orders
for each row execute function orders.trg_orders_status_guard();

-- orders: สถานะเปลี่ยน → paid ปล่อยโต๊ะทั้งหมด (1.26), อื่น ๆ sync สถานะโต๊ะ
create or replace function orders.trg_orders_status_sync()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.status = old.status then
    return null;
  end if;

  if new.status in ('paid', 'refunded') then
    update orders.order_tables
       set left_at = coalesce(new.closed_at, now())
     where order_id = new.id
       and left_at is null;               -- trigger order_tables_sync จะคืนโต๊ะเป็น available
  else
    for r in select table_id from orders.order_tables where order_id = new.id and left_at is null loop
      perform orders.sync_table_status(r.table_id);
    end loop;
  end if;
  return null;
end;
$$;

drop trigger if exists orders_status_sync on orders.orders;
create trigger orders_status_sync
after update of status on orders.orders
for each row execute function orders.trg_orders_status_sync();

-- ---------------------------------------------------------------------
-- approvals (1.27–1.31)
-- ---------------------------------------------------------------------
create or replace function orders.trg_approvals_insert_guard()
returns trigger
language plpgsql
as $$
declare
  v_order orders.orders;
begin
  select * into v_order from orders.orders where id = new.order_id;

  if new.branch_id <> v_order.branch_id then
    raise exception 'BRANCH_MISMATCH: approval.branch_id ไม่ตรงกับบิล' using errcode = 'P0001';
  end if;
  if new.type = 'discount' and v_order.status not in ('open', 'waiting_payment') then
    raise exception 'ORDER_ALREADY_PAID: ขอส่วนลดได้เฉพาะบิลที่ยังไม่จ่าย' using errcode = 'P0001';
  end if;
  if new.type = 'refund' and v_order.status <> 'paid' then
    raise exception 'ORDER_NOT_PAID: ขอคืนเงินได้เฉพาะบิลที่จ่ายแล้ว' using errcode = 'P0001';
  end if;

  -- คำขอใหม่ต้องเป็น pending เสมอ
  new.status       := 'pending';
  new.approved_by  := null;
  new.decided_at   := null;
  new.requested_at := coalesce(new.requested_at, now());
  return new;
end;
$$;

drop trigger if exists approvals_insert_guard on orders.approvals;
create trigger approvals_insert_guard
before insert on orders.approvals
for each row execute function orders.trg_approvals_insert_guard();

-- log ห้ามแก้หลังตัดสิน และแก้ได้เฉพาะฟิลด์การตัดสิน (1.31)
create or replace function orders.trg_approvals_update_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'APPROVAL_DECIDED: คำขอนี้ตัดสินไปแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;

  if (new.order_id, new.branch_id, new.requested_by, new.type, new.value_type,
      new.value, new.reason, new.requested_at)
     is distinct from
     (old.order_id, old.branch_id, old.requested_by, old.type, old.value_type,
      old.value, old.reason, old.requested_at) then
    raise exception 'APPROVAL_IMMUTABLE: แก้ได้เฉพาะ status / approved_by / decided_at / amount'
      using errcode = 'P0001';
  end if;

  if new.status <> 'pending' and new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists approvals_update_guard on orders.approvals;
create trigger approvals_update_guard
before update on orders.approvals
for each row execute function orders.trg_approvals_update_guard();

create or replace function orders.trg_approvals_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'APPROVAL_UNDELETABLE: ห้ามลบ log คำขออนุมัติ' using errcode = 'P0001';
end;
$$;

drop trigger if exists approvals_no_delete on orders.approvals;
create trigger approvals_no_delete
before delete on orders.approvals
for each row execute function orders.trg_approvals_no_delete();

-- ส่วนลดถูกอนุมัติ → คำนวณยอดบิลใหม่ (1.30)
create or replace function orders.trg_approvals_recalc()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'discount' and new.status is distinct from old.status then
    perform orders.recalc_order_totals(new.order_id);
  end if;
  return null;
end;
$$;

drop trigger if exists approvals_recalc on orders.approvals;
create trigger approvals_recalc
after update of status on orders.approvals
for each row execute function orders.trg_approvals_recalc();

-- refund_items: order_item ต้องอยู่ในบิลเดียวกับคำขอ, type = refund, คืนเกินจำนวนที่สั่งไม่ได้
create or replace function orders.trg_refund_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_approval  orders.approvals;
  v_item      orders.order_items;
  v_refunded  int;
begin
  select * into v_approval from orders.approvals where id = new.approval_id;
  select * into v_item     from orders.order_items where id = new.order_item_id;

  if v_approval.type <> 'refund' then
    raise exception 'VALIDATION_ERROR: refund_items ใช้กับคำขอ type = refund เท่านั้น' using errcode = 'P0001';
  end if;
  if v_item.order_id <> v_approval.order_id then
    raise exception 'VALIDATION_ERROR: รายการไม่ได้อยู่ในบิลของคำขอนี้' using errcode = 'P0001';
  end if;

  -- จำนวนที่คืนไปแล้ว (เฉพาะคำขอที่ไม่ถูกปฏิเสธ) + ครั้งนี้ ต้องไม่เกินที่สั่ง
  select coalesce(sum(ri.quantity), 0) into v_refunded
  from orders.refund_items ri
  join orders.approvals a on a.id = ri.approval_id
  where ri.order_item_id = new.order_item_id
    and a.status <> 'rejected'
    and ri.id <> new.id;

  if v_refunded + new.quantity > v_item.quantity then
    raise exception 'VALIDATION_ERROR: คืนเกินจำนวนที่สั่ง (สั่ง %, คืนแล้ว %, ขอคืน %)',
      v_item.quantity, v_refunded, new.quantity using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_items_guard on orders.refund_items;
create trigger refund_items_guard
before insert or update on orders.refund_items
for each row execute function orders.trg_refund_items_guard();

-- =====================================================================
-- POS service — RLS + Supabase Realtime (ข้อ 6 ในสเปก)
--
--  - service pos ต่อ DB ด้วย service_role/postgres → bypass RLS
--  - client (JWT ผู้ใช้ = role `authenticated`) เห็นได้แค่ 2 ตารางที่ใช้ Realtime:
--      kitchen_tickets : จอครัว — แถวที่ branch_id ตรง claim (owner เห็นทุกสาขา)
--      approvals       : แจ้งเตือนคำขอ — manager สาขาตัวเอง, owner ทุกสาขา,
--                        staff เห็นเฉพาะคำขอของตัวเอง
--  - Realtime ใช้แค่ "แจ้ง" แล้ว client ไปดึงรายละเอียดผ่าน gateway
--  - claim `user_role`, `branch_id` ใส่โดย custom access token hook ของ Dev 1
-- =====================================================================

-- helper อ่าน claim จาก JWT
create or replace function orders.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'user_role', '');
$$;

create or replace function orders.jwt_branch_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'branch_id', '')::uuid;
$$;

-- เปิด RLS ทุกตาราง (ไม่มี policy = authenticated/anon มองไม่เห็น)
alter table orders.dining_tables      enable row level security;
alter table orders.orders             enable row level security;
alter table orders.order_tables       enable row level security;
alter table orders.kitchen_tickets    enable row level security;
alter table orders.order_items        enable row level security;
alter table orders.order_item_options enable row level security;
alter table orders.approvals          enable row level security;
alter table orders.refund_items       enable row level security;

-- สิทธิ์ระดับ schema/table
grant usage on schema orders to service_role, authenticated;
grant all on all tables    in schema orders to service_role;
grant all on all sequences in schema orders to service_role;
grant execute on all functions in schema orders to service_role;
grant execute on function orders.jwt_role(), orders.jwt_branch_id() to authenticated;

grant select on orders.kitchen_tickets to authenticated;
grant select on orders.approvals       to authenticated;

-- ---------------------------------------------------------------------
-- kitchen_tickets — จอครัว (staff / manager ของสาขา, owner ทุกสาขา)
-- ---------------------------------------------------------------------
drop policy if exists kitchen_tickets_select_branch on orders.kitchen_tickets;
create policy kitchen_tickets_select_branch
on orders.kitchen_tickets
for select
to authenticated
using (
  (orders.jwt_role() in ('staff', 'manager') and branch_id = orders.jwt_branch_id())
  or orders.jwt_role() = 'owner'
);

-- ---------------------------------------------------------------------
-- approvals — แจ้งเตือนคำขออนุมัติ (1.29)
-- ---------------------------------------------------------------------
drop policy if exists approvals_select_manager_owner on orders.approvals;
create policy approvals_select_manager_owner
on orders.approvals
for select
to authenticated
using (
  (orders.jwt_role() = 'manager' and branch_id = orders.jwt_branch_id())
  or orders.jwt_role() = 'owner'
);

drop policy if exists approvals_select_own_request on orders.approvals;
create policy approvals_select_own_request
on orders.approvals
for select
to authenticated
using (
  orders.jwt_role() = 'staff' and requested_by = auth.uid()
);

-- ---------------------------------------------------------------------
-- Realtime: เพิ่มตารางเข้า publication ของ Supabase
-- ---------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table orders.kitchen_tickets; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table orders.approvals; exception when duplicate_object then null; end;
  end if;
end $$;


-- =====================================================================
-- ฟังก์ชันที่ service pos เรียก (ทำหลายตารางใน transaction เดียว)
-- error ขึ้นต้นด้วยรหัส เช่น 'TABLE_BUSY:' ให้ service แปลงเป็นข้อความ
-- =====================================================================

-- เปิดบิล + จองโต๊ะ (1.7) · โต๊ะต้องว่าง อยู่สาขาเดียวกัน และเปิดใช้งาน
create or replace function orders.open_order(p_branch uuid, p_by uuid, p_guest_count int, p_table_ids uuid[])
returns orders.orders
language plpgsql
as $$
declare
  v_order orders.orders;
  v_table orders.dining_tables;
  v_id uuid;
begin
  if coalesce(array_length(p_table_ids, 1), 0) = 0 then
    raise exception 'VALIDATION_ERROR: ต้องเลือกโต๊ะอย่างน้อย 1 โต๊ะ' using errcode = 'P0001';
  end if;
  foreach v_id in array p_table_ids loop
    select * into v_table from orders.dining_tables where id = v_id for update;
    if v_table.id is null or v_table.branch_id <> p_branch or not v_table.is_active then
      raise exception 'TABLE_NOT_FOUND: ไม่พบโต๊ะในสาขานี้' using errcode = 'P0001';
    end if;
    if exists (select 1 from orders.order_tables where table_id = v_id and left_at is null) then
      raise exception 'TABLE_BUSY: โต๊ะ % มีบิลเปิดอยู่แล้ว', v_table.table_no using errcode = 'P0001';
    end if;
  end loop;

  insert into orders.orders (branch_id, opened_by, guest_count)
  values (p_branch, p_by, p_guest_count)
  returning * into v_order;

  insert into orders.order_tables (order_id, table_id)
  select v_order.id, t from unnest(p_table_ids) t;

  return v_order;
end;
$$;

-- สั่งอาหาร 1 รอบ (1.9) · p_items = [{menu_id, menu_name, quantity, unit_price, note, options:[{option_id, option_name, extra_price}]}]
-- ราคาและชื่อมาจาก catalog (snapshot) · ticket id สร้างจาก service เพื่อใช้เป็น reference ตอนตัดสต็อก
create or replace function orders.place_ticket(p_ticket_id uuid, p_order uuid, p_by uuid, p_items jsonb)
returns orders.kitchen_tickets
language plpgsql
as $$
declare
  v_order  orders.orders;
  v_ticket orders.kitchen_tickets;
  v_item   jsonb;
  v_opt    jsonb;
  v_item_id uuid;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND: ไม่พบบิล' using errcode = 'P0001';
  end if;

  insert into orders.kitchen_tickets (id, order_id, branch_id, created_by, round_no, printed_at)
  values (p_ticket_id, p_order, v_order.branch_id, p_by, orders.next_round_no(p_order), now())
  returning * into v_ticket;

  for v_item in select * from jsonb_array_elements(p_items) loop
    insert into orders.order_items (order_id, ticket_id, menu_id, menu_name, quantity, unit_price, note)
    values (p_order, v_ticket.id, (v_item->>'menu_id')::uuid, v_item->>'menu_name',
            (v_item->>'quantity')::int, (v_item->>'unit_price')::numeric, nullif(v_item->>'note', ''))
    returning id into v_item_id;

    for v_opt in select * from jsonb_array_elements(coalesce(v_item->'options', '[]'::jsonb)) loop
      insert into orders.order_item_options (order_item_id, option_id, option_name, extra_price)
      values (v_item_id, (v_opt->>'option_id')::uuid, v_opt->>'option_name', coalesce((v_opt->>'extra_price')::numeric, 0));
    end loop;
  end loop;

  return v_ticket;
end;
$$;

-- ย้ายโต๊ะ (1.11): ออกจากโต๊ะเดิม เข้าโต๊ะใหม่ที่ว่าง
create or replace function orders.move_table(p_order uuid, p_from uuid, p_to uuid)
returns void
language plpgsql
as $$
declare
  v_order orders.orders;
  v_to orders.dining_tables;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.status not in ('open', 'waiting_payment') then
    raise exception 'ORDER_CLOSED: บิลนี้ปิดแล้ว' using errcode = 'P0001';
  end if;
  if not exists (select 1 from orders.order_tables where order_id = p_order and table_id = p_from and left_at is null) then
    raise exception 'TABLE_NOT_IN_ORDER: โต๊ะเดิมไม่ได้อยู่ในบิลนี้' using errcode = 'P0001';
  end if;
  select * into v_to from orders.dining_tables where id = p_to for update;
  if v_to.id is null or v_to.branch_id <> v_order.branch_id or not v_to.is_active then
    raise exception 'TABLE_NOT_FOUND: ไม่พบโต๊ะปลายทางในสาขานี้' using errcode = 'P0001';
  end if;
  if exists (select 1 from orders.order_tables where table_id = p_to and left_at is null) then
    raise exception 'TABLE_BUSY: โต๊ะ % มีบิลเปิดอยู่แล้ว', v_to.table_no using errcode = 'P0001';
  end if;

  update orders.order_tables set left_at = now() where order_id = p_order and table_id = p_from and left_at is null;
  insert into orders.order_tables (order_id, table_id) values (p_order, p_to);
end;
$$;

-- รวมโต๊ะ (1.12): เพิ่มโต๊ะว่างเข้าบิลนี้ (1 บิลหลายโต๊ะ ไม่มีแยกบิล 1.13)
create or replace function orders.merge_tables(p_order uuid, p_table_ids uuid[])
returns void
language plpgsql
as $$
declare
  v_order orders.orders;
  v_table orders.dining_tables;
  v_id uuid;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.status not in ('open', 'waiting_payment') then
    raise exception 'ORDER_CLOSED: บิลนี้ปิดแล้ว' using errcode = 'P0001';
  end if;
  foreach v_id in array p_table_ids loop
    select * into v_table from orders.dining_tables where id = v_id for update;
    if v_table.id is null or v_table.branch_id <> v_order.branch_id or not v_table.is_active then
      raise exception 'TABLE_NOT_FOUND: ไม่พบโต๊ะในสาขานี้' using errcode = 'P0001';
    end if;
    if exists (select 1 from orders.order_tables where table_id = v_id and left_at is null and order_id = p_order) then
      continue;
    end if;
    if exists (select 1 from orders.order_tables where table_id = v_id and left_at is null) then
      raise exception 'TABLE_BUSY: โต๊ะ % มีบิลอื่นเปิดอยู่ (รวมได้เฉพาะโต๊ะว่าง)', v_table.table_no using errcode = 'P0001';
    end if;
    insert into orders.order_tables (order_id, table_id) values (p_order, v_id);
  end loop;
end;
$$;

-- ยกเลิกบิลที่ยังไม่มีรายการ (เปิดโต๊ะผิด) · มีรายการแล้วยกเลิกไม่ได้
create or replace function orders.cancel_empty_order(p_order uuid)
returns void
language plpgsql
as $$
declare
  v_order orders.orders;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.status <> 'open' then
    raise exception 'ORDER_CLOSED: ยกเลิกได้เฉพาะบิลที่ยังเปิดอยู่' using errcode = 'P0001';
  end if;
  if exists (select 1 from orders.kitchen_tickets where order_id = p_order) then
    raise exception 'ORDER_HAS_ITEMS: บิลนี้สั่งอาหารแล้ว ยกเลิกไม่ได้' using errcode = 'P0001';
  end if;
  delete from orders.order_tables where order_id = p_order;   -- trigger คืนโต๊ะเป็นว่าง
  delete from orders.orders where id = p_order;
end;
$$;

-- เรียกเก็บเงิน (1.24): open → waiting_payment พร้อมคำนวณยอดล่าสุด
create or replace function orders.request_payment(p_order uuid)
returns orders.orders
language plpgsql
as $$
declare
  v_order orders.orders;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.status = 'waiting_payment' then
    return orders.recalc_order_totals(p_order);
  end if;
  if v_order.status <> 'open' then
    raise exception 'ORDER_CLOSED: บิลนี้ปิดแล้ว' using errcode = 'P0001';
  end if;
  if not exists (select 1 from orders.order_items where order_id = p_order) then
    raise exception 'ORDER_EMPTY: บิลยังไม่มีรายการอาหาร' using errcode = 'P0001';
  end if;
  perform orders.recalc_order_totals(p_order);
  update orders.orders set status = 'waiting_payment' where id = p_order returning * into v_order;
  return v_order;
end;
$$;

-- payment แจ้งว่ารับเงินแล้ว → paid คืนโต๊ะ (1.26) · เรียกซ้ำได้
create or replace function orders.mark_paid(p_order uuid, p_by uuid)
returns orders.orders
language plpgsql
as $$
declare
  v_order orders.orders;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND: ไม่พบบิล' using errcode = 'P0001';
  end if;
  if v_order.status in ('paid', 'refunded') then
    return v_order;
  end if;
  if v_order.status <> 'waiting_payment' then
    raise exception 'ORDER_NOT_WAITING_PAYMENT: บิลยังไม่ได้เรียกเก็บเงิน' using errcode = 'P0001';
  end if;
  update orders.orders set status = 'paid', closed_by = p_by, closed_at = now() where id = p_order returning * into v_order;
  return v_order;
end;
$$;

-- payment แจ้งว่าคืนเงินแล้ว · คืนครบยอดบิล → refunded (คืนบางส่วนบิลยังเป็น paid) · เรียกซ้ำได้
create or replace function orders.mark_refunded(p_order uuid, p_refunded_total numeric)
returns orders.orders
language plpgsql
as $$
declare
  v_order orders.orders;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND: ไม่พบบิล' using errcode = 'P0001';
  end if;
  if v_order.status = 'paid' and p_refunded_total >= v_order.total then
    update orders.orders set status = 'refunded' where id = p_order returning * into v_order;
  end if;
  return v_order;
end;
$$;

-- เมนูขายดีจากบิลที่จ่ายแล้ว (1.36) ตามวันที่เปิดบิล (เวลาไทย)
create or replace function orders.report_top_menus(p_from date, p_to date, p_branch uuid default null, p_limit int default 10)
returns table (menu_id uuid, menu_name text, quantity bigint, amount numeric)
language sql
stable
as $$
  select oi.menu_id,
         (array_agg(oi.menu_name order by oi.created_at desc))[1],
         sum(oi.quantity),
         round(sum(oi.quantity * (oi.unit_price + coalesce(opt.extra, 0))), 2)
  from orders.order_items oi
  join orders.orders o on o.id = oi.order_id
  left join lateral (select sum(extra_price) extra from orders.order_item_options where order_item_id = oi.id) opt on true
  where o.status in ('paid', 'refunded')
    and o.opened_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
    and o.opened_at < ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')
    and (p_branch is null or o.branch_id = p_branch)
  group by oi.menu_id
  order by 3 desc, 4 desc
  limit greatest(1, least(p_limit, 50));
$$;

-- ขอส่วนลด/คืนเงิน (1.27, 1.28) ทำใน transaction เดียว (คำขอลบไม่ได้ จึงต้องไม่บันทึกครึ่งๆ กลางๆ)
-- p_refund_items = [{order_item_id, quantity}] (คืนบางรายการ) · ยอดคืนต่อรายการคิดตามสัดส่วนที่ลูกค้าจ่ายจริง (หลังส่วนลด รวม VAT)
create or replace function orders.create_approval(
  p_order uuid, p_by uuid, p_type orders.approval_type, p_value_type orders.approval_value_type,
  p_value numeric, p_reason text, p_refund_items jsonb default '[]'::jsonb)
returns orders.approvals
language plpgsql
as $$
declare
  v_order orders.orders;
  v_appr  orders.approvals;
  v_amount numeric(12,2);
  v_ratio numeric;
  v_left  numeric(12,2);
  v_ri    jsonb;
  v_item  orders.order_items;
  v_line  numeric;
begin
  select * into v_order from orders.orders where id = p_order for update;
  if v_order.id is null then
    raise exception 'ORDER_NOT_FOUND: ไม่พบบิล' using errcode = 'P0001';
  end if;

  if p_type = 'discount' then
    v_amount := case p_value_type when 'percent' then round(v_order.subtotal * p_value / 100, 2) else p_value end;
    v_amount := least(v_amount, v_order.subtotal);
  else
    -- ยอดที่ยังคืนได้ = ยอดบิล − คำขอคืนเงินที่ยังไม่ถูกปฏิเสธ
    select v_order.total - coalesce(sum(amount), 0) into v_left
    from orders.approvals where order_id = p_order and type = 'refund' and status <> 'rejected';
    if jsonb_array_length(coalesce(p_refund_items, '[]'::jsonb)) > 0 then
      v_ratio := case when v_order.subtotal > 0 then v_order.total / v_order.subtotal else 0 end;
      v_amount := 0;
      for v_ri in select * from jsonb_array_elements(p_refund_items) loop
        select * into v_item from orders.order_items where id = (v_ri->>'order_item_id')::uuid and order_id = p_order;
        if v_item.id is null then
          raise exception 'VALIDATION_ERROR: รายการไม่ได้อยู่ในบิลนี้' using errcode = 'P0001';
        end if;
        select v_item.unit_price + coalesce(sum(extra_price), 0) into v_line from orders.order_item_options where order_item_id = v_item.id;
        v_amount := v_amount + round(v_line * (v_ri->>'quantity')::int * v_ratio, 2);
      end loop;
    else
      v_amount := case p_value_type when 'percent' then round(v_order.total * p_value / 100, 2) else p_value end;
    end if;
    if v_amount > v_left then
      raise exception 'REFUND_EXCEEDS_TOTAL: ขอคืนได้อีกไม่เกิน % บาท', v_left using errcode = 'P0001';
    end if;
  end if;

  insert into orders.approvals (order_id, branch_id, requested_by, type, value_type, value, amount, reason)
  values (p_order, v_order.branch_id, p_by, p_type, p_value_type,
          case when p_type = 'refund' and jsonb_array_length(coalesce(p_refund_items, '[]'::jsonb)) > 0 then greatest(v_amount, 0.01) else p_value end,
          v_amount, btrim(p_reason))
  returning * into v_appr;

  if p_type = 'refund' then
    for v_ri in select * from jsonb_array_elements(coalesce(p_refund_items, '[]'::jsonb)) loop
      select * into v_item from orders.order_items where id = (v_ri->>'order_item_id')::uuid;
      select v_item.unit_price + coalesce(sum(extra_price), 0) into v_line from orders.order_item_options where order_item_id = v_item.id;
      insert into orders.refund_items (approval_id, order_item_id, quantity, amount)
      values (v_appr.id, v_item.id, (v_ri->>'quantity')::int, round(v_line * (v_ri->>'quantity')::int * v_ratio, 2));
    end loop;
  end if;
  return v_appr;
end;
$$;

-- สิทธิ์ของฟังก์ชันที่เพิ่มด้านบน (service_role เท่านั้น)
grant execute on all functions in schema orders to service_role;
revoke execute on function orders.open_order(uuid, uuid, int, uuid[]), orders.place_ticket(uuid, uuid, uuid, jsonb),
  orders.move_table(uuid, uuid, uuid), orders.merge_tables(uuid, uuid[]), orders.cancel_empty_order(uuid),
  orders.request_payment(uuid), orders.mark_paid(uuid, uuid), orders.mark_refunded(uuid, numeric),
  orders.report_top_menus(date, date, uuid, int),
  orders.create_approval(uuid, uuid, orders.approval_type, orders.approval_value_type, numeric, text, jsonb) from public, anon, authenticated;

notify pgrst, 'reload schema';
