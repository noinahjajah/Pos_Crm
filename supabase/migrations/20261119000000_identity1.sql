-- identity1: สาขา สิทธิ์ ผู้ใช้ และ auth hook (Dev 1)
-- สร้างจากโครงสร้างและข้อมูลตั้งต้นจริงของฐานข้อมูล · รันซ้ำได้
-- ไม่เก็บ profiles ไว้ที่นี่ เพราะเป็นข้อมูลบุคคลและผูกกับ auth.users ของแต่ละโปรเจกต์
-- หลังรันต้องเปิด Authentication → Hooks → Custom access token → identity1.custom_access_token_hook

create schema if not exists identity1;

do $$ begin
  create type identity1.branch_type as enum ('restaurant', 'drinks', 'bar');
exception when duplicate_object then null; end $$;

-- ===================== ตาราง =====================
create table if not exists identity1.branches (
  id uuid not null default gen_random_uuid(),
  code text not null,
  name text not null,
  branch_type identity1.branch_type not null,
  address text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branches_pkey primary key (id),
  constraint branches_code_key unique (code),
  constraint branches_code_check check (code ~ '^[A-Z0-9_-]{2,20}$'::text),
  constraint branches_name_check check (length(trim(both from name)) >= 1 and length(trim(both from name)) <= 100)
);

create table if not exists identity1.roles (
  id smallint not null,
  name text not null,
  constraint roles_pkey primary key (id),
  constraint roles_name_key unique (name),
  constraint roles_name_check check (name = any (array['staff'::text, 'manager'::text, 'owner'::text]))
);

create table if not exists identity1.profiles (
  id uuid not null,
  branch_id uuid,
  role_id smallint not null,
  username text not null,
  full_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_pkey primary key (id),
  constraint profiles_username_key unique (username),
  constraint profiles_id_fkey foreign key (id) references auth.users (id) on delete cascade,
  constraint profiles_branch_id_fkey foreign key (branch_id) references identity1.branches (id),
  constraint profiles_role_id_fkey foreign key (role_id) references identity1.roles (id),
  constraint profiles_username_check check (username ~ '^[a-z0-9._-]{3,30}$'::text),
  constraint profiles_full_name_check check (length(trim(both from full_name)) >= 1 and length(trim(both from full_name)) <= 100),
  -- owner ไม่มีสาขาประจำ · staff และ manager ต้องมีสาขา
  constraint profiles_branch_by_role check (role_id = 3 and branch_id is null or role_id <> 3 and branch_id is not null)
);

create index if not exists profiles_branch_idx on identity1.profiles using btree (branch_id) where is_active;
create index if not exists profiles_role_idx on identity1.profiles using btree (role_id);

create or replace view identity1.profiles_view with (security_invoker = true) as
 select p.id,
    p.username,
    p.full_name,
    r.name as role,
    p.branch_id,
    b.name as branch_name,
    p.is_active,
    p.created_at,
    p.updated_at
   from identity1.profiles p
     join identity1.roles r on r.id = p.role_id
     left join identity1.branches b on b.id = p.branch_id;

-- ===================== trigger =====================
create or replace function identity1.set_updated_at()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists branches_set_updated_at on identity1.branches;
create trigger branches_set_updated_at before update on identity1.branches
  for each row execute function identity1.set_updated_at();

drop trigger if exists profiles_set_updated_at on identity1.profiles;
create trigger profiles_set_updated_at before update on identity1.profiles
  for each row execute function identity1.set_updated_at();

-- ===================== auth hook =====================
-- ใส่ user_role และ branch_id ลง JWT จาก profiles เท่านั้น
create or replace function identity1.custom_access_token_hook(event jsonb)
 returns jsonb
 language plpgsql
 stable
as $function$
declare
  v_claims   jsonb;
  v_role     text;
  v_branch   uuid;
  v_active   boolean;
  v_branch_active boolean;
