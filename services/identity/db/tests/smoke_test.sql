-- ทดสอบ schema identity บน Postgres เปล่า (รันหลัง supabase_stub.sql + migrations + seed.sql)
-- ผ่านทั้งหมดจะพิมพ์ 'identity smoke test: OK'
\set ON_ERROR_STOP on

-- บัญชีทดสอบ แล้วรัน seed อีกรอบให้สร้าง profile
insert into auth.users (email) values ('owner@pos.local'), ('manager.r01@pos.local'), ('staff.r01@pos.local');
\ir ../seed.sql

do $$
declare
  v_owner   uuid;
  v_staff   uuid;
  v_r01     uuid;
  v_result  jsonb;
  v_count   int;
begin
  select id into v_owner from identity1.profiles where username = 'owner';
  select id into v_staff from identity1.profiles where username = 'staff.r01';
  select id into v_r01   from identity1.branches where code = 'R01';

  -- seed
  select count(*) into v_count from identity1.branches;
  assert v_count = 3, 'ต้องมี 3 สาขา';
  select count(*) into v_count from identity1.profiles;
  assert v_count = 3, 'ต้องมี 3 profile';
  select count(*) into v_count from identity1.roles;
  assert v_count = 3, 'ต้องมี 3 role';

  -- view
  assert (select role from identity1.profiles_view where id = v_staff) = 'staff', 'view ต้องคืนชื่อ role';
  assert (select branch_name from identity1.profiles_view where id = v_staff) is not null, 'view ต้องคืนชื่อสาขา';

  -- hook: staff ได้ user_role + branch_id
  v_result := identity1.custom_access_token_hook(
    jsonb_build_object('user_id', v_staff, 'claims', jsonb_build_object('sub', v_staff, 'role', 'authenticated')));
  assert v_result -> 'claims' ->> 'user_role' = 'staff', 'hook ต้องใส่ user_role';
  assert (v_result -> 'claims' ->> 'branch_id')::uuid = v_r01, 'hook ต้องใส่ branch_id';
  assert v_result -> 'claims' ->> 'role' = 'authenticated', 'hook ต้องไม่ลบ claim เดิม';

  -- hook: owner branch_id = null
  v_result := identity1.custom_access_token_hook(
    jsonb_build_object('user_id', v_owner, 'claims', '{}'::jsonb));
  assert v_result -> 'claims' ->> 'user_role' = 'owner', 'owner role';
  assert v_result -> 'claims' -> 'branch_id' = 'null'::jsonb, 'owner ไม่มี branch_id';

  -- hook: สาขาถูกปิด → error
  update identity1.branches set is_active = false where id = v_r01;
  v_result := identity1.custom_access_token_hook(jsonb_build_object('user_id', v_staff, 'claims', '{}'::jsonb));
  assert v_result ? 'error', 'สาขาปิดต้องไม่ออก token';
  update identity1.branches set is_active = true where id = v_r01;

  -- hook: บัญชีถูกลบ → error
  update identity1.profiles set is_active = false where id = v_staff;
  v_result := identity1.custom_access_token_hook(jsonb_build_object('user_id', v_staff, 'claims', '{}'::jsonb));
  assert v_result ? 'error', 'บัญชีลบแล้วต้องไม่ออก token';
  assert (select updated_at > created_at from identity1.profiles where id = v_staff), 'updated_at ต้องเปลี่ยน';

  -- hook: ไม่มี profile → ออก token ได้ แต่ไม่มี user_role/branch_id (gateway ตอบ 403 ทุก route)
  --       แม้ claims ที่เข้ามาจะมี user_role ติดมา ก็ต้องถูกลบ
  v_result := identity1.custom_access_token_hook(jsonb_build_object(
    'user_id', gen_random_uuid(),
    'claims', jsonb_build_object('role', 'authenticated', 'user_role', 'owner', 'branch_id', v_r01,
                                 'user_metadata', jsonb_build_object('user_role', 'owner'))));
  assert not (v_result ? 'error'), 'ไม่มี profile ต้องยังออก token ได้ (ลูกค้าเฟส 2)';
  assert not (v_result -> 'claims' ? 'user_role'), 'ไม่มี profile ต้องไม่มี user_role';
  assert not (v_result -> 'claims' ? 'branch_id'), 'ไม่มี profile ต้องไม่มี branch_id';
  assert v_result -> 'claims' ->> 'role' = 'authenticated', 'claim อื่นต้องอยู่ครบ';

  -- hook: staff ที่มี claim ปลอมติดมา → ถูกแทนด้วยค่าจาก profiles
  update identity1.profiles set is_active = true where id = v_staff;
  v_result := identity1.custom_access_token_hook(jsonb_build_object(
    'user_id', v_staff, 'claims', jsonb_build_object('user_role', 'owner', 'branch_id', null)));
  assert v_result -> 'claims' ->> 'user_role' = 'staff', 'ต้องใช้ role จาก profiles';
  assert (v_result -> 'claims' ->> 'branch_id')::uuid = v_r01, 'ต้องใช้สาขาจาก profiles';

  -- constraint: staff ต้องมีสาขา
  begin
    update identity1.profiles set branch_id = null where id = v_staff;
    raise exception 'ควร fail: staff ไม่มีสาขา';
  exception when check_violation then null;
  end;

  -- constraint: owner ต้องไม่มีสาขา
  begin
    update identity1.profiles set branch_id = v_r01 where id = v_owner;
    raise exception 'ควร fail: owner มีสาขา';
  exception when check_violation then null;
  end;

  -- constraint: username / code รูปแบบผิด
  begin
    update identity1.profiles set username = 'Bad Name' where id = v_owner;
    raise exception 'ควร fail: username';
  exception when check_violation then null;
  end;
  begin
    insert into identity1.branches (code, name, branch_type) values ('bar 02', 'x', 'bar');
    raise exception 'ควร fail: code';
  exception when check_violation then null;
  end;

  raise notice 'identity smoke test: OK';
end;
$$;

-- RLS: authenticated มองไม่เห็นตาราง
set role authenticated;
do $$
begin
  perform 1 from identity1.profiles;
  raise exception 'authenticated ไม่ควรอ่าน profiles ได้';
exception when insufficient_privilege then
  raise notice 'RLS/grant: authenticated ถูกบล็อก OK';
end;
$$;
reset role;

-- supabase_auth_admin เรียก hook ได้
set role supabase_auth_admin;
select (identity1.custom_access_token_hook(
  jsonb_build_object('user_id', (select id from identity1.profiles where username = 'owner'), 'claims', '{}'::jsonb)
) -> 'claims' ->> 'user_role') = 'owner' as auth_admin_hook_ok;
reset role;
