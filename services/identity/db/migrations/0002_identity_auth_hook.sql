-- =====================================================================
-- identity — Custom Access Token Hook (Dev 1)
-- ใส่ claim `user_role` และ `branch_id` ลง JWT ทุกครั้งที่ออก token (login / refresh)
--   - gateway อ่าน 2 claim นี้ทำ route guard + branch scope (ข้อ 2 ในสเปก)
--   - RLS ของ pos (จอครัว / แจ้งเตือนอนุมัติ) ใช้ claim เดียวกัน
-- แหล่งเดียวของ role = identity1.profiles (ไม่ใช้ user_metadata ที่ผู้ใช้แก้เองได้)
--
--   ไม่มี profile          → ออก token ได้ แต่ "ไม่มี" user_role / branch_id
--                            gateway ตอบ 403 ทุก route (เฟส 2: ลูกค้า login ได้ แต่เข้า POS ไม่ได้)
--   profile ถูกลบ / สาขาปิด → ไม่ออก token (login/refresh ไม่ผ่าน พร้อมข้อความ)
--   ลบ user_role / branch_id ที่ติดมาใน claims ทิ้งก่อนเสมอ แล้วค่อยใส่ค่าจาก profiles
--
-- หลังรัน migration ต้องเปิดใช้ที่ Supabase Dashboard:
--   Authentication → Hooks → Customize Access Token (JWT) Claims
--   → Postgres function: identity1.custom_access_token_hook
-- =====================================================================

create or replace function identity1.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
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
$$;

-- เฉพาะ Supabase Auth เรียก hook ได้
grant usage on schema identity1 to supabase_auth_admin;
grant execute on function identity1.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function identity1.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on identity1.profiles, identity1.roles, identity1.branches to supabase_auth_admin;
