-- ทดสอบ schema pos ตั้งแต่เปิดโต๊ะจนคืนเงิน + กรณีที่ต้องถูกปฏิเสธ (ห้ามรันบน Supabase จริง)
-- รัน: psql -v ON_ERROR_STOP=1 -f pos_stub.sql -f ../migrations/20261119000300_pos.sql -f pos_smoke_test.sql
\set QUIET on
\pset format unaligned
\pset tuples_only on

-- ต้อง error ด้วยรหัสที่กำหนด ไม่งั้นทดสอบไม่ผ่าน
create or replace function pg_temp.expect_error(p_sql text, p_code text) returns void language plpgsql as $$
declare
  v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then raise exception 'FAIL: คาดว่า % แต่ไม่ error: %', p_code, p_sql; end if;
  if position(p_code in v_err) = 0 then raise exception 'FAIL: คาดว่า % แต่ได้ "%" จาก %', p_code, v_err, p_sql; end if;
  raise notice 'ok  ปฏิเสธถูกต้อง: %', p_code;
end $$;

create or replace function pg_temp.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok  %', p_name;
end $$;

\set QUIET off
begin;

-- สาขา A/B · พนักงาน · ผู้จัดการ · เมนู/ตัวเลือก (uuid จำลอง)
create temp table ids as select
  '00000000-0000-4000-8000-00000000000a'::uuid as branch_a,
  '00000000-0000-4000-8000-00000000000b'::uuid as branch_b,
  '00000000-0000-4000-8000-0000000000f1'::uuid as staff,
  '00000000-0000-4000-8000-0000000000a1'::uuid as manager,
  '00000000-0000-4000-8000-0000000000e1'::uuid as menu_rice,
  '00000000-0000-4000-8000-0000000000e2'::uuid as menu_tea,
  '00000000-0000-4000-8000-0000000000c1'::uuid as opt_egg;

insert into pos.dining_tables (branch_id, table_no, seats, zone)
select branch_a, 'T' || g, 4, 'โซนในร้าน' from ids, generate_series(1, 4) g;
insert into pos.dining_tables (branch_id, table_no) select branch_b, 'T1' from ids;

create temp table t as select table_no, id from pos.dining_tables, ids where branch_id = ids.branch_a;

-- ---------- เปิดโต๊ะ ----------
create temp table o1 as select * from pos.open_order((select branch_a from ids), array[(select id from t where table_no = 'T1')], 3, (select staff from ids));
select pg_temp.ok((select status from pos.dining_tables where id = (select id from t where table_no = 'T1')) = 'occupied', 'เปิดโต๊ะ → โต๊ะมีลูกค้า (1.7, 1.8)');
select pg_temp.ok((select order_no like 'B%' from o1), 'เลขบิลสร้างอัตโนมัติ');
select pg_temp.expect_error(format('select pos.open_order(%L, array[%L]::uuid[], 2, %L)', (select branch_a from ids), (select id from t where table_no = 'T1'), (select staff from ids)), 'POS:TABLE_NOT_AVAILABLE');
select pg_temp.expect_error(format('select pos.open_order(%L, array[%L]::uuid[], 2, %L)', (select branch_b from ids), (select id from t where table_no = 'T2'), (select staff from ids)), 'POS:TABLE_NOT_FOUND');

-- ---------- สั่งอาหาร 2 รอบ ----------
select pos.add_ticket((select id from o1), (select staff from ids), jsonb_build_array(
  jsonb_build_object('menu_id', (select menu_rice from ids), 'menu_name', 'ข้าวผัดกุ้ง', 'unit_price', 80, 'quantity', 2,
                     'options', jsonb_build_array(jsonb_build_object('option_id', (select opt_egg from ids), 'option_name', 'ไข่ดาว', 'extra_price', 10))),
  jsonb_build_object('menu_id', (select menu_tea from ids), 'menu_name', 'ชาไทยเย็น', 'unit_price', 45, 'quantity', 1, 'note', 'หวานน้อย')));
create temp table k2 as select * from pos.add_ticket((select id from o1), (select staff from ids),
  jsonb_build_array(jsonb_build_object('menu_id', (select menu_tea from ids), 'menu_name', 'ชาไทยเย็น', 'unit_price', 45, 'quantity', 2)));
select pg_temp.ok((select round_no from k2) = 2, 'สั่งรอบที่ 2 ได้ round_no = 2 (1.9)');
select pg_temp.ok((select count(*) from pos.add_ticket((select id from o1), (select staff from ids), '[{"x":1}]'::jsonb, (select id from k2))) = 1
                  and (select count(*) from pos.kitchen_tickets where order_id = (select id from o1)) = 2, 'ส่งตั๋วซ้ำด้วย id เดิม → ไม่สร้างซ้ำ');
