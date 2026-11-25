-- ทดสอบสูตรยอดบิลของ pos (1.24): vat = (subtotal − discount) × 7% · total = subtotal − discount + vat
-- เน้นกรณีปัดเศษ + ส่วนลดเปอร์เซ็นต์/บาท + ส่วนลดเต็มยอด (ห้ามรันบน Supabase จริง)
-- รัน: psql -v ON_ERROR_STOP=1 -f pos_stub.sql -f ../migrations/20261119000300_pos.sql -f pos_vat_test.sql
\set QUIET on
\pset format unaligned
\pset tuples_only on

create or replace function pg_temp.ok(p_cond boolean, p_name text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FAIL: %', p_name; end if;
  raise notice 'ok  %', p_name;
end $$;

\set QUIET off
begin;

create temp table ids as select
  '00000000-0000-4000-8000-00000000000a'::uuid as branch,
  '00000000-0000-4000-8000-0000000000f1'::uuid as staff,
  '00000000-0000-4000-8000-0000000000a1'::uuid as manager,
  '00000000-0000-4000-8000-0000000000e1'::uuid as menu;

insert into pos.dining_tables (branch_id, table_no, seats) select branch, 'V' || g, 4 from ids, generate_series(1, 8) g;

-- สร้างบิล 1 โต๊ะ สั่ง quantity × unit_price แล้ว (ถ้าระบุ) ขอส่วนลด + อนุมัติ → คืนแถวบิลล่าสุด
create or replace function pg_temp.bill(p_table text, p_price numeric, p_qty int, p_dtype text default null, p_dvalue numeric default null)
returns pos.orders language plpgsql as $$
declare
  o pos.orders;
  a pos.approvals;
begin
  select * into o from pos.open_order((select branch from ids), array[(select id from pos.dining_tables where table_no = p_table)], 1, (select staff from ids));
  perform pos.add_ticket(o.id, (select staff from ids), jsonb_build_array(
    jsonb_build_object('menu_id', (select menu from ids), 'menu_name', 'ทดสอบ', 'unit_price', p_price, 'quantity', p_qty)));
  if p_dtype is not null then
    select * into a from pos.create_approval(o.id, (select staff from ids), 'discount', p_dtype::pos.approval_value_type, p_dvalue, 'ทดสอบ');
    perform pos.decide_approval(a.id, 'approved', (select manager from ids));
  end if;
  select * into o from pos.orders where id = o.id;
  return o;
end $$;

-- VAT และส่วนลด % ปัดเป็นบาทเต็ม (ปัดตามปกติ .50 ขึ้น) → total เป็นบาทเต็มเสมอ
-- ไม่มีส่วนลด: ตัวเลขกลม
select pg_temp.ok((select subtotal = 100 and discount_amount = 0 and vat_amount = 7 and total = 107 from pg_temp.bill('V1', 100, 1)), '100 → VAT 7 · total 107');

-- ปัดลง: 315 × 7% = 22.05 → 22
select pg_temp.ok((select subtotal = 315 and vat_amount = 22 and total = 337 from pg_temp.bill('V2', 315, 1)), '315 → VAT 22 (ปัด 22.05 ลง) · total 337');

-- ปัดขึ้นที่ครึ่ง: 50 × 7% = 3.50 → 4
select pg_temp.ok((select vat_amount = 4 and total = 54 from pg_temp.bill('V3', 50, 1)), '50 → VAT 4 (ปัด 3.50 ขึ้น) · total 54');

-- 3 × 33 = 99 · VAT 6.93 → 7 · total 106
select pg_temp.ok((select subtotal = 99 and vat_amount = 7 and total = 106 from pg_temp.bill('V4', 33, 3)), '3 × 33 → VAT 7 · total 106');

-- ส่วนลดบาท: (200 − 30) × 7% = 11.90 → 12 · total 182 (VAT คิดหลังหักส่วนลด)
select pg_temp.ok((select discount_amount = 30 and vat_amount = 12 and total = 182 from pg_temp.bill('V5', 200, 1, 'amount', 30)), 'ส่วนลด 30 บาท → VAT คิดหลังหักส่วนลด');

-- ส่วนลด 50% ของ 99 = 49.50 → 50 · (99 − 50) × 7% = 3.43 → 3 · total 52
select pg_temp.ok((select discount_amount = 50 and vat_amount = 3 and total = 52 from pg_temp.bill('V6', 33, 3, 'percent', 50)), 'ส่วนลด 50% ปัดเป็นบาทเต็ม → total 52');

-- ส่วนลด 100% → ทุกอย่างเป็น 0
select pg_temp.ok((select discount_amount = 100 and vat_amount = 0 and total = 0 from pg_temp.bill('V7', 100, 1, 'percent', 100)), 'ส่วนลด 100% → VAT 0 · total 0');

-- ส่วนลดบาทเกินยอดบิลต้องถูกปฏิเสธ ไม่ทำให้ยอดติดลบ
do $$
declare
  o pos.orders;
  a pos.approvals;
  v_err text;
begin
  select * into o from pos.open_order((select branch from ids), array[(select id from pos.dining_tables where table_no = 'V8')], 1, (select staff from ids));
  perform pos.add_ticket(o.id, (select staff from ids), jsonb_build_array(
    jsonb_build_object('menu_id', (select menu from ids), 'menu_name', 'ทดสอบ', 'unit_price', 50, 'quantity', 1)));
  begin
    perform pos.create_approval(o.id, (select staff from ids), 'discount', 'amount', 60, 'เกินยอด');
  exception when others then v_err := sqlerrm;
  end;
  if v_err is null or position('POS:DISCOUNT_TOO_LARGE' in v_err) = 0 then raise exception 'FAIL: ส่วนลดเกินยอดต้องถูกปฏิเสธ (ได้ %)', v_err; end if;
  raise notice 'ok  ส่วนลดเกินยอดบิล → POS:DISCOUNT_TOO_LARGE';
end $$;

rollback;
\echo ALL VAT TESTS PASSED
