-- =====================================================================
-- identity — RLS + สิทธิ์ (Dev 1)
--  - client ไม่อ่านตาราง identity ตรง ๆ ทุกอย่างผ่าน gateway → identity service (service_role)
--  - เปิด RLS ทุกตารางและไม่ให้ policy กับ anon/authenticated = มองไม่เห็น
--  - supabase_auth_admin อ่านได้ (สำหรับ custom access token hook)
--
-- อย่าลืม: Supabase Dashboard → Project Settings → API → Exposed schemas เพิ่ม `identity1`
-- (supabase-js ใช้ db.schema('identity1') ผ่าน PostgREST)
-- =====================================================================

alter table identity1.branches enable row level security;
alter table identity1.roles    enable row level security;
alter table identity1.profiles enable row level security;

-- service identity
grant usage on schema identity1 to service_role;
grant all on all tables    in schema identity1 to service_role;
grant all on all sequences in schema identity1 to service_role;
grant execute on all functions in schema identity1 to service_role;

-- client ห้ามแตะ
revoke all on all tables in schema identity1 from anon, authenticated;

-- Supabase Auth (hook) อ่าน profile/role/สาขาได้ แม้เปิด RLS
create policy profiles_auth_admin_read on identity1.profiles
  for select to supabase_auth_admin using (true);
create policy roles_auth_admin_read on identity1.roles
  for select to supabase_auth_admin using (true);
create policy branches_auth_admin_read on identity1.branches
  for select to supabase_auth_admin using (true);
