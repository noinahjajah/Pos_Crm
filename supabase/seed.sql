-- ข้อมูลตั้งต้น: 3 สาขา (restaurant / drinks / bar)
-- ผู้ใช้ทดสอบ 3 role สร้างด้วยสคริปต์ services/identity/scripts/seed-users.mjs
-- (ต้องสร้างผ่าน Supabase Auth admin API จึงเขียนเป็น SQL ตรง ๆ ไม่ได้)

insert into identity.branches (id, code, name, branch_type, address, phone) values
  ('11111111-1111-4111-8111-111111111111', 'RES01', 'สาขาร้านอาหาร', 'restaurant', null, null),
  ('22222222-2222-4222-8222-222222222222', 'DRK01', 'สาขาเครื่องดื่ม', 'drinks',     null, null),
  ('33333333-3333-4333-8333-333333333333', 'BAR01', 'สาขาบาร์',       'bar',        null, null)
on conflict (id) do nothing;
