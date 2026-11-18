-- Smoke test ของ schema pos — รันหลัง migration ทั้งหมด (psql -v ON_ERROR_STOP=1)
-- ทุก assert ที่ผิดจะ raise exception
\set branch_a '''aaaaaaaa-0000-0000-0000-000000000001'''
\set branch_b '''bbbbbbbb-0000-0000-0000-000000000002'''
\set staff    '''11111111-0000-0000-0000-000000000001'''
\set manager  '''22222222-0000-0000-0000-000000000002'''

begin;

insert into pos.dining_tables (id, branch_id, table_no) values
  ('00000000-0000-0000-0000-0000000000a1', :branch_a, 'A1'),
  ('00000000-0000-0000-0000-0000000000a2', :branch_a, 'A2'),
  ('00000000-0000-0000-0000-0000000000a3', :branch_a, 'A3'),
  ('00000000-0000-0000-0000-0000000000b1', :branch_b, 'B1');

-- เปิดบิล A1
insert into pos.orders (id, branch_id, opened_by, guest_count)
values ('00000000-0000-0000-0000-00000000000f', :branch_a, :staff, 3);
insert into pos.order_tables (order_id, table_id)
values ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a1');

do $$ begin
  assert (select status from pos.dining_tables where table_no = 'A1') = 'occupied', 'A1 ควร occupied';
  assert (select order_no from pos.orders limit 1) like 'ORD%-000001', 'order_no format';
end $$;

-- เปิดโต๊ะซ้อนไม่ได้
do $$ begin
  insert into pos.orders (id, branch_id, opened_by, guest_count)
  values ('00000000-0000-0000-0000-0000000000ee', 'aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-0000-0000-0000-000000000001', 1);
  insert into pos.order_tables (order_id, table_id)
  values ('00000000-0000-0000-0000-0000000000ee', '00000000-0000-0000-0000-0000000000a1');
  raise exception 'ควร error: โต๊ะซ้อน';
exception when unique_violation then null;
end $$;

-- ใช้โต๊ะต่างสาขาไม่ได้
do $$ begin
  insert into pos.order_tables (order_id, table_id)
  values ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000b1');
  raise exception 'ควร error: ต่างสาขา';
exception when raise_exception then
  if sqlerrm not like 'BRANCH_MISMATCH%' then raise; end if;
end $$;

-- รวมโต๊ะ A2 เข้าบิล, ย้าย A1 → A3
insert into pos.order_tables (order_id, table_id)
values ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a2');
update pos.order_tables set left_at = now()
 where order_id = '00000000-0000-0000-0000-00000000000f'
   and table_id = '00000000-0000-0000-0000-0000000000a1' and left_at is null;
insert into pos.order_tables (order_id, table_id)
values ('00000000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-0000000000a3');

do $$ begin
  assert (select status from pos.dining_tables where table_no = 'A1') = 'available', 'A1 ควรว่างหลังย้าย';
  assert (select status from pos.dining_tables where table_no = 'A2') = 'occupied', 'A2 occupied';
  assert (select status from pos.dining_tables where table_no = 'A3') = 'occupied', 'A3 occupied';
end $$;

-- สั่งอาหารรอบ 1: ข้าวผัด 2 x 60 + ไข่ดาว 10, ชาเย็น 1 x 45
insert into pos.kitchen_tickets (id, order_id, branch_id, created_by, round_no)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-00000000000f', :branch_a, :staff,
        pos.next_round_no('00000000-0000-0000-0000-00000000000f'));
insert into pos.order_items (id, order_id, ticket_id, menu_id, menu_name, quantity, unit_price, note) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-00000000000f',
   '00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'ข้าวผัด', 2, 60, 'ไม่เผ็ด'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-00000000000f',
   '00000000-0000-0000-0000-0000000000c1', gen_random_uuid(), 'ชาเย็น', 1, 45, null);
insert into pos.order_item_options (order_item_id, option_id, option_name, extra_price)
values ('00000000-0000-0000-0000-0000000000d1', gen_random_uuid(), 'ไข่ดาว', 10);

