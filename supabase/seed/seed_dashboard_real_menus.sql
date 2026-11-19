-- Seed ข้อมูลย้อนหลังจาก "เมนูจริงในแค็ตตาล็อก" (บิล pos + payment + คืนเงิน + รายจ่าย)
-- รันใน Supabase SQL Editor (ฐานทดสอบ/dev เท่านั้น) — อ่านเมนู/ราคา/ตัวเลือก สาขา และพนักงานจากฐานข้อมูลเอง
--   • เมนู: catalog.menus ที่ยังไม่ลบ ของแต่ละสาขา (ราคาจริง) · ตัวเลือก: ตามกลุ่มตัวเลือกที่ผูกกับเมนู
--   • ยอดบิล/VAT: ให้ trigger ของ pos คำนวณเอง · payment.amount = pos.orders.total ตรงกันทุกบิล
--   • "เมนูขายดี" ในแดชบอร์ดใช้ได้ เพราะมีบิลและรายการอาหารจริงใน pos
-- รันซ้ำได้ (ลบ seed เดิมก่อน) · ใช้แทน seed_dashboard_history.sql (ไม่ต้องรันคู่กัน)
-- ตัวบอกว่าเป็น seed: pos.orders.order_no ขึ้นต้น 'S' · payments.idempotency_key ขึ้นต้น 'seed-' · expenses.note ขึ้นต้น '[seed]'
-- ไม่ตัดสต็อกย้อนหลัง และไม่ผูกโต๊ะ

begin;

-- ===================== ปรับค่าตรงนี้ =====================
create temp table seed_params on commit drop as
select date '2026-06-01'  as from_date,    -- วันเริ่ม (เวลาไทย)
       6                  as min_bills,    -- จำนวนบิลต่อสาขาต่อวัน
       20                 as max_bills,
       4                  as max_lines,    -- จำนวนรายการเมนูต่อบิล (สูงสุด)
       3                  as max_qty,      -- จำนวนต่อรายการ (สูงสุด)
       0.03::numeric      as refund_rate,  -- สัดส่วนบิลที่ถูกคืนเงิน
       0.5::numeric       as promptpay_rate,
       0.4::numeric       as option_rate;  -- โอกาสเลือกตัวเลือกในกลุ่มที่ไม่บังคับ

-- ===================== ล้าง seed เดิม (ทั้งแบบเก่าและแบบนี้) =====================
alter table pos.approvals disable trigger approvals_no_delete; -- log คำขอปกติห้ามลบ เปิดคืนท้ายสคริปต์

create temp table old_seed_orders on commit drop as select id from pos.orders where order_no like 'S%';
delete from payment.payments where idempotency_key like 'seed-%';
delete from payment.expenses where note like '[seed]%';
delete from pos.order_item_options where order_item_id in (select id from pos.order_items where order_id in (select id from old_seed_orders));
delete from pos.refund_items where approval_id in (select id from pos.approvals where order_id in (select id from old_seed_orders));
delete from pos.approvals where order_id in (select id from old_seed_orders);
delete from pos.order_items where order_id in (select id from old_seed_orders);
delete from pos.kitchen_tickets where order_id in (select id from old_seed_orders);
delete from pos.order_tables where order_id in (select id from old_seed_orders);
delete from pos.orders where id in (select id from old_seed_orders);

-- ===================== ข้อมูลตั้งต้นจากฐานข้อมูลจริง =====================
-- พนักงานรับเงิน: staff/manager ที่ active ของสาขา · ผู้อนุมัติคืนเงิน: manager ของสาขา (ถ้าไม่มีใช้พนักงานคนเดิม)
create temp table seed_staff on commit drop as
select p.branch_id,
       array_agg(p.id) as ids,
       coalesce(array_agg(p.id) filter (where p.role_id = 2), array_agg(p.id)) as approvers
  from identity1.profiles p
 where p.is_active and p.role_id <> 3 and p.branch_id is not null
 group by p.branch_id;

-- เมนูจริงของแต่ละสาขา + น้ำหนักความนิยมสุ่มคงที่ต่อเมนู (บางเมนูขายดีกว่าบางเมนู)
create temp table seed_menus on commit drop as
select m.id as menu_id, m.branch_id, m.name, m.price,
       greatest(power(random(), 2), 0.03) as w
  from catalog.menus m
  join seed_staff s on s.branch_id = m.branch_id
 where not m.is_deleted;

