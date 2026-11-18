-- =====================================================================
-- identity — ข้อมูลตั้งต้นสำหรับ dev / ทดสอบ (Dev 1)
-- รันหลัง migration 0001–0003
--
-- ขั้นตอน:
--  1) รันไฟล์นี้ครั้งแรก → ได้ 3 สาขา
--  2) สร้างบัญชี login ใน Supabase Dashboard → Authentication → Users → Add user
--     (ติ๊ก Auto Confirm) ตามอีเมลด้านล่าง ตั้งรหัสผ่านเอง
--       owner@pos.local      → เจ้าของร้าน (ทุกสาขา)
--       manager.r01@pos.local → ผู้จัดการสาขา R01
--       staff.r01@pos.local   → พนักงานหน้าร้านสาขา R01
--  3) รันไฟล์นี้อีกครั้ง → สร้าง profile ให้บัญชีที่มีอยู่แล้ว (รันซ้ำได้ ไม่ซ้ำข้อมูล)
--  login ที่หน้าเว็บด้วย username = ส่วนหน้า @ เช่น owner, manager.r01, staff.r01
-- =====================================================================

insert into identity1.branches (code, name, branch_type, address, phone) values
  ('R01', 'ร้านอาหาร สาขา 1',   'restaurant', null, null),
  ('D01', 'ร้านเครื่องดื่ม สาขา 1', 'drinks',     null, null),
  ('B01', 'บาร์ สาขา 1',        'bar',        null, null)
on conflict (code) do nothing;

insert into identity1.profiles (id, branch_id, role_id, username, full_name)
select u.id, b.id, r.id, s.username, s.full_name
from (values
  ('owner@pos.local',       null,  'owner',   'owner',       'เจ้าของร้าน'),
  ('manager.r01@pos.local', 'R01', 'manager', 'manager.r01', 'ผู้จัดการ R01'),
  ('staff.r01@pos.local',   'R01', 'staff',   'staff.r01',   'พนักงาน R01')
) as s(email, branch_code, role_name, username, full_name)
join auth.users u      on lower(u.email) = s.email
join identity1.roles r  on r.name = s.role_name
left join identity1.branches b on b.code = s.branch_code
on conflict (id) do nothing;
