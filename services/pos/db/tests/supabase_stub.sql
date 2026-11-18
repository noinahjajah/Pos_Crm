-- จำลองสิ่งที่ Supabase มีให้ เพื่อรัน migration บน Postgres เปล่า (ใช้ทดสอบ local เท่านั้น)
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;

create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
$$;

create function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

grant usage on schema auth to authenticated, service_role;

create publication supabase_realtime;