-- subtotal = 2*(60+10) + 45 = 185 · vat = 12.95 · total = 197.95
do $$
declare o pos.orders;
begin
  select * into o from pos.orders where id = '00000000-0000-0000-0000-00000000000f';
  assert o.subtotal = 185,    format('subtotal %s', o.subtotal);
  assert o.vat_amount = 12.95, format('vat %s', o.vat_amount);
  assert o.total = 197.95,    format('total %s', o.total);
  assert pos.next_round_no(o.id) = 2, 'round ถัดไป = 2';
end $$;

-- ขอส่วนลด 10% → ยังไม่มีผลจนกว่าอนุมัติ
insert into pos.approvals (id, order_id, branch_id, requested_by, type, value_type, value, amount, reason)
values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-00000000000f', :branch_a, :staff,
        'discount', 'percent', 10, 18.50, 'ลูกค้าประจำ');

do $$ begin
  assert (select discount_amount from pos.orders limit 1) = 0, 'ยังไม่อนุมัติ ส่วนลดต้องเป็น 0';
end $$;

update pos.approvals set status = 'approved', approved_by = :manager
 where id = '00000000-0000-0000-0000-0000000000e1';

-- discount 18.50 · vat = 166.50*0.07 = 11.655 → 11.66 · total = 178.16
do $$
declare o pos.orders;
begin
  select * into o from pos.orders where id = '00000000-0000-0000-0000-00000000000f';
  assert o.discount_amount = 18.50, format('discount %s', o.discount_amount);
  assert o.vat_amount = 11.66,      format('vat %s', o.vat_amount);
  assert o.total = 178.16,          format('total %s', o.total);
  assert (select decided_at from pos.approvals where id = '00000000-0000-0000-0000-0000000000e1') is not null;
end $$;

-- approval ที่ตัดสินแล้ว แก้/ลบไม่ได้
do $$ begin
  update pos.approvals set status = 'rejected' where id = '00000000-0000-0000-0000-0000000000e1';
  raise exception 'ควร error: แก้ approval ที่ตัดสินแล้ว';
exception when raise_exception then
  if sqlerrm not like 'APPROVAL_DECIDED%' then raise; end if;
end $$;
do $$ begin
  delete from pos.approvals where id = '00000000-0000-0000-0000-0000000000e1';
  raise exception 'ควร error: ลบ approval';
exception when raise_exception then
  if sqlerrm not like 'APPROVAL_UNDELETABLE%' then raise; end if;
end $$;

-- ขอคืนเงินก่อนจ่ายไม่ได้
do $$ begin
  insert into pos.approvals (order_id, branch_id, requested_by, type, value, amount, reason)
  values ('00000000-0000-0000-0000-00000000000f', 'aaaaaaaa-0000-0000-0000-000000000001',
          '11111111-0000-0000-0000-000000000001', 'refund', 45, 45, 'test');
  raise exception 'ควร error: refund ก่อนจ่าย';
exception when raise_exception then
  if sqlerrm not like 'ORDER_NOT_PAID%' then raise; end if;
end $$;

-- เรียกเก็บเงิน → โต๊ะรอชำระ, สั่งเพิ่มไม่ได้
update pos.orders set status = 'waiting_payment' where id = '00000000-0000-0000-0000-00000000000f';
do $$ begin
  assert (select status from pos.dining_tables where table_no = 'A2') = 'waiting_payment', 'A2 waiting_payment';
  begin
    insert into pos.kitchen_tickets (order_id, branch_id, created_by, round_no)
    values ('00000000-0000-0000-0000-00000000000f', 'aaaaaaaa-0000-0000-0000-000000000001',
            '11111111-0000-0000-0000-000000000001', 2);
    raise exception 'ควร error: สั่งในบิล waiting_payment';
  exception when raise_exception then
    if sqlerrm not like 'ORDER_NOT_OPEN%' then raise; end if;
  end;
end $$;