-- ===================== บิล =====================
create temp table seed_bills on commit drop as
select gen_random_uuid() as order_id,
       gen_random_uuid() as ticket_id,
       gen_random_uuid() as pay_id,
       b.id as branch_id,
       s.ids[1 + floor(random() * cardinality(s.ids))::int] as received_by,
       s.approvers[1 + floor(random() * cardinality(s.approvers))::int] as approver,
       (d::timestamp + make_interval(hours => 10 + floor(random() * 12)::int, mins => floor(random() * 60)::int))
         at time zone 'Asia/Bangkok' as paid_at,
       1 + floor(random() * sp.max_lines)::int as line_count,
       1 + floor(random() * 6)::int as guests,
       10 + floor(random() * 50)::int as dwell_mins,
       random() < sp.promptpay_rate as is_promptpay,
       random() as refund_roll,
       random() as refund_kind_roll
  from seed_params sp
 cross join identity1.branches b
  join seed_staff s on s.branch_id = b.id
 cross join lateral generate_series(sp.from_date, (now() at time zone 'Asia/Bangkok')::date, interval '1 day') d
 cross join lateral generate_series(1, sp.min_bills + floor(random() * (sp.max_bills - sp.min_bills + 1))::int) n
 where b.is_active
   and exists (select 1 from seed_menus sm where sm.branch_id = b.id);

delete from seed_bills where paid_at > now();

-- เลขบิลขึ้นต้น S + วันที่ปิดบิล (ไทย) + ลำดับในวัน (ไม่ชนกับเลข B ของบิลจริง)
alter table seed_bills add column order_no text;
update seed_bills sb set order_no = x.no
  from (select order_id,
               'S' || to_char(paid_at at time zone 'Asia/Bangkok', 'YYMMDD') || '-' ||
               lpad(row_number() over (partition by (paid_at at time zone 'Asia/Bangkok')::date order by paid_at, order_id)::text, 4, '0') as no
          from seed_bills) x
 where x.order_id = sb.order_id;

-- 1) บิลเปิดอยู่ก่อน (trigger ยอมให้เพิ่มรายการได้เฉพาะบิลสถานะ open)
insert into pos.orders (id, order_no, branch_id, opened_by, guest_count, status, opened_at)
select order_id, order_no, branch_id, received_by, guests, 'open', paid_at - make_interval(mins => dwell_mins)
  from seed_bills;

insert into pos.kitchen_tickets (id, order_id, branch_id, created_by, round_no, status, created_at, status_changed_at)
select ticket_id, order_id, branch_id, received_by, 1, 'served',
       paid_at - make_interval(mins => dwell_mins - 1), paid_at - make_interval(mins => 1)
  from seed_bills;

-- 2) รายการอาหาร: สุ่มเมนูของสาขานั้นตามน้ำหนักความนิยม ไม่ซ้ำในบิลเดียว
create temp table seed_items on commit drop as
select gen_random_uuid() as item_id, b.order_id, b.ticket_id, b.paid_at, b.dwell_mins,
       m.menu_id, m.name, m.price, 1 + floor(random() * sp.max_qty)::int as qty
  from seed_bills b
 cross join seed_params sp
 cross join lateral (
   select sm.menu_id, sm.name, sm.price
     from seed_menus sm
    where sm.branch_id = b.branch_id
    order by -ln(1 - random()) / sm.w          -- สุ่มแบบถ่วงน้ำหนัก
    limit b.line_count
 ) m;

insert into pos.order_items (id, order_id, ticket_id, menu_id, menu_name, quantity, unit_price, created_at)
select item_id, order_id, ticket_id, menu_id, name, qty, price, paid_at - make_interval(mins => dwell_mins - 1)
  from seed_items;

