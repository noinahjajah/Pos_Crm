-- ของจำลองที่ Supabase มีให้อยู่แล้ว ใช้ตอนทดสอบ migration กับ Postgres เปล่า (ห้ามรันบน Supabase จริง)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists auth;
-- claim ของผู้ใช้จำลองตั้งผ่าน set_config('test.claims', '{...}', true)
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('test.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to authenticated, service_role;
grant execute on all functions in schema auth to authenticated, service_role;

do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