begin
  select r.name, p.branch_id, p.is_active, coalesce(b.is_active, true)
    into v_role, v_branch, v_active, v_branch_active
  from identity1.profiles p
  join identity1.roles r on r.id = p.role_id
  left join identity1.branches b on b.id = p.branch_id
  where p.id = (event ->> 'user_id')::uuid;

  -- ไม่เชื่อค่าที่ติดมา: ลบ claim สิทธิ์ทิ้งก่อน
  v_claims := coalesce(event -> 'claims', '{}'::jsonb) - 'user_role' - 'branch_id';

  -- ไม่มี profile พนักงาน → token ไม่มี role (gateway ปฏิเสธทุก route)
  if v_role is null then
    return jsonb_set(event, '{claims}', v_claims);
  end if;

  if not v_active then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'บัญชีนี้ถูกปิดใช้งานหรือไม่มีสิทธิ์เข้าระบบ')
    );
  end if;

  if not v_branch_active then
    return jsonb_build_object(
      'error', jsonb_build_object('http_code', 403, 'message', 'สาขาของบัญชีนี้ถูกปิดแล้ว')
    );
  end if;

  v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_role));
  v_claims := jsonb_set(v_claims, '{branch_id}', coalesce(to_jsonb(v_branch::text), 'null'::jsonb));

  return jsonb_set(event, '{claims}', v_claims);
end;
$function$;

-- ===================== สิทธิ์ =====================
-- service_role ใช้ผ่าน identity service · supabase_auth_admin อ่านได้เพื่อให้ hook ทำงาน
alter table identity1.branches enable row level security;
alter table identity1.roles enable row level security;
alter table identity1.profiles enable row level security;

drop policy if exists branches_auth_admin_read on identity1.branches;
create policy branches_auth_admin_read on identity1.branches for select to supabase_auth_admin using (true);
drop policy if exists roles_auth_admin_read on identity1.roles;
create policy roles_auth_admin_read on identity1.roles for select to supabase_auth_admin using (true);
drop policy if exists profiles_auth_admin_read on identity1.profiles;
create policy profiles_auth_admin_read on identity1.profiles for select to supabase_auth_admin using (true);

revoke all on schema identity1 from public, anon, authenticated;
grant usage on schema identity1 to supabase_auth_admin;
grant usage on schema identity1 to service_role;

revoke all on all tables in schema identity1 from public, anon, authenticated;
grant select on identity1.branches, identity1.roles, identity1.profiles to supabase_auth_admin;
grant all on identity1.branches, identity1.roles, identity1.profiles, identity1.profiles_view to service_role;

revoke all on function identity1.custom_access_token_hook(jsonb) from public, anon, authenticated;
grant execute on function identity1.custom_access_token_hook(jsonb) to supabase_auth_admin;
grant execute on function identity1.custom_access_token_hook(jsonb) to service_role;
revoke all on function identity1.set_updated_at() from anon, authenticated;
grant execute on function identity1.set_updated_at() to service_role;

-- ===================== ข้อมูลตั้งต้นจริง =====================
-- ใช้ id เดิมของสาขา เพื่อให้ข้อมูลใน catalog และ payment ยังอ้างถึงสาขาเดิมได้
insert into identity1.roles (id, name) values
  (1, 'staff'),
  (2, 'manager'),
  (3, 'owner')
on conflict do nothing;

insert into identity1.branches (id, code, name, branch_type) values
  ('c71cc7cf-cae7-4aa8-9236-54bc66da8734', 'R01', 'ร้านอาหาร สาขา 1', 'restaurant'),
  ('84566875-45c2-449b-b302-aa9cf6c21e93', 'D01', 'ร้านเครื่องดื่ม สาขา 1', 'drinks'),
  ('0f2bd3f7-01e7-4b5f-b290-bb2643b6ec63', 'B01', 'บาร์ สาขา 1', 'bar')
on conflict do nothing;

-- ให้ Data API เห็นโครงสร้างใหม่ทันที
notify pgrst, 'reload schema';
