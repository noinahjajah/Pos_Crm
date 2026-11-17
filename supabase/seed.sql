-- ข้อมูลตั้งต้น: 3 สาขา (restaurant / drinks / bar)

insert into identity.branches (id, code, name, branch_type, address, phone) values
  ('11111111-1111-4111-8111-111111111111', 'RES01', 'สาขาร้านอาหาร', 'restaurant', null, null),
  ('22222222-2222-4222-8222-222222222222', 'DRK01', 'สาขาเครื่องดื่ม', 'drinks',     null, null),
  ('33333333-3333-4333-8333-333333333333', 'BAR01', 'สาขาบาร์',       'bar',        null, null)
on conflict (id) do nothing;
