-- membership: สมาชิกลูกค้า ระดับ แต้ม และการมาใช้บริการ (ตาม ERD ของทีม)
-- รันใน SQL Editor แล้วเพิ่ม membership ใน Project Settings → Data API → Exposed schemas

create schema if not exists membership;

do $$ begin
  create type membership.point_type as enum ('earn', 'redeem', 'adjust', 'expire');
exception when duplicate_object then null; end $$;

-- ระดับสมาชิก: ขึ้นระดับตามแต้มที่ได้สะสมทั้งหมด (ไม่ลดเมื่อแลกแต้ม)
create table if not exists membership.membership_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  min_points int not null default 0 check (min_points >= 0),
  point_rate numeric(6, 4) not null default 0.04 check (point_rate >= 0), -- แต้มต่อ 1 บาท (0.04 = 25 บาทได้ 1 แต้ม)
  created_at timestamptz not null default now()
);

create table if not exists membership.customers (
  id uuid primary key default gen_random_uuid(),
  tier_id uuid references membership.membership_tiers (id),
  phone text not null unique check (phone ~ '^0[0-9]{8,9}$'),
  full_name text not null check (length(trim(full_name)) > 0),
  birth_date date,
  points_balance int not null default 0 check (points_balance >= 0),
  total_earned int not null default 0 check (total_earned >= 0),
  registered_branch_id uuid, -- ref identity.branches
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists membership.point_transactions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references membership.customers (id),
  order_id uuid, -- ref pos.orders
  branch_id uuid, -- ref identity.branches
  type membership.point_type not null,
  points int not null check (points <> 0),
  note text,
  created_by uuid, -- ref identity.profiles
  created_at timestamptz not null default now()
);

create table if not exists membership.visits (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references membership.customers (id),
  order_id uuid unique, -- ref pos.orders (1 บิลได้แต้มครั้งเดียว)
  branch_id uuid, -- ref identity.branches
  spent_amount numeric(12, 2) not null check (spent_amount >= 0),
  visited_at timestamptz not null default now()
);

create index if not exists customers_full_name_idx on membership.customers (full_name);
create index if not exists point_transactions_customer_idx on membership.point_transactions (customer_id, created_at desc);
create index if not exists visits_customer_idx on membership.visits (customer_id, visited_at desc);

-- ระดับเริ่มต้น
insert into membership.membership_tiers (name, min_points, point_rate) values
  ('Member', 0, 0.04),
  ('Silver', 500, 0.05),
  ('Gold', 2000, 0.06)
on conflict (name) do nothing;

-- เปลี่ยนแต้ม + บันทึกรายการ + ปรับระดับ ในครั้งเดียว (แต้มไม่พอ → MEMBERSHIP:NOT_ENOUGH_POINTS)
create or replace function membership.apply_points(
  p_customer uuid, p_points int, p_type membership.point_type,
  p_order uuid default null, p_branch uuid default null, p_note text default null, p_by uuid default null
) returns membership.customers
language plpgsql security definer set search_path = membership, pg_temp as $$
declare c membership.customers;
begin
  select * into c from customers where id = p_customer for update;
  if not found or not c.is_active then raise exception 'MEMBERSHIP:NOT_FOUND'; end if;
  if c.points_balance + p_points < 0 then raise exception 'MEMBERSHIP:NOT_ENOUGH_POINTS'; end if;

  insert into point_transactions (customer_id, order_id, branch_id, type, points, note, created_by)
  values (p_customer, p_order, p_branch, p_type, p_points, p_note, p_by);

  update customers set
    points_balance = points_balance + p_points,
    total_earned = total_earned + greatest(p_points, 0) * (p_type = 'earn')::int,
    tier_id = (select t.id from membership_tiers t
               where t.min_points <= c.total_earned + greatest(p_points, 0) * (p_type = 'earn')::int
               order by t.min_points desc limit 1)
  where id = p_customer
  returning * into c;
  return c;
end $$;

-- บันทึกการมาใช้บริการ + ได้แต้มตามอัตราของระดับ · บิลเดิมซ้ำ → ไม่ได้แต้มซ้ำ (คืนข้อมูลเดิม)
create or replace function membership.record_visit(
  p_customer uuid, p_amount numeric, p_order uuid default null, p_branch uuid default null, p_by uuid default null
) returns jsonb
language plpgsql security definer set search_path = membership, pg_temp as $$
declare v membership.visits; c membership.customers; earned int;
begin
  if p_order is not null then
    select * into v from visits where order_id = p_order;
    if found then
      select * into c from customers where id = v.customer_id;
      return jsonb_build_object('customer', to_jsonb(c), 'visit', to_jsonb(v), 'points_earned', 0, 'duplicate', true);
    end if;
  end if;

  select * into c from customers where id = p_customer and is_active;
  if not found then raise exception 'MEMBERSHIP:NOT_FOUND'; end if;

  insert into visits (customer_id, order_id, branch_id, spent_amount)
  values (p_customer, p_order, p_branch, p_amount) returning * into v;

  earned := floor(p_amount * coalesce((select point_rate from membership_tiers where id = c.tier_id), 0));
  if earned > 0 then
    c := apply_points(p_customer, earned, 'earn', p_order, p_branch, 'ซื้อ ' || p_amount || ' บาท', p_by);
  end if;
  return jsonb_build_object('customer', to_jsonb(c), 'visit', to_jsonb(v), 'points_earned', earned, 'duplicate', false);
end $$;

-- ลูกค้าใหม่เริ่มที่ระดับต่ำสุด
create or replace function membership.default_tier() returns trigger
language plpgsql set search_path = membership, pg_temp as $$
begin
  if new.tier_id is null then
    select id into new.tier_id from membership_tiers order by min_points limit 1;
  end if;
  return new;
end $$;

drop trigger if exists customers_default_tier on membership.customers;
create trigger customers_default_tier before insert on membership.customers
  for each row execute function membership.default_tier();

-- สิทธิ์: เฉพาะ service (service_role) เท่านั้น
alter table membership.membership_tiers enable row level security;
alter table membership.customers enable row level security;
alter table membership.point_transactions enable row level security;
alter table membership.visits enable row level security;

revoke all on schema membership from anon, authenticated;
grant usage on schema membership to service_role;
grant all on all tables in schema membership to service_role;
grant execute on all functions in schema membership to service_role;
revoke execute on all functions in schema membership from anon, authenticated, public;
alter default privileges in schema membership grant all on tables to service_role;