-- ตัวเลือกของเมนู: กลุ่มบังคับเลือก 1 ตัวเสมอ · กลุ่มไม่บังคับเลือกตามโอกาส (สุ่มแบบคงที่ต่อรายการ+กลุ่ม)
insert into pos.order_item_options (order_item_id, option_id, option_name, extra_price)
select i.item_id, o.id, o.name, o.extra_price
  from seed_items i
  join catalog.menu_option_groups mg on mg.menu_id = i.menu_id
  join catalog.option_groups g on g.id = mg.option_group_id and g.is_active
 cross join seed_params sp
 cross join lateral (
   select op.id, op.name, op.extra_price
     from catalog.options op
    where op.option_group_id = g.id and op.is_active
    order by random()
    limit 1
 ) o
 where g.is_required or (abs(hashtext(i.item_id::text || g.id::text)) % 1000) < sp.option_rate * 1000;

-- 3) ปิดบิลชำระเงิน: trigger คำนวณ subtotal/VAT/total ให้แล้ว
update pos.orders set status = 'waiting_payment' where id in (select order_id from seed_bills);

insert into payment.payments
  (id, order_id, branch_id, type, method, amount, cash_received, change_amount, received_by, idempotency_key, paid_at, pos_synced_at)
select b.pay_id, b.order_id, b.branch_id, 'charge',
       case when b.is_promptpay then 'promptpay'::payment.payment_method else 'cash'::payment.payment_method end,
       o.total,
       case when b.is_promptpay then null else ceil(o.total / 100) * 100 end,           -- รับเป็นแบงก์ร้อย
       case when b.is_promptpay then null else ceil(o.total / 100) * 100 - o.total end, -- cash_received = amount + change
       b.received_by, 'seed-c-' || gen_random_uuid(), b.paid_at, b.paid_at
  from seed_bills b
  join pos.orders o on o.id = b.order_id;

update pos.orders o
   set status = 'paid', payment_id = b.pay_id,
       payment_method = case when b.is_promptpay then 'promptpay'::pos.payment_method else 'cash'::pos.payment_method end,
       closed_by = b.received_by, closed_at = b.paid_at
  from seed_bills b
 where b.order_id = o.id;

-- ===================== คืนเงิน =====================
-- 70% คืนบางรายการ (1 รายการ ยอดคิดตามสัดส่วน total ÷ subtotal เหมือนระบบจริง) · 30% คืนทั้งบิล
create temp table seed_refunds on commit drop as
with picked as (
  select distinct on (i.order_id) i.order_id, i.item_id, i.qty,
         round(i.qty * (i.price + coalesce((select sum(x.extra_price) from pos.order_item_options x where x.order_item_id = i.item_id), 0)), 2) as line_total
    from seed_items i
   order by i.order_id, i.item_id
)
select gen_random_uuid() as approval_id, gen_random_uuid() as refund_pay_id,
       b.order_id, b.branch_id, b.received_by, b.approver, b.is_promptpay,
       (b.refund_kind_roll < 0.3) as whole_bill, p.item_id, p.qty,
       case when b.refund_kind_roll < 0.3 then o.total
            else least(round(p.line_total * o.total / nullif(o.subtotal, 0), 2), o.total) end as amount,
       least(b.paid_at + make_interval(mins => 20 + floor(random() * 90)::int), now() - interval '1 minute') as requested_at,
       (array['ลูกค้าไม่ได้รับเครื่องดื่ม','เมนูผิด','รสชาติไม่ตรงตามที่สั่ง','รอนานเกินไป','ลูกค้าเปลี่ยนใจ'])[1 + floor(random() * 5)::int] as reason
  from seed_bills b
  join pos.orders o on o.id = b.order_id
  join picked p on p.order_id = b.order_id
 cross join seed_params sp
 where b.refund_roll < sp.refund_rate;

delete from seed_refunds where coalesce(amount, 0) <= 0;

insert into pos.approvals
  (id, order_id, branch_id, requested_by, approved_by, type, value_type, value, amount, reason, status,
   requested_at, decided_at, refunded_at, refund_payment_id)
select approval_id, order_id, branch_id, received_by, approver, 'refund', 'amount', amount, amount, reason, 'approved',
       requested_at, requested_at + interval '5 minutes', requested_at + interval '10 minutes', refund_pay_id
  from seed_refunds;

insert into pos.refund_items (approval_id, order_item_id, quantity, amount)
select approval_id, item_id, qty, amount from seed_refunds where not whole_bill;

