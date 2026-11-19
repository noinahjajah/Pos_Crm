-- pos: โต๊ะ บิล ตั๋วครัว รายการอาหาร คำขอส่วนลด/คืนเงิน (Dev 3)
-- อ้างอิง เอกสาร/pos-crm-phase1-spec.md ข้อ 1.7–1.13, 1.20, 1.23–1.31 · รันซ้ำได้
--
-- กติกา
-- - branch_id / *_by / menu_id / option_id อ้างถึง service อื่น เก็บแค่ uuid ไม่มี foreign key ข้าม schema
-- - service pos ต่อด้วย service_role (ข้าม RLS) · ทุกการเปลี่ยนสถานะสำคัญทำผ่านฟังก์ชันด้านล่าง (atomic + ล็อกแถว)
-- - client (JWT ผู้ใช้) อ่านได้แค่ kitchen_tickets และ approvals เพื่อใช้ Supabase Realtime เป็น "สัญญาณ" เท่านั้น
-- - ยอดเงินตาม 1.24: vat = round((subtotal − discount) × 7%, 2) · total = subtotal − discount + vat (ราคาเมนูก่อน VAT)
-- - ตัดสต็อก (1.20) อยู่ที่ catalog: service เรียก catalog deduct ด้วย reference = id ตั๋ว ก่อน pos.add_ticket
--   ถ้า add_ticket ล้มเหลว ให้เรียก catalog restore ด้วย reference เดิม · คืนเงินไม่คืนสต็อก (1.28)

create schema if not exists pos;

do $$ begin
  create type pos.table_status as enum ('available', 'occupied', 'waiting_payment');