-- (80+10)×2 + 45 + 45×2 = 315 · VAT 22.05 · total 337.05
select pg_temp.ok((select subtotal = 315 and vat_amount = 22.05 and total = 337.05 from pos.orders where id = (select id from o1)), 'คำนวณยอด + VAT 7% (1.24)');

-- ---------- ย้ายโต๊ะ / รวมโต๊ะ ----------
select pos.move_table((select id from o1), (select id from t where table_no = 'T1'), (select id from t where table_no = 'T2'));
select pg_temp.ok((select status from pos.dining_tables where id = (select id from t where table_no = 'T1')) = 'available'
                  and (select status from pos.dining_tables where id = (select id from t where table_no = 'T2')) = 'occupied', 'ย้ายโต๊ะ T1 → T2 (1.11)');

create temp table o2 as select * from pos.open_order((select branch_a from ids), array[(select id from t where table_no = 'T3')], 2, (select staff from ids));
select pos.add_ticket((select id from o2), (select staff from ids),
  jsonb_build_array(jsonb_build_object('menu_id', (select menu_rice from ids), 'menu_name', 'ข้าวผัดกุ้ง', 'unit_price', 80, 'quantity', 1)));
select pos.merge_tables((select id from o1), array[(select id from t where table_no = 'T3'), (select id from t where table_no = 'T4')]);
select pg_temp.ok((select status from pos.orders where id = (select id from o2)) = 'merged', 'บิลที่ถูกรวม → merged (1.12)');
select pg_temp.ok((select guest_count = 5 and subtotal = 395 from pos.orders where id = (select id from o1)), 'รวมโต๊ะ: ลูกค้า 3+2 · ยอด 315+80');
select pg_temp.ok((select count(*) from pos.order_tables where order_id = (select id from o1) and left_at is null) = 3, 'บิลหลักใช้ 3 โต๊ะ (T2 T3 T4)');
select pg_temp.ok((select array_agg(round_no order by round_no) from pos.kitchen_tickets where order_id = (select id from o1)) = array[1, 2, 3], 'ตั๋วของบิลที่รวมต่อท้ายเป็นรอบ 3');

-- ---------- ส่วนลด (ต้องอนุมัติก่อน) ----------
create temp table d1 as select * from pos.create_approval((select id from o1), (select staff from ids), 'discount', 'percent', 10, 'ลูกค้าประจำ');
select pg_temp.ok((select amount from d1) = 39.5 and (select discount_amount from pos.orders where id = (select id from o1)) = 0, 'ขอส่วนลด 10% → ยังไม่มีผลจนอนุมัติ (1.27, 1.30)');
select pg_temp.expect_error(format('select pos.create_approval(%L, %L, %L, %L, 5, %L)', (select id from o1), (select staff from ids), 'discount', 'amount', 'ซ้ำ'), 'POS:APPROVAL_PENDING_EXISTS');
select pos.decide_approval((select id from d1), 'approved', (select manager from ids), 'โอเค');
-- (395 − 39.5) × 1.07 = 380.385 → VAT 24.89 · total 380.39
select pg_temp.ok((select discount_amount = 39.5 and vat_amount = 24.89 and total = 380.39 from pos.orders where id = (select id from o1)), 'อนุมัติแล้วส่วนลดเข้าบิล + VAT ใหม่ (1.30)');
select pg_temp.expect_error(format('select pos.decide_approval(%L, %L, %L)', (select id from d1), 'rejected', (select manager from ids)), 'POS:APPROVAL_DECIDED');
select pg_temp.expect_error(format('update pos.approvals set reason = %L where id = %L', 'แก้', (select id from d1)), 'POS:APPROVAL_IMMUTABLE');
select pg_temp.expect_error(format('delete from pos.approvals where id = %L', (select id from d1)), 'POS:APPROVAL_UNDELETABLE');

-- ---------- เรียกเก็บเงิน + รับเงิน ----------
select pg_temp.expect_error(format('select pos.mark_paid(%L, gen_random_uuid(), %L, 380.39, %L)', (select id from o1), 'cash', (select staff from ids)), 'POS:ORDER_NOT_WAITING_PAYMENT');
select pos.request_payment((select id from o1));
select pg_temp.ok((select count(*) from pos.dining_tables where status = 'waiting_payment') = 3, 'เรียกเก็บเงิน → 3 โต๊ะรอชำระ (1.8)');
select pg_temp.expect_error(format('select pos.add_ticket(%L, %L, %L::jsonb)', (select id from o1), (select staff from ids), '[{"menu_id":"00000000-0000-4000-8000-0000000000e1","menu_name":"x","unit_price":1,"quantity":1}]'), 'POS:ORDER_NOT_OPEN');
select pg_temp.expect_error(format('select pos.mark_paid(%L, gen_random_uuid(), %L, 100, %L)', (select id from o1), 'cash', (select staff from ids)), 'POS:AMOUNT_MISMATCH');