insert into payment.payments
  (id, order_id, branch_id, type, approval_id, method, amount, received_by, idempotency_key, paid_at, pos_synced_at)
select refund_pay_id, order_id, branch_id, 'refund', approval_id,
       case when is_promptpay then 'promptpay'::payment.payment_method else 'cash'::payment.payment_method end,
       amount, received_by, 'seed-r-' || gen_random_uuid(),
       requested_at + interval '10 minutes', requested_at + interval '10 minutes'
  from seed_refunds;

update pos.orders o
   set refunded_amount = r.amount, status = 'refunded'   -- เหมือน pos.mark_refunded
  from seed_refunds r
 where r.order_id = o.id;

alter table pos.approvals enable trigger approvals_no_delete;

-- ===================== รายจ่าย =====================
-- ต่อสาขาต่อเดือน: เช่า/ไฟ/น้ำ (วันที่ 1) · ค่าแรง (วันที่ 28) · วัตถุดิบ (ทุกวันจันทร์) · อื่นๆ (วันที่ 15) · ไม่สร้างวันที่ในอนาคต
insert into payment.expenses (branch_id, category, amount, expense_date, note, created_by)
select b.id, e.category::payment.expense_category, e.amount, e.dt, '[seed] ' || e.label, s.ids[1]
  from identity1.branches b
  join seed_staff s on s.branch_id = b.id
 cross join seed_params sp
 cross join lateral (
   select 'rent_utilities' as category, 'ค่าเช่า/ไฟ/น้ำ' as label,
          round((12000 + random() * 4000)::numeric, 2) as amount, m::date as dt
     from generate_series(date_trunc('month', sp.from_date), now() at time zone 'Asia/Bangkok', interval '1 month') m
   union all
   select 'labor', 'ค่าแรง', round((25000 + random() * 8000)::numeric, 2), (m + interval '27 days')::date
     from generate_series(date_trunc('month', sp.from_date), now() at time zone 'Asia/Bangkok', interval '1 month') m
   union all
   select 'other', 'อื่นๆ', round((300 + random() * 1700)::numeric, 2), (m + interval '14 days')::date
     from generate_series(date_trunc('month', sp.from_date), now() at time zone 'Asia/Bangkok', interval '1 month') m
   union all
   select 'ingredients', 'วัตถุดิบประจำสัปดาห์', round((3000 + random() * 4000)::numeric, 2), w::date
     from generate_series(sp.from_date, (now() at time zone 'Asia/Bangkok')::date, interval '1 day') w
    where extract(isodow from w) = 1
 ) e
 where b.is_active
   and e.dt <= (now() at time zone 'Asia/Bangkok')::date;

-- ===================== สรุปผล (ตรวจก่อน commit) =====================
select b.name as branch,
       count(*) filter (where p.type = 'charge')                                 as bills,
       round(coalesce(sum(p.amount) filter (where p.type = 'charge'), 0), 2)     as sales,
       round(coalesce(sum(p.amount) filter (where p.type = 'refund'), 0), 2)     as refunds
  from payment.payments p
  join identity1.branches b on b.id = p.branch_id
 where p.idempotency_key like 'seed-%'
 group by b.name order by b.name;

-- ยอด payment ต้องตรงกับยอดบิลใน pos ทุกบิล (ควรได้ 0 แถว)
select o.order_no, o.total, p.amount
  from pos.orders o join payment.payments p on p.order_id = o.id and p.type = 'charge'
 where o.order_no like 'S%' and o.total <> p.amount;

-- เมนูขายดี 5 อันดับของแต่ละสาขา
select b.name as branch, t.menu_name, t.quantity, t.amount
  from identity1.branches b
 cross join lateral pos.top_menus(date '2026-01-01', (now() at time zone 'Asia/Bangkok')::date, b.id, 5) t
 where b.is_active
 order by b.name, t.quantity desc;

commit;

-- ===================== ล้าง seed (รันแยกเมื่อต้องการลบทั้งหมด) =====================
-- ใช้บล็อก "ล้าง seed เดิม" ด้านบนของไฟล์นี้ (ต้องปิด trigger approvals_no_delete ชั่วคราวเหมือนกัน)
