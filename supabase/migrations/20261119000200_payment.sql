-- payment: รับเงิน คืนเงิน รายจ่าย รายงาน (Dev 2)
-- สร้างจากโครงสร้างจริงของฐานข้อมูล · รันซ้ำได้
-- branch_id, order_id, approval_id อ้างถึง service อื่น จึงไม่มี foreign key ข้าม schema
-- เปิด RLS โดยไม่มี policy → เข้าถึงได้เฉพาะ service_role ผ่าน payment service

create schema if not exists payment;

do $$ begin
  create type payment.expense_category as enum ('labor', 'rent_utilities', 'ingredients', 'other');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment.payment_method as enum ('cash', 'promptpay');
exception when duplicate_object then null; end $$;

do $$ begin
  create type payment.payment_type as enum ('charge', 'refund');
exception when duplicate_object then null; end $$;

-- ===================== ตาราง =====================
create table if not exists payment.payments (
  id uuid not null default gen_random_uuid(),
  order_id uuid not null,
  branch_id uuid not null,
  type payment.payment_type not null,
  approval_id uuid,
  method payment.payment_method not null,
  amount numeric(12, 2) not null,
  cash_received numeric(12, 2),
  change_amount numeric(12, 2),
  received_by uuid not null,
  idempotency_key text,
  pos_synced_at timestamptz,
  paid_at timestamptz not null default now(),
  constraint payments_pkey primary key (id),
  constraint payments_amount_check check (amount >= 0::numeric),
  constraint payments_cash_received_check check (cash_received >= 0::numeric),
  constraint payments_change_amount_check check (change_amount >= 0::numeric),
  constraint payments_cash_fields check (
    method = 'cash'::payment.payment_method and type = 'charge'::payment.payment_type
      and cash_received is not null and change_amount is not null and cash_received = (amount + change_amount)
    or (method = 'promptpay'::payment.payment_method or type = 'refund'::payment.payment_type)
      and cash_received is null and change_amount is null
  ),
  constraint payments_refund_needs_approval check (
    type = 'refund'::payment.payment_type and approval_id is not null
    or type = 'charge'::payment.payment_type and approval_id is null
  )
);

create table if not exists payment.expenses (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  category payment.expense_category not null,
  amount numeric(12, 2) not null,
  expense_date date not null default ((now() at time zone 'Asia/Bangkok'::text))::date,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint expenses_pkey primary key (id),
  constraint expenses_amount_check check (amount > 0::numeric),
  constraint expenses_note_check check (char_length(note) <= 500)
);

-- ===================== index =====================
create index if not exists payments_branch_paid_idx on payment.payments using btree (branch_id, paid_at desc);
create unique index if not exists payments_idempotency_key_uk on payment.payments using btree (idempotency_key) where (idempotency_key is not null);
-- 1 บิลรับเงินได้ครั้งเดียว · 1 คำขอคืนเงินได้ครั้งเดียว
create unique index if not exists payments_one_charge_per_order_uk on payment.payments using btree (order_id) where (type = 'charge'::payment.payment_type);
create unique index if not exists payments_one_refund_per_approval_uk on payment.payments using btree (approval_id) where (type = 'refund'::payment.payment_type);
create index if not exists payments_paid_idx on payment.payments using btree (paid_at desc);
create index if not exists payments_unsynced_idx on payment.payments using btree (paid_at) where (pos_synced_at is null);
create index if not exists expenses_branch_date_idx on payment.expenses using btree (branch_id, expense_date desc);

-- ===================== รายงาน (นับวันและเดือนตามเวลาไทย) =====================
create or replace function payment.report_sales(p_from date, p_to date, p_branch uuid default null::uuid)
 returns table(branch_id uuid, sales numeric, refunds numeric, bill_count bigint)
 language sql
 stable
as $function$
  select p.branch_id,
         coalesce(sum(p.amount) filter (where p.type = 'charge'), 0),
         coalesce(sum(p.amount) filter (where p.type = 'refund'), 0),
         count(*) filter (where p.type = 'charge')
    from payment.payments p
   where p.paid_at >= (p_from::timestamp at time zone 'Asia/Bangkok')
     and p.paid_at <  ((p_to + 1)::timestamp at time zone 'Asia/Bangkok')
     and (p_branch is null or p.branch_id = p_branch)
   group by p.branch_id
$function$;

create or replace function payment.report_expenses(p_from date, p_to date, p_branch uuid default null::uuid)
 returns table(branch_id uuid, category payment.expense_category, amount numeric)
 language sql
 stable
as $function$
  select e.branch_id, e.category, sum(e.amount)
    from payment.expenses e
   where e.expense_date between p_from and p_to
     and (p_branch is null or e.branch_id = p_branch)
   group by e.branch_id, e.category
$function$;

create or replace function payment.report_monthly_sales(p_year integer, p_branch uuid default null::uuid)
 returns table(branch_id uuid, month integer, sales numeric, refunds numeric, bill_count bigint)
 language sql
 stable
as $function$
  select p.branch_id,
         extract(month from (p.paid_at at time zone 'Asia/Bangkok'))::int,
         coalesce(sum(p.amount) filter (where p.type = 'charge'), 0),
         coalesce(sum(p.amount) filter (where p.type = 'refund'), 0),
         count(*) filter (where p.type = 'charge')
    from payment.payments p
   where p.paid_at >= (make_date(p_year, 1, 1)::timestamp at time zone 'Asia/Bangkok')
     and p.paid_at <  (make_date(p_year + 1, 1, 1)::timestamp at time zone 'Asia/Bangkok')
     and (p_branch is null or p.branch_id = p_branch)
   group by 1, 2
$function$;

create or replace function payment.report_monthly_expenses(p_year integer, p_branch uuid default null::uuid)
 returns table(branch_id uuid, month integer, category payment.expense_category, amount numeric)
 language sql
 stable
as $function$
  select e.branch_id, extract(month from e.expense_date)::int, e.category, sum(e.amount)
    from payment.expenses e
   where e.expense_date >= make_date(p_year, 1, 1)
     and e.expense_date <  make_date(p_year + 1, 1, 1)
     and (p_branch is null or e.branch_id = p_branch)
   group by 1, 2, 3
$function$;

-- ===================== สิทธิ์ =====================
alter table payment.payments enable row level security;
alter table payment.expenses enable row level security;

revoke all on schema payment from public, anon, authenticated;
grant usage on schema payment to service_role;

revoke all on all tables in schema payment from public, anon, authenticated;
grant all on all tables in schema payment to service_role;
alter default privileges in schema payment grant all on tables to service_role;

revoke all on all functions in schema payment from public, anon, authenticated;
grant execute on all functions in schema payment to service_role;

-- ให้ Data API เห็นโครงสร้างใหม่ทันที
notify pgrst, 'reload schema';