exception when duplicate_object then null; end $$;
do $$ begin
  -- merged = ถูกรวมเข้าบิลอื่น · cancelled = เปิดโต๊ะผิด ยังไม่สั่งอะไร
  create type pos.order_status as enum ('open', 'waiting_payment', 'paid', 'refunded', 'merged', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pos.ticket_status as enum ('pending', 'preparing', 'served');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pos.approval_type as enum ('discount', 'refund');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pos.approval_value_type as enum ('amount', 'percent');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pos.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;
do $$ begin
  create type pos.payment_method as enum ('cash', 'promptpay');
exception when duplicate_object then null; end $$;

create sequence if not exists pos.order_no_seq;
create sequence if not exists pos.request_no_seq;

-- ===================== ตาราง =====================
-- โต๊ะของสาขา · status คำนวณจากบิลที่ใช้โต๊ะอยู่ (trigger) อย่าแก้เอง
create table if not exists pos.dining_tables (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  table_no text not null,
  seats integer not null default 4,
  zone text,
  status pos.table_status not null default 'available',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint dining_tables_pkey primary key (id),
  constraint dining_tables_table_no_check check (length(trim(both from table_no)) between 1 and 20),
  constraint dining_tables_seats_check check (seats between 1 and 50)
);

-- บิล · 1 บิลใช้ได้หลายโต๊ะ ไม่มีแยกบิล (1.13)
create table if not exists pos.orders (
  id uuid not null default gen_random_uuid(),
  order_no text not null default ('B' || to_char(now() at time zone 'Asia/Bangkok', 'YYMMDD') || '-' || lpad(nextval('pos.order_no_seq')::text, 4, '0')),
  branch_id uuid not null,
  opened_by uuid not null,
  closed_by uuid,
  customer_id uuid,                                   -- เฟส 2 (membership)
  guest_count integer not null,
  status pos.order_status not null default 'open',
  subtotal numeric(12, 2) not null default 0,         -- ก่อน VAT
  discount_amount numeric(12, 2) not null default 0,  -- ส่วนลดที่อนุมัติแล้วเท่านั้น (1.30)
  vat_amount numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  refunded_amount numeric(12, 2) not null default 0,  -- เงินที่คืนไปแล้ว (คืนบางส่วนได้หลายครั้ง)
  payment_id uuid,                                    -- ref payment.payments (จาก mark-paid)
  payment_method pos.payment_method,
  merged_into uuid,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint orders_pkey primary key (id),
  constraint orders_order_no_key unique (order_no),
  constraint orders_merged_into_fkey foreign key (merged_into) references pos.orders (id),
  constraint orders_guest_count_check check (guest_count between 1 and 200),
  constraint orders_money_check check (subtotal >= 0 and discount_amount >= 0 and vat_amount >= 0 and total >= 0 and refunded_amount >= 0),
  constraint orders_discount_le_subtotal check (discount_amount <= subtotal),
  constraint orders_refund_le_total check (refunded_amount <= total),
  constraint orders_closed_consistency check ((status in ('paid', 'refunded', 'merged', 'cancelled')) = (closed_at is not null)),
  constraint orders_paid_has_payment check (status not in ('paid', 'refunded') or (payment_id is not null and payment_method is not null)),
  constraint orders_merged_has_target check ((status = 'merged') = (merged_into is not null))
);

-- โต๊ะที่บิลใช้ · left_at = null คือยังใช้อยู่ (ย้าย/รวมโต๊ะ 1.11, 1.12)
create table if not exists pos.order_tables (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  table_id uuid not null,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  constraint order_tables_pkey primary key (id),
  constraint order_tables_order_id_fkey foreign key (order_id) references pos.orders (id),
  constraint order_tables_table_id_fkey foreign key (table_id) references pos.dining_tables (id),
  constraint order_tables_left_after_join check (left_at is null or left_at >= joined_at)
);

-- สั่งแต่ละรอบ = ตั๋วครัว 1 ใบ (1.9, 1.10) · branch_id ใช้ทำ RLS ของ Realtime
create table if not exists pos.kitchen_tickets (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  branch_id uuid not null,
  created_by uuid not null,
  round_no integer not null,
  status pos.ticket_status not null default 'pending',
  created_at timestamptz not null default now(),
  printed_at timestamptz,
  status_changed_at timestamptz not null default now(),
  constraint kitchen_tickets_pkey primary key (id),
  constraint kitchen_tickets_order_id_fkey foreign key (order_id) references pos.orders (id),
  constraint kitchen_tickets_order_round_key unique (order_id, round_no),
  constraint kitchen_tickets_id_order_key unique (id, order_id),
  constraint kitchen_tickets_round_no_check check (round_no >= 1)
);

-- รายการอาหาร + snapshot ชื่อ/ราคาตอนสั่ง
create table if not exists pos.order_items (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  ticket_id uuid not null,
  menu_id uuid not null,
  menu_name text not null,
  quantity integer not null,
  unit_price numeric(12, 2) not null,
  note text,
  created_at timestamptz not null default now(),
  constraint order_items_pkey primary key (id),
  constraint order_items_order_id_fkey foreign key (order_id) references pos.orders (id),
  -- ตั๋วต้องเป็นของบิลเดียวกัน (on update cascade ให้ย้ายตั๋วตอนรวมบิลได้)
  constraint order_items_ticket_fkey foreign key (ticket_id, order_id) references pos.kitchen_tickets (id, order_id) on update cascade,
  constraint order_items_quantity_check check (quantity between 1 and 999),
  constraint order_items_unit_price_check check (unit_price >= 0),
  constraint order_items_note_check check (note is null or length(note) <= 200)
);

create table if not exists pos.order_item_options (
  id uuid not null default gen_random_uuid(),
  order_item_id uuid not null,
  option_id uuid not null,
  option_name text not null,
  extra_price numeric(12, 2) not null default 0,
  constraint order_item_options_pkey primary key (id),
  constraint order_item_options_order_item_id_fkey foreign key (order_item_id) references pos.order_items (id) on delete cascade,
  constraint order_item_options_key unique (order_item_id, option_id),
  constraint order_item_options_extra_price_check check (extra_price >= 0)
);

-- คำขอส่วนลด/คืนเงิน (1.27–1.31) · ห้ามลบ · แก้ได้แค่ตอนตัดสิน (+ บันทึกว่าคืนเงินแล้ว)
create table if not exists pos.approvals (
  id uuid not null default gen_random_uuid(),
  request_no text not null default ('RQ-' || lpad(nextval('pos.request_no_seq')::text, 4, '0')),
  order_id uuid not null,
  branch_id uuid not null,
  requested_by uuid not null,
  approved_by uuid,                     -- ผู้ตัดสิน (อนุมัติหรือปฏิเสธ)
  type pos.approval_type not null,
  value_type pos.approval_value_type not null default 'amount',
  value numeric(12, 2) not null,
  amount numeric(12, 2) not null,       -- ยอดเงินที่คำนวณได้ตอนขอ
  reason text not null,
  note text,                            -- หมายเหตุของผู้ตัดสินถึงพนักงาน
  status pos.approval_status not null default 'pending',
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  refunded_at timestamptz,              -- คืนเงินแล้ว (จาก payment mark-refunded)
  refund_payment_id uuid,
  constraint approvals_pkey primary key (id),
  constraint approvals_request_no_key unique (request_no),
  constraint approvals_order_id_fkey foreign key (order_id) references pos.orders (id),
  constraint approvals_value_check check (value > 0 and amount >= 0),
  constraint approvals_percent_range check (value_type <> 'percent' or value <= 100),
  constraint approvals_refund_is_amount check (type <> 'refund' or value_type = 'amount'),
  constraint approvals_reason_check check (length(trim(both from reason)) between 1 and 200),
  constraint approvals_decision_consistency check (
    (status = 'pending' and approved_by is null and decided_at is null)
    or (status <> 'pending' and approved_by is not null and decided_at is not null)
  ),
  constraint approvals_refunded_only_approved_refund check (refunded_at is null or (type = 'refund' and status = 'approved'))
);

-- คืนเงินบางรายการ (คืนทั้งบิล = ไม่มีแถว)
create table if not exists pos.refund_items (
  id uuid not null default gen_random_uuid(),
  approval_id uuid not null,
  order_item_id uuid not null,
  quantity integer not null,
  amount numeric(12, 2) not null,
  constraint refund_items_pkey primary key (id),
  constraint refund_items_approval_id_fkey foreign key (approval_id) references pos.approvals (id),
  constraint refund_items_order_item_id_fkey foreign key (order_item_id) references pos.order_items (id),
  constraint refund_items_key unique (approval_id, order_item_id),
  constraint refund_items_quantity_check check (quantity >= 1 and amount >= 0)
);

-- ===================== index =====================
create unique index if not exists dining_tables_branch_no_uk on pos.dining_tables using btree (branch_id, lower(table_no)) where is_active;
create index if not exists dining_tables_branch_idx on pos.dining_tables using btree (branch_id) where is_active;
create index if not exists orders_branch_status_idx on pos.orders using btree (branch_id, status);
create index if not exists orders_branch_opened_idx on pos.orders using btree (branch_id, opened_at desc);
create index if not exists orders_branch_closed_idx on pos.orders using btree (branch_id, closed_at desc) where closed_at is not null;
-- 1 โต๊ะอยู่ในบิลที่ใช้งานได้แค่บิลเดียว (กันเปิดโต๊ะซ้อน)
create unique index if not exists order_tables_active_table_uk on pos.order_tables using btree (table_id) where left_at is null;
create index if not exists order_tables_order_idx on pos.order_tables using btree (order_id);
create index if not exists kitchen_tickets_branch_status_idx on pos.kitchen_tickets using btree (branch_id, status, created_at);
create index if not exists order_items_order_idx on pos.order_items using btree (order_id);
create index if not exists order_items_ticket_idx on pos.order_items using btree (ticket_id);
create index if not exists order_items_menu_idx on pos.order_items using btree (menu_id);
create index if not exists approvals_branch_status_idx on pos.approvals using btree (branch_id, status, requested_at desc);
create index if not exists approvals_requested_by_idx on pos.approvals using btree (requested_by, requested_at desc);
create index if not exists approvals_order_idx on pos.approvals using btree (order_id);
-- คำขอที่รออนุมัติ: บิลละ 1 คำขอต่อประเภท
create unique index if not exists approvals_one_pending_uk on pos.approvals using btree (order_id, type) where status = 'pending';
create index if not exists refund_items_order_item_idx on pos.refund_items using btree (order_item_id);

-- ===================== คำนวณยอด / สถานะโต๊ะ =====================
-- ยอดบิล: subtotal จากรายการ · ส่วนลดเฉพาะที่ approved (percent คิดจาก subtotal ปัจจุบัน) · VAT 7%
-- บิลที่ปิดแล้วยอดไม่เปลี่ยน
create or replace function pos.recalc_order_totals(p_order_id uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
  v_vat numeric(12, 2);
  o pos.orders;
begin
  select coalesce(sum(oi.quantity * (oi.unit_price + coalesce(x.extra, 0))), 0)
    into v_subtotal
    from pos.order_items oi
    left join lateral (select sum(extra_price) as extra from pos.order_item_options where order_item_id = oi.id) x on true
   where oi.order_id = p_order_id;

  select coalesce(sum(case a.value_type when 'percent' then round(v_subtotal * a.value / 100, 2) else a.value end), 0)
    into v_discount
    from pos.approvals a
   where a.order_id = p_order_id and a.type = 'discount' and a.status = 'approved';

  v_discount := least(v_discount, v_subtotal);
  v_vat := round((v_subtotal - v_discount) * 0.07, 2);

  update pos.orders
     set subtotal = v_subtotal, discount_amount = v_discount, vat_amount = v_vat, total = v_subtotal - v_discount + v_vat
   where id = p_order_id and status in ('open', 'waiting_payment')
  returning * into o;

  if o.id is null then select * into o from pos.orders where id = p_order_id; end if;
  return o;
end $function$;

-- สถานะโต๊ะจากบิลที่ใช้อยู่: open → มีลูกค้า, waiting_payment → รอชำระ, ไม่มี → ว่าง (1.8)
create or replace function pos.sync_table_status(p_table_id uuid)
 returns void
 language plpgsql
as $function$
declare
  v_status pos.order_status;
begin
  select o.status into v_status
    from pos.order_tables ot join pos.orders o on o.id = ot.order_id
   where ot.table_id = p_table_id and ot.left_at is null
   limit 1;

  update pos.dining_tables
     set status = case v_status
                    when 'open' then 'occupied'::pos.table_status
                    when 'waiting_payment' then 'waiting_payment'::pos.table_status
                    else 'available'::pos.table_status
                  end
   where id = p_table_id;
end $function$;

-- ===================== trigger =====================
create or replace function pos.tg_order_items_recalc()
 returns trigger
 language plpgsql
as $function$
begin
  if tg_op <> 'DELETE' then perform pos.recalc_order_totals(new.order_id); end if;
  if tg_op = 'DELETE' or old.order_id <> new.order_id then perform pos.recalc_order_totals(old.order_id); end if;
  return null;
end $function$;

create or replace function pos.tg_order_item_options_recalc()
 returns trigger
 language plpgsql
as $function$
declare
  v_order uuid;
begin
  select order_id into v_order from pos.order_items where id = coalesce(new.order_item_id, old.order_item_id);
  if v_order is not null then perform pos.recalc_order_totals(v_order); end if;
  return null;
end $function$;

-- เพิ่ม/แก้รายการได้เฉพาะบิลที่เปิดอยู่ (ยกเว้นตอนรวมบิลที่ย้าย order_id ระหว่างบิลที่เปิดอยู่)
create or replace function pos.tg_order_items_guard()
 returns trigger
 language plpgsql
as $function$
declare
  v_status pos.order_status;
begin
  select status into v_status from pos.orders where id = new.order_id;
  if v_status is distinct from 'open' then
    raise exception 'POS:ORDER_NOT_OPEN';
  end if;
  return new;
end $function$;

-- ตั๋วต้องอยู่สาขาเดียวกับบิล และสร้างได้เฉพาะบิลที่เปิดอยู่
create or replace function pos.tg_kitchen_tickets_guard()
 returns trigger
 language plpgsql
as $function$
declare
  o pos.orders;
begin
  select * into o from pos.orders where id = new.order_id;
  if new.branch_id <> o.branch_id then raise exception 'POS:BRANCH_MISMATCH'; end if;
  if tg_op = 'INSERT' and o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then new.status_changed_at := now(); end if;
  return new;
end $function$;

-- ใช้โต๊ะ: โต๊ะต้องเปิดใช้และอยู่สาขาเดียวกับบิล
create or replace function pos.tg_order_tables_guard()
 returns trigger
 language plpgsql
as $function$
declare
  v_branch uuid;
  t pos.dining_tables;
begin
  if new.left_at is not null then return new; end if;
  select branch_id into v_branch from pos.orders where id = new.order_id;
  select * into t from pos.dining_tables where id = new.table_id;
  if t.id is null or not t.is_active then raise exception 'POS:TABLE_INACTIVE'; end if;
  if t.branch_id <> v_branch then raise exception 'POS:BRANCH_MISMATCH'; end if;
  return new;
end $function$;

create or replace function pos.tg_order_tables_sync()
 returns trigger
 language plpgsql
as $function$
begin
  if tg_op <> 'DELETE' then perform pos.sync_table_status(new.table_id); end if;
  if tg_op = 'DELETE' or old.table_id <> new.table_id then perform pos.sync_table_status(old.table_id); end if;
  return null;
end $function$;

-- เปลี่ยนสถานะบิลได้ตามลำดับเท่านั้น · ปิดบิล → ตั้ง closed_at
create or replace function pos.tg_orders_status_guard()
 returns trigger
 language plpgsql
as $function$
begin
  if new.status = old.status then return new; end if;
  if not (
       (old.status = 'open' and new.status in ('waiting_payment', 'merged', 'cancelled'))
    or (old.status = 'waiting_payment' and new.status in ('open', 'paid', 'merged'))
    or (old.status = 'paid' and new.status = 'refunded')
  ) then
    raise exception 'POS:INVALID_STATUS % -> %', old.status, new.status;
  end if;
  if new.status in ('paid', 'refunded', 'merged', 'cancelled') and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end $function$;

-- บิลปิด (จ่าย/รวม/ยกเลิก) → ปล่อยโต๊ะทั้งหมดเป็นว่าง (1.26) · อื่น ๆ อัปเดตสถานะโต๊ะ
create or replace function pos.tg_orders_status_sync()
 returns trigger
 language plpgsql
as $function$
declare
  r record;
begin
  if new.status = old.status then return null; end if;
  if new.status in ('paid', 'refunded', 'merged', 'cancelled') then
    update pos.order_tables set left_at = coalesce(new.closed_at, now()) where order_id = new.id and left_at is null;
  else
    for r in select table_id from pos.order_tables where order_id = new.id and left_at is null loop
      perform pos.sync_table_status(r.table_id);
    end loop;
  end if;
  return null;
end $function$;

-- log คำขอ: ห้ามลบ (1.31)
create or replace function pos.tg_approvals_no_delete()
 returns trigger
 language plpgsql
as $function$
begin
  raise exception 'POS:APPROVAL_UNDELETABLE';
end $function$;

-- แก้ได้แค่ตอนตัดสิน (status/approved_by/decided_at/note) และบันทึกคืนเงินครั้งเดียว (refunded_at/refund_payment_id)
create or replace function pos.tg_approvals_update_guard()
 returns trigger
 language plpgsql
as $function$
begin
  if (new.request_no, new.order_id, new.branch_id, new.requested_by, new.type, new.value_type, new.value, new.amount, new.reason, new.requested_at)
     is distinct from
     (old.request_no, old.order_id, old.branch_id, old.requested_by, old.type, old.value_type, old.value, old.amount, old.reason, old.requested_at) then
    raise exception 'POS:APPROVAL_IMMUTABLE';
  end if;
  if old.status <> 'pending' and (new.status, new.approved_by, new.decided_at, new.note) is distinct from (old.status, old.approved_by, old.decided_at, old.note) then
    raise exception 'POS:APPROVAL_DECIDED';
  end if;
  if old.refunded_at is not null and (new.refunded_at, new.refund_payment_id) is distinct from (old.refunded_at, old.refund_payment_id) then
    raise exception 'POS:APPROVAL_ALREADY_REFUNDED';
  end if;
  return new;
end $function$;

-- ส่วนลดเปลี่ยนสถานะ → คำนวณยอดบิลใหม่ (1.30)
create or replace function pos.tg_approvals_recalc()
 returns trigger
 language plpgsql
as $function$
begin
  if new.type = 'discount' and new.status is distinct from old.status then
    perform pos.recalc_order_totals(new.order_id);
  end if;
  return null;
end $function$;

drop trigger if exists order_items_guard on pos.order_items;
create trigger order_items_guard before insert or update on pos.order_items
  for each row execute function pos.tg_order_items_guard();
drop trigger if exists order_items_recalc on pos.order_items;
create trigger order_items_recalc after insert or update or delete on pos.order_items
  for each row execute function pos.tg_order_items_recalc();
drop trigger if exists order_item_options_recalc on pos.order_item_options;
create trigger order_item_options_recalc after insert or update or delete on pos.order_item_options
  for each row execute function pos.tg_order_item_options_recalc();
drop trigger if exists kitchen_tickets_guard on pos.kitchen_tickets;
create trigger kitchen_tickets_guard before insert or update on pos.kitchen_tickets
  for each row execute function pos.tg_kitchen_tickets_guard();
drop trigger if exists order_tables_guard on pos.order_tables;
create trigger order_tables_guard before insert or update on pos.order_tables
  for each row execute function pos.tg_order_tables_guard();
drop trigger if exists order_tables_sync on pos.order_tables;
create trigger order_tables_sync after insert or update or delete on pos.order_tables
  for each row execute function pos.tg_order_tables_sync();
drop trigger if exists orders_status_guard on pos.orders;
create trigger orders_status_guard before update of status on pos.orders
  for each row execute function pos.tg_orders_status_guard();
drop trigger if exists orders_status_sync on pos.orders;
create trigger orders_status_sync after update of status on pos.orders
  for each row execute function pos.tg_orders_status_sync();
drop trigger if exists approvals_no_delete on pos.approvals;
create trigger approvals_no_delete before delete on pos.approvals
  for each row execute function pos.tg_approvals_no_delete();
drop trigger if exists approvals_update_guard on pos.approvals;
create trigger approvals_update_guard before update on pos.approvals
  for each row execute function pos.tg_approvals_update_guard();
drop trigger if exists approvals_recalc on pos.approvals;
create trigger approvals_recalc after update of status on pos.approvals
  for each row execute function pos.tg_approvals_recalc();

-- ===================== ฟังก์ชันที่ service เรียก =====================
-- ข้อผิดพลาดโยนเป็น 'POS:<CODE>' ให้ service แปลงเป็น HTTP (เหมือน catalog)

-- เปิดโต๊ะ/เปิดบิล (1.7) · โต๊ะต้องว่างทุกตัว (ล็อกแถวกันเปิดพร้อมกัน)
create or replace function pos.open_order(p_branch_id uuid, p_table_ids uuid[], p_guest_count integer, p_actor uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
  t pos.dining_tables;
begin
  if coalesce(array_length(p_table_ids, 1), 0) = 0 then raise exception 'POS:BAD_INPUT'; end if;
  for t in select * from pos.dining_tables where id = any (p_table_ids) order by id for update loop
    if t.branch_id <> p_branch_id or not t.is_active then raise exception 'POS:TABLE_NOT_FOUND'; end if;
    if t.status <> 'available' then raise exception 'POS:TABLE_NOT_AVAILABLE'; end if;
  end loop;
  if (select count(*) from pos.dining_tables where id = any (p_table_ids)) <> array_length(p_table_ids, 1) then
    raise exception 'POS:TABLE_NOT_FOUND';
  end if;

  insert into pos.orders (branch_id, opened_by, guest_count) values (p_branch_id, p_actor, p_guest_count) returning * into o;
  insert into pos.order_tables (order_id, table_id) select o.id, unnest(p_table_ids);
  return o;
end $function$;

-- สั่งอาหาร 1 รอบ (1.9) · p_items = [{ menu_id, menu_name, unit_price, quantity, note?, options: [{ option_id, option_name, extra_price }] }]
-- ชื่อ/ราคาเป็น snapshot ที่ service ดึงจาก catalog lookup แล้ว · p_ticket_id = id เดียวกับ reference ที่ใช้ตัดสต็อก
create or replace function pos.add_ticket(p_order_id uuid, p_actor uuid, p_items jsonb, p_ticket_id uuid default gen_random_uuid())
 returns pos.kitchen_tickets
 language plpgsql
as $function$
declare
  o pos.orders;
  k pos.kitchen_tickets;
  e jsonb;
  v_item uuid;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'POS:BAD_INPUT'; end if;

  -- เรียกซ้ำด้วย id เดิม (เน็ตหลุดแล้วกดใหม่) → คืนตั๋วเดิม
  select * into k from pos.kitchen_tickets where id = p_ticket_id;
  if found then
    if k.order_id <> p_order_id then raise exception 'POS:BAD_INPUT'; end if;
    return k;
  end if;

  insert into pos.kitchen_tickets (id, order_id, branch_id, created_by, round_no, printed_at)
  values (p_ticket_id, o.id, o.branch_id, p_actor,
          (select coalesce(max(round_no), 0) + 1 from pos.kitchen_tickets where order_id = o.id), now())
  returning * into k;

  for e in select * from jsonb_array_elements(p_items) loop
    insert into pos.order_items (order_id, ticket_id, menu_id, menu_name, quantity, unit_price, note)
    values (o.id, k.id, (e ->> 'menu_id')::uuid, e ->> 'menu_name', (e ->> 'quantity')::int, (e ->> 'unit_price')::numeric,
            nullif(trim(both from coalesce(e ->> 'note', '')), ''))
    returning id into v_item;

    insert into pos.order_item_options (order_item_id, option_id, option_name, extra_price)
    select v_item, (x ->> 'option_id')::uuid, x ->> 'option_name', coalesce((x ->> 'extra_price')::numeric, 0)
      from jsonb_array_elements(coalesce(e -> 'options', '[]'::jsonb)) x;
  end loop;
  return k;
end $function$;

-- ย้ายโต๊ะ (1.11) · ปลายทางต้องว่าง ออร์เดอร์ทั้งหมดย้ายตาม (อยู่บิลเดิม)
create or replace function pos.move_table(p_order_id uuid, p_from_table uuid, p_to_table uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
  t pos.dining_tables;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status not in ('open', 'waiting_payment') then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  select * into t from pos.dining_tables where id = p_to_table for update;
  if t.id is null or t.branch_id <> o.branch_id or not t.is_active then raise exception 'POS:TABLE_NOT_FOUND'; end if;
  if t.status <> 'available' then raise exception 'POS:TABLE_NOT_AVAILABLE'; end if;

  update pos.order_tables set left_at = now() where order_id = o.id and table_id = p_from_table and left_at is null;
  if not found then raise exception 'POS:TABLE_NOT_IN_ORDER'; end if;
  insert into pos.order_tables (order_id, table_id) values (o.id, p_to_table);
  return o;
end $function$;

-- รวมโต๊ะเป็นบิลเดียว (1.12) · โต๊ะว่าง = เพิ่มเข้าบิล · โต๊ะที่มีบิลอื่น = ย้ายโต๊ะ ตั๋ว และรายการ เข้าบิลหลัก
-- บิลเดิมเปลี่ยนเป็น merged · นับเวลาเปิดจากบิลที่เปิดก่อน · จำนวนลูกค้ารวมกัน
create or replace function pos.merge_tables(p_order_id uuid, p_table_ids uuid[])
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
  src pos.orders;
  t pos.dining_tables;
  v_src uuid;
  v_round int;
  v_tables uuid[];
  k record;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;

  for t in select * from pos.dining_tables where id = any (p_table_ids) order by id for update loop
    if t.branch_id <> o.branch_id or not t.is_active then raise exception 'POS:TABLE_NOT_FOUND'; end if;
    select order_id into v_src from pos.order_tables where table_id = t.id and left_at is null;
    if v_src = o.id then continue; end if;

    if v_src is null then
      insert into pos.order_tables (order_id, table_id) values (o.id, t.id);
      continue;
    end if;

    select * into src from pos.orders where id = v_src for update;
    if src.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
    -- คำขอเป็น log ห้ามแก้ (1.31) ย้ายไปบิลใหม่ไม่ได้ → บิลที่มีคำขอส่วนลดค้างหรืออนุมัติแล้ว ห้ามรวม
    if exists (select 1 from pos.approvals where order_id = src.id and status <> 'rejected') then
      raise exception 'POS:MERGE_HAS_APPROVAL';
    end if;

    -- ย้ายตั๋วต่อท้ายรอบของบิลหลัก (order_items ตามไปด้วย foreign key on update cascade)
    select coalesce(max(round_no), 0) into v_round from pos.kitchen_tickets where order_id = o.id;
    for k in select id from pos.kitchen_tickets where order_id = src.id order by round_no loop
      v_round := v_round + 1;
      update pos.kitchen_tickets set order_id = o.id, round_no = v_round where id = k.id;
    end loop;

    -- ย้ายทุกโต๊ะของบิลเดิมเข้าบิลหลัก
    v_tables := array(select table_id from pos.order_tables where order_id = src.id and left_at is null);
    update pos.order_tables set left_at = now() where order_id = src.id and left_at is null;
    insert into pos.order_tables (order_id, table_id) select o.id, unnest(v_tables);

    update pos.orders
       set guest_count = guest_count + src.guest_count,
           opened_at = least(opened_at, src.opened_at)
     where id = o.id;
    update pos.orders set status = 'merged', merged_into = o.id where id = src.id;
  end loop;

  return pos.recalc_order_totals(o.id);
end $function$;

-- เรียกเก็บเงิน → รอชำระ (1.8, 1.24) · ต้องมีรายการอย่างน้อย 1
create or replace function pos.request_payment(p_order_id uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status = 'waiting_payment' then return o; end if;
  if o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  if not exists (select 1 from pos.order_items where order_id = o.id) then raise exception 'POS:ORDER_EMPTY'; end if;
  perform pos.recalc_order_totals(o.id);
  update pos.orders set status = 'waiting_payment' where id = o.id returning * into o;
  return o;
end $function$;

-- ยกเลิกบิลที่เปิดผิด (ยังไม่สั่งอะไร) → คืนโต๊ะ
create or replace function pos.cancel_order(p_order_id uuid, p_actor uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  if exists (select 1 from pos.kitchen_tickets where order_id = o.id) then raise exception 'POS:ORDER_HAS_ITEMS'; end if;
  update pos.orders set status = 'cancelled', closed_by = p_actor where id = o.id returning * into o;
  return o;
end $function$;

-- payment แจ้งว่ารับเงินแล้ว (1.25, 1.26) · เรียกซ้ำด้วย payment เดิมได้ · ยอดต้องตรง total
create or replace function pos.mark_paid(p_order_id uuid, p_payment_id uuid, p_method pos.payment_method, p_amount numeric, p_paid_by uuid, p_paid_at timestamptz default now())
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status in ('paid', 'refunded') then
    if o.payment_id = p_payment_id then return o; end if;
    raise exception 'POS:ORDER_ALREADY_PAID';
  end if;
  if o.status <> 'waiting_payment' then raise exception 'POS:ORDER_NOT_WAITING_PAYMENT'; end if;
  if round(p_amount, 2) <> o.total then raise exception 'POS:AMOUNT_MISMATCH'; end if;

  update pos.orders
     set status = 'paid', payment_id = p_payment_id, payment_method = p_method, closed_by = p_paid_by, closed_at = coalesce(p_paid_at, now())
   where id = o.id
  returning * into o;
  return o;
end $function$;

-- คำขอส่วนลด/คืนเงิน (1.27, 1.28) · คำนวณยอดเงินในฐานข้อมูล
-- p_refund_items = [{ order_item_id, quantity }] (null = คืนทั้งบิลที่เหลือ)
-- ยอดคืนบางรายการ = ราคารายการ × (total ÷ subtotal) ของบิล (รวม VAT และส่วนลดตามสัดส่วน) ไม่เกินยอดที่ยังไม่คืน
create or replace function pos.create_approval(p_order_id uuid, p_actor uuid, p_type pos.approval_type, p_value_type pos.approval_value_type, p_value numeric, p_reason text, p_refund_items jsonb default null::jsonb)
 returns pos.approvals
 language plpgsql
as $function$
declare
  o pos.orders;
  a pos.approvals;
  v_amount numeric(12, 2);
  v_ratio numeric;
  v_remaining numeric(12, 2);
  e jsonb;
  it pos.order_items;
  v_unit numeric;
  v_qty int;
  v_done int;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if p_value is null or p_value <= 0 then raise exception 'POS:BAD_INPUT'; end if;

  if p_type = 'discount' then
    if o.status not in ('open', 'waiting_payment') then raise exception 'POS:ORDER_ALREADY_PAID'; end if;
    v_amount := case p_value_type when 'percent' then round(o.subtotal * p_value / 100, 2) else p_value end;
    if v_amount > o.subtotal - o.discount_amount then raise exception 'POS:DISCOUNT_TOO_LARGE'; end if;
  else
    if o.status not in ('paid', 'refunded') then raise exception 'POS:ORDER_NOT_PAID'; end if;
    if p_value_type <> 'amount' then raise exception 'POS:BAD_INPUT'; end if;
    -- ยอดที่ยังคืนได้ = จ่าย − คืนแล้ว − คำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้คืน
    v_remaining := o.total - o.refunded_amount
      - coalesce((select sum(amount) from pos.approvals where order_id = o.id and type = 'refund' and status = 'approved' and refunded_at is null), 0);
    if p_refund_items is null or jsonb_array_length(p_refund_items) = 0 then
      v_amount := v_remaining;
    else
      v_ratio := case when o.subtotal > 0 then o.total / o.subtotal else 1 end;
      v_amount := 0;
      for e in select * from jsonb_array_elements(p_refund_items) loop
        select * into it from pos.order_items where id = (e ->> 'order_item_id')::uuid and order_id = o.id;
        if not found then raise exception 'POS:ITEM_NOT_IN_ORDER'; end if;
        v_qty := (e ->> 'quantity')::int;
        select coalesce(sum(ri.quantity), 0) into v_done
          from pos.refund_items ri join pos.approvals ap on ap.id = ri.approval_id
         where ri.order_item_id = it.id and ap.status <> 'rejected';
        if v_qty < 1 or v_done + v_qty > it.quantity then raise exception 'POS:REFUND_QTY_EXCEEDED'; end if;
        select it.unit_price + coalesce(sum(extra_price), 0) into v_unit from pos.order_item_options where order_item_id = it.id;
        v_amount := v_amount + v_unit * v_qty;
      end loop;
      v_amount := round(v_amount * v_ratio, 2);
    end if;
    v_amount := least(v_amount, v_remaining);
    if v_amount <= 0 then raise exception 'POS:NOTHING_TO_REFUND'; end if;
  end if;

  begin
    insert into pos.approvals (order_id, branch_id, requested_by, type, value_type, value, amount, reason)
    values (o.id, o.branch_id, p_actor, p_type, p_value_type, case when p_type = 'refund' then v_amount else p_value end, v_amount, trim(both from p_reason))
    returning * into a;
  exception when unique_violation then
    raise exception 'POS:APPROVAL_PENDING_EXISTS';
  end;

  if p_type = 'refund' and p_refund_items is not null and jsonb_array_length(p_refund_items) > 0 then
    insert into pos.refund_items (approval_id, order_item_id, quantity, amount)
    select a.id, oi.id, (x ->> 'quantity')::int,
           round((oi.unit_price + coalesce((select sum(extra_price) from pos.order_item_options where order_item_id = oi.id), 0))
                 * (x ->> 'quantity')::int * case when o.subtotal > 0 then o.total / o.subtotal else 1 end, 2)
      from jsonb_array_elements(p_refund_items) x
      join pos.order_items oi on oi.id = (x ->> 'order_item_id')::uuid;
  end if;
  return a;
end $function$;

-- อนุมัติ/ปฏิเสธ (1.29, 1.31) · ส่วนลดที่อนุมัติ → trigger คำนวณยอดบิลใหม่ (1.30)
create or replace function pos.decide_approval(p_approval_id uuid, p_status pos.approval_status, p_actor uuid, p_note text default null::text)
 returns pos.approvals
 language plpgsql
as $function$
declare
  a pos.approvals;
  o pos.orders;
begin
  if p_status = 'pending' then raise exception 'POS:BAD_INPUT'; end if;
  select * into a from pos.approvals where id = p_approval_id for update;
  if not found then raise exception 'POS:APPROVAL_NOT_FOUND'; end if;
  if a.status <> 'pending' then raise exception 'POS:APPROVAL_DECIDED'; end if;

  select * into o from pos.orders where id = a.order_id for update;
  if p_status = 'approved' and a.type = 'discount' then
    if o.status not in ('open', 'waiting_payment') then raise exception 'POS:ORDER_ALREADY_PAID'; end if;
    if o.discount_amount + a.amount > o.subtotal then raise exception 'POS:DISCOUNT_TOO_LARGE'; end if;
  end if;

  update pos.approvals
     set status = p_status, approved_by = p_actor, decided_at = now(), note = nullif(trim(both from coalesce(p_note, '')), '')
   where id = a.id
  returning * into a;
  return a;
end $function$;

-- payment แจ้งว่าคืนเงินแล้ว · เรียกซ้ำด้วย payment เดิมได้ · บิล paid → refunded
create or replace function pos.mark_refunded(p_order_id uuid, p_approval_id uuid, p_payment_id uuid, p_amount numeric, p_refunded_at timestamptz default now())
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
  a pos.approvals;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  select * into a from pos.approvals where id = p_approval_id for update;
  if a.id is null or a.order_id <> o.id or a.type <> 'refund' or a.status <> 'approved' then raise exception 'POS:APPROVAL_NOT_FOUND'; end if;
  if a.refunded_at is not null then
    if a.refund_payment_id = p_payment_id then return o; end if;
    raise exception 'POS:APPROVAL_ALREADY_REFUNDED';
  end if;
  if round(p_amount, 2) <> a.amount then raise exception 'POS:AMOUNT_MISMATCH'; end if;

  update pos.approvals set refunded_at = coalesce(p_refunded_at, now()), refund_payment_id = p_payment_id where id = a.id;
  update pos.orders
     set refunded_amount = refunded_amount + a.amount,
         status = 'refunded'
   where id = o.id
  returning * into o;
  return o;
end $function$;

-- เมนูขายดี (1.35) สำหรับรายงานของ payment · นับบิลที่ปิดแล้ว (จ่าย/คืนเงิน) ตามวันที่ปิดบิล เวลาไทย
create or replace function pos.top_menus(p_from date, p_to date, p_branch uuid default null::uuid, p_limit integer default 5)
 returns table (menu_id uuid, menu_name text, quantity bigint, amount numeric)
 language sql
 stable
as $function$
  select oi.menu_id,
         (array_agg(oi.menu_name order by oi.created_at desc))[1] as menu_name,
         sum(oi.quantity) as quantity,
         round(sum(oi.quantity * (oi.unit_price + coalesce(x.extra, 0))), 2) as amount
    from pos.order_items oi
    join pos.orders o on o.id = oi.order_id
    left join lateral (select sum(extra_price) as extra from pos.order_item_options where order_item_id = oi.id) x on true
   where o.status in ('paid', 'refunded')
     and (o.closed_at at time zone 'Asia/Bangkok')::date between p_from and p_to
     and (p_branch is null or o.branch_id = p_branch)
   group by oi.menu_id
   order by sum(oi.quantity) desc, 4 desc
   limit greatest(1, least(p_limit, 50));
$function$;

-- ===================== สิทธิ์ =====================
alter table pos.dining_tables enable row level security;
alter table pos.orders enable row level security;
alter table pos.order_tables enable row level security;
alter table pos.kitchen_tickets enable row level security;
alter table pos.order_items enable row level security;
alter table pos.order_item_options enable row level security;
alter table pos.approvals enable row level security;
alter table pos.refund_items enable row level security;

revoke all on schema pos from public, anon, authenticated;
grant usage on schema pos to service_role, authenticated;

revoke all on all tables in schema pos from public, anon, authenticated;
grant all on all tables in schema pos to service_role;
grant usage, select on all sequences in schema pos to service_role;
alter default privileges in schema pos grant all on tables to service_role;

revoke all on all functions in schema pos from public, anon, authenticated;
grant execute on all functions in schema pos to service_role;

-- Realtime (1.29, จอครัว): client อ่านได้แค่ 2 ตาราง ตาม claim ใน JWT ที่ custom access token hook ของ Dev 1 ใส่ให้
-- ใช้เป็นสัญญาณเท่านั้น รายละเอียดดึงผ่าน gateway
create or replace function pos.jwt_role()
 returns text
 language sql
 stable
as $function$
  select coalesce(auth.jwt() ->> 'user_role', '');
$function$;

create or replace function pos.jwt_branch_id()
 returns uuid
 language sql
 stable
as $function$
  select nullif(auth.jwt() ->> 'branch_id', '')::uuid;
$function$;

grant execute on function pos.jwt_role(), pos.jwt_branch_id() to authenticated;
grant select on pos.kitchen_tickets, pos.approvals to authenticated;

drop policy if exists kitchen_tickets_select_branch on pos.kitchen_tickets;
create policy kitchen_tickets_select_branch on pos.kitchen_tickets for select to authenticated
  using ((pos.jwt_role() in ('staff', 'manager') and branch_id = pos.jwt_branch_id()) or pos.jwt_role() = 'owner');

-- manager: คำขอของสาขาตัวเอง · owner: ทุกสาขา · staff: เฉพาะคำขอของตัวเอง (1.29)
drop policy if exists approvals_select on pos.approvals;
create policy approvals_select on pos.approvals for select to authenticated
  using (
    (pos.jwt_role() = 'manager' and branch_id = pos.jwt_branch_id())
    or pos.jwt_role() = 'owner'
    or (pos.jwt_role() = 'staff' and requested_by = auth.uid())
  );

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'pos' and tablename = 'kitchen_tickets') then
      alter publication supabase_realtime add table pos.kitchen_tickets;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'pos' and tablename = 'approvals') then
      alter publication supabase_realtime add table pos.approvals;
    end if;
  end if;
end $$;

-- ให้ Data API เห็นโครงสร้างใหม่ทันที
notify pgrst, 'reload schema';