create temp table pay as select '00000000-0000-4000-8000-0000000000b1'::uuid as id;
select pos.mark_paid((select id from o1), (select id from pay), 'cash', 380.39, (select staff from ids));
select pos.mark_paid((select id from o1), (select id from pay), 'cash', 380.39, (select staff from ids)); -- ซ้ำ = ไม่ error
select pg_temp.ok((select count(*) from pos.dining_tables where branch_id = (select branch_a from ids) and status = 'available') = 4, 'จ่ายแล้วทุกโต๊ะของบิลว่าง (1.26)');
select pg_temp.ok((select closed_at is not null and payment_method = 'cash' from pos.orders where id = (select id from o1)), 'บันทึกวิธีชำระและเวลาปิดบิล');
select pg_temp.expect_error(format('select pos.create_approval(%L, %L, %L, %L, 5, %L)', (select id from o1), (select staff from ids), 'discount', 'amount', 'สาย'), 'POS:ORDER_ALREADY_PAID');

-- ---------- คืนเงินบางรายการ ----------
create temp table tea as select id from pos.order_items where order_id = (select id from o1) and menu_name = 'ชาไทยเย็น' and quantity = 2;
create temp table r1 as select * from pos.create_approval((select id from o1), (select staff from ids), 'refund', 'amount', 1, 'ไม่ได้รับเครื่องดื่ม',
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from tea), 'quantity', 1)));
-- 45 × (380.39 / 395) = 43.34
select pg_temp.ok((select amount from r1) = 43.34, 'ยอดคืนตามสัดส่วนส่วนลด + VAT (1.28)');
select pg_temp.expect_error(format('select pos.create_approval(%L, %L, %L, %L, 1, %L, %L::jsonb)', (select id from o1), (select staff from ids), 'refund', 'amount', 'ซ้ำ',
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from tea), 'quantity', 1))), 'POS:APPROVAL_PENDING_EXISTS');
select pos.decide_approval((select id from r1), 'approved', (select manager from ids));
select pg_temp.expect_error(format('select pos.create_approval(%L, %L, %L, %L, 1, %L, %L::jsonb)', (select id from o1), (select staff from ids), 'refund', 'amount', 'เกิน',
  jsonb_build_array(jsonb_build_object('order_item_id', (select id from tea), 'quantity', 2))), 'POS:REFUND_QTY_EXCEEDED');
select pos.mark_refunded((select id from o1), (select id from r1), gen_random_uuid(), 43.34);
select pg_temp.ok((select status = 'refunded' and refunded_amount = 43.34 from pos.orders where id = (select id from o1)), 'คืนเงินแล้ว → บิล refunded');
select pg_temp.ok((select refunded_at is not null from pos.approvals where id = (select id from r1)), 'บันทึกเวลาคืนเงินในคำขอ');

-- ---------- เมนูขายดี ----------
-- ข้าวผัดกุ้ง 3 จาน (฿260) กับ ชาไทยเย็น 3 แก้ว (฿135) จำนวนเท่ากัน → เรียงตามยอดเงิน
select pg_temp.ok((select array_agg(menu_name || ':' || quantity || ':' || amount order by ord) from (
                     select *, row_number() over () as ord from pos.top_menus(current_date - 1, current_date + 1)) x)
                  = array['ข้าวผัดกุ้ง:3:260.00', 'ชาไทยเย็น:3:135.00'], 'เมนูขายดี: เรียงจำนวน แล้วยอดเงิน (1.35)');

-- ---------- ยกเลิกบิลเปล่า ----------
create temp table o3 as select * from pos.open_order((select branch_a from ids), array[(select id from t where table_no = 'T1')], 1, (select staff from ids));
select pos.cancel_order((select id from o3), (select staff from ids));
select pg_temp.ok((select status from pos.dining_tables where id = (select id from t where table_no = 'T1')) = 'available', 'ยกเลิกบิลที่เปิดผิด → โต๊ะว่าง');

-- ---------- RLS (Realtime) ----------
grant select on ids to authenticated;
set local role authenticated;
select set_config('test.claims', json_build_object('user_role', 'manager', 'branch_id', (select branch_a from ids))::text, true);
select pg_temp.ok((select count(*) from pos.approvals) = 2, 'manager เห็นคำขอของสาขาตัวเอง (1.29)');
select set_config('test.claims', json_build_object('user_role', 'manager', 'branch_id', (select branch_b from ids))::text, true);
select pg_temp.ok((select count(*) from pos.approvals) = 0, 'manager สาขาอื่นไม่เห็น');
select set_config('test.claims', json_build_object('user_role', 'staff', 'branch_id', (select branch_a from ids), 'sub', gen_random_uuid())::text, true);
select pg_temp.ok((select count(*) from pos.approvals) = 0, 'staff เห็นเฉพาะคำขอของตัวเอง');
select pg_temp.expect_error('select count(*) from pos.orders', 'permission denied');
reset role;

rollback;
\echo 'ALL POS TESTS PASSED'
