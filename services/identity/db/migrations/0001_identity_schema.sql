-- =====================================================================
-- identity service (Dev 1) — schema `identity1`
-- ตาราง: branches, roles, profiles (3 ตาราง)
-- อ้างอิง: เอกสาร/pos-crm-phase1-spec.md ข้อ 3 (ERD identity) และ 1.1–1.6
--
-- กติกา:
--  - auth.users เป็นของ Supabase Auth (ไม่เก็บ password_hash เอง)
--    login ด้วย username → service แปลงเป็นอีเมล `<username>@pos.local`
--  - profiles.id = auth.users.id (1 บัญชี login = 1 profile)
--  - service อื่นเก็บแค่ uuid ของ branches/profiles ไม่ผูก FK ข้าม schema
--  - ลบผู้ใช้/สาขาแบบ soft delete (is_active = false) เพื่อให้ id ที่ service อื่นอ้างยังอยู่
--  - service identity ต่อ DB ด้วย service_role (bypass RLS)
-- =====================================================================

create schema if not exists identity1;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type identity1.branch_type as enum ('restaurant', 'drinks', 'bar');

-- ---------------------------------------------------------------------
-- branches — สาขา (1.6 owner เพิ่ม/แก้/ลบ)
-- ---------------------------------------------------------------------
create table identity1.branches (
  id           uuid primary key default gen_random_uuid(),
  code         text not null unique check (code ~ '^[A-Z0-9_-]{2,20}$'),   -- เช่น BAR01
  name         text not null check (length(trim(name)) between 1 and 100),
  branch_type  identity1.branch_type not null,
  address      text,
  phone        text,
  is_active    boolean not null default true,     -- false = ปิดหรือลบสาขา (soft delete)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- roles — 3 role คงที่ (1.1) · staff = waiter + cashier รวมกัน · ไม่มี role kitchen
-- ---------------------------------------------------------------------
create table identity1.roles (
  id    smallint primary key,
  name  text not null unique check (name in ('staff', 'manager', 'owner'))
);

insert into identity1.roles (id, name) values
  (1, 'staff'),
  (2, 'manager'),
  (3, 'owner');

-- ---------------------------------------------------------------------
-- profiles — ข้อมูลพนักงาน ผูกกับบัญชี login
-- ---------------------------------------------------------------------
create table identity1.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  branch_id   uuid references identity1.branches (id),        -- null = owner (เห็นทุกสาขา 1.4)
  role_id     smallint not null references identity1.roles (id),
  username    text not null unique check (username ~ '^[a-z0-9._-]{3,30}$'),
  full_name   text not null check (length(trim(full_name)) between 1 and 100),
  is_active   boolean not null default true,   -- false = ลบหรือปิดบัญชี (soft delete)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- owner ไม่มีสาขาประจำ · staff/manager ต้องมีสาขา (1.3, 1.4)
  constraint profiles_branch_by_role check (
    (role_id = 3 and branch_id is null) or (role_id <> 3 and branch_id is not null)
  )
);

create index profiles_branch_idx on identity1.profiles (branch_id) where is_active;
create index profiles_role_idx   on identity1.profiles (role_id);

-- ---------------------------------------------------------------------
-- updated_at อัตโนมัติ
-- ---------------------------------------------------------------------
create or replace function identity1.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger branches_set_updated_at
before update on identity1.branches
for each row execute function identity1.set_updated_at();

create trigger profiles_set_updated_at
before update on identity1.profiles
for each row execute function identity1.set_updated_at();

-- ---------------------------------------------------------------------
-- view สำหรับ API (ใช้ชื่อ role แทน role_id) — GET /me, GET /users
-- ---------------------------------------------------------------------
create view identity1.profiles_view
with (security_invoker = true)
as
select
  p.id,
  p.username,
  p.full_name,
  r.name        as role,
  p.branch_id,
  b.name        as branch_name,
  p.is_active,
  p.created_at,
  p.updated_at
from identity1.profiles p
join identity1.roles r on r.id = p.role_id
left join identity1.branches b on b.id = p.branch_id;
