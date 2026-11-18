-- จำลองสิ่งที่ Supabase มีให้ เพื่อรัน migration บน Postgres เปล่า (ใช้ทดสอบ local เท่านั้น)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create role supabase_auth_admin nologin;

create schema auth;
create table auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text unique
);