-- จ่ายแล้ว → โต๊ะทั้งหมดว่าง (1.26), closed_at ถูกตั้ง
update pos.orders set status = 'paid', closed_by = :staff where id = '00000000-0000-0000-0000-00000000000f';
do $$ begin
  assert (select count(*) from pos.dining_tables where branch_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          and status <> 'available') = 0, 'โต๊ะสาขา A ต้องว่างทั้งหมด';
  assert (select closed_at from pos.orders where id = '00000000-0000-0000-0000-00000000000f') is not null;
  assert (select count(*) from pos.order_tables where left_at is null
          and order_id = '00000000-0000-0000-0000-00000000000f') = 0;
end $$;

-- คืนเงินบางรายการ: ชาเย็น 1 ได้, ขอเพิ่มอีก 1 เกินจำนวน
insert into pos.approvals (id, order_id, branch_id, requested_by, type, value, amount, reason)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-00000000000f', :branch_a, :staff,
        'refund', 45, 48.15, 'ชาเย็นหก');
insert into pos.refund_items (approval_id, order_item_id, quantity, amount)
values ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000d2', 1, 48.15);
do $$ begin
  insert into pos.approvals (id, order_id, branch_id, requested_by, type, value, amount, reason)
  values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-00000000000f',
          'aaaaaaaa-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
          'refund', 45, 45, 'ซ้ำ');
  insert into pos.refund_items (approval_id, order_item_id, quantity, amount)
  values ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000d2', 1, 45);
  raise exception 'ควร error: คืนเกินจำนวน';
exception when raise_exception then
  if sqlerrm not like 'VALIDATION_ERROR%' then raise; end if;
end $$;

-- ยอดบิลที่จ่ายแล้วไม่เปลี่ยน / ย้อนสถานะไม่ได้
do $$ begin
  update pos.orders set status = 'open' where id = '00000000-0000-0000-0000-00000000000f';
  raise exception 'ควร error: paid → open';
exception when raise_exception then
  if sqlerrm not like 'INVALID_STATUS%' then raise; end if;
end $$;

-- RLS: จำลองผู้ใช้แต่ละ role
insert into pos.orders (id, branch_id, opened_by, guest_count)
values ('00000000-0000-0000-0000-0000000000ee', :branch_a, :staff, 2);
insert into pos.kitchen_tickets (order_id, branch_id, created_by, round_no)
values ('00000000-0000-0000-0000-0000000000ee', :branch_a, :staff, 1);

set local role authenticated;

set local request.jwt.claims = '{"sub":"11111111-0000-0000-0000-000000000001","user_role":"staff","branch_id":"aaaaaaaa-0000-0000-0000-000000000001"}';
do $$ begin
  assert (select count(*) from pos.kitchen_tickets) = 2, 'staff สาขา A เห็นตั๋ว 2 ใบ';
  assert (select count(*) from pos.approvals) = 2, 'staff เห็นคำขอตัวเอง 2 รายการ';
end $$;

set local request.jwt.claims = '{"sub":"99999999-0000-0000-0000-000000000009","user_role":"staff","branch_id":"aaaaaaaa-0000-0000-0000-000000000001"}';
do $$ begin
  assert (select count(*) from pos.approvals) = 0, 'staff อื่นไม่เห็นคำขอของคนอื่น';
end $$;

set local request.jwt.claims = '{"sub":"22222222-0000-0000-0000-000000000002","user_role":"manager","branch_id":"bbbbbbbb-0000-0000-0000-000000000002"}';
do $$ begin
  assert (select count(*) from pos.kitchen_tickets) = 0, 'manager สาขา B ไม่เห็นตั๋วสาขา A';
  assert (select count(*) from pos.approvals) = 0, 'manager สาขา B ไม่เห็นคำขอสาขา A';
end $$;

set local request.jwt.claims = '{"sub":"33333333-0000-0000-0000-000000000003","user_role":"owner"}';
do $$ begin
  assert (select count(*) from pos.kitchen_tickets) = 2, 'owner เห็นทุกสาขา';
  assert (select count(*) from pos.approvals) = 2, 'owner เห็นคำขอทุกสาขา';
end $$;

do $$ begin
  perform 1 from pos.orders;
  raise exception 'ควร error: authenticated อ่าน orders ตรงไม่ได้';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;

\echo 'ALL SMOKE TESTS PASSED'
