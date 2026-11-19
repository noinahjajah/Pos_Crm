-- Seed ข้อมูลย้อนหลังสำหรับ dashboard / กำไร-ขาดทุน (payment.payments + payment.expenses)
-- รันใน Supabase SQL Editor (ฐานทดสอบ/dev เท่านั้น) — ดึงสาขาและพนักงานจากฐานข้อมูลเอง ไม่ต้องใส่ id
-- รันซ้ำได้: ลบแถว seed เดิมก่อนแล้วสร้างใหม่ · ลบ seed ทิ้งอย่างเดียว: ดู "ล้าง seed" ท้ายไฟล์
-- แถว seed มี idempotency_key ขึ้นต้น 'seed-' (payments) และ note ขึ้นต้น '[seed]' (expenses)
--
-- หมายเหตุ: order_id / approval_id เป็น uuid สมมติ (ไม่มีบิลในระบบ pos จริง) → "เมนูขายดี" จะว่าง
--           ยอดขาย จำนวนบิล เงินคืน รายจ่าย กราฟ และหน้ากำไร ใช้ได้ตามปกติ

begin;

-- ===================== ปรับค่าตรงนี้ =====================
create temp table seed_params on commit drop as
select date '2026-06-01'  as from_date,   -- วันเริ่ม (เวลาไทย)
       6                  as min_bills,   -- จำนวนบิลต่อสาขาต่อวัน ต่ำสุด
       20                 as max_bills,   -- สูงสุด
       60::numeric        as min_amount,  -- ยอดต่อบิล (บาท)
       650::numeric       as max_amount,
       0.03::numeric      as refund_rate, -- สัดส่วนบิลที่ถูกคืนเงิน
       0.5::numeric       as promptpay_rate;

-- ===================== ล้างของเดิมที่เคย seed =====================
delete from payment.payments where idempotency_key like 'seed-%';
delete from payment.expenses where note like '[seed]%';

-- ===================== ใบเสร็จ (charge) =====================
-- พนักงานรับเงิน: สุ่มจาก staff/manager ที่ active ของสาขานั้น (สาขาที่ไม่มีพนักงานจะถูกข้าม)
create temp table seed_staff on commit drop as
select p.branch_id, array_agg(p.id) as ids
  from identity1.profiles p
 where p.is_active and p.role_id <> 3 and p.branch_id is not null
 group by p.branch_id;

create temp table seed_bills on commit drop as
select gen_random_uuid() as order_id,
       b.id as branch_id,
       s.ids[1 + floor(random() * cardinality(s.ids))::int] as received_by,
       -- เวลาในวัน 10:00–21:59 (ไทย)
       (d::timestamp + make_interval(hours => 10 + floor(random() * 12)::int, mins => floor(random() * 60)::int))
         at time zone 'Asia/Bangkok' as paid_at,
       round((sp.min_amount + random() * (sp.max_amount - sp.min_amount))::numeric, 2) as amount,
       random() < sp.promptpay_rate as is_promptpay,
       random() as refund_roll
  from seed_params sp
 cross join identity1.branches b
  join seed_staff s on s.branch_id = b.id
 cross join lateral generate_series(sp.from_date, (now() at time zone 'Asia/Bangkok')::date, interval '1 day') d
 cross join lateral generate_series(1, sp.min_bills + floor(random() * (sp.max_bills - sp.min_bills + 1))::int) n
 where b.is_active;

-- ไม่สร้างบิลที่อยู่ในอนาคต (วันนี้ที่เวลายังมาไม่ถึง)
delete from seed_bills where paid_at > now();

insert into payment.payments
  (order_id, branch_id, type, method, amount, cash_received, change_amount, received_by, idempotency_key, paid_at, pos_synced_at)
select order_id, branch_id, 'charge',
       case when is_promptpay then 'promptpay'::payment.payment_method else 'cash'::payment.payment_method end,
       amount,
       case when is_promptpay then null else ceil(amount / 100) * 100 end,          -- รับเป็นแบงก์ร้อย
       case when is_promptpay then null else ceil(amount / 100) * 100 - amount end, -- cash_received = amount + change
       received_by, 'seed-c-' || gen_random_uuid(), paid_at, paid_at
  from seed_bills;

-- ===================== คืนเงิน (refund) =====================
-- สุ่มบางบิลให้คืน 40–100% ของยอด ภายใน 1–5 ชม. ถัดมา (ไม่เกินเวลาปัจจุบัน)
insert into payment.payments
  (order_id, branch_id, type, approval_id, method, amount, received_by, idempotency_key, paid_at, pos_synced_at)
select order_id, branch_id, 'refund', gen_random_uuid(),
       case when is_promptpay then 'promptpay'::payment.payment_method else 'cash'::payment.payment_method end,
       round((amount * (0.4 + random() * 0.6))::numeric, 2),
       received_by, 'seed-r-' || gen_random_uuid(),
       least(paid_at + make_interval(hours => 1 + floor(random() * 5)::int), now()),
       least(paid_at + make_interval(hours => 1 + floor(random() * 5)::int), now())
  from seed_bills, seed_params sp
 where refund_roll < sp.refund_rate;

-- ===================== รายจ่าย =====================
-- ต่อสาขาต่อเดือน: เช่า/ไฟ/น้ำ (วันที่ 1) · ค่าแรง (วันที่ 28) · วัตถุดิบ (ทุกวันจันทร์) · อื่นๆ (วันที่ 15)
-- วันที่ในอนาคตไม่สร้าง
insert into payment.expenses (branch_id, category, amount, expense_date, note, created_by)
select b.id, e.category::payment.expense_category, e.amount, e.dt, '[seed] ' || e.label,
       (select ids[1] from seed_staff where branch_id = b.id)
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
       count(*) filter (where p.type = 'charge')                                   as bills,
       round(coalesce(sum(p.amount) filter (where p.type = 'charge'), 0), 2)       as sales,
       round(coalesce(sum(p.amount) filter (where p.type = 'refund'), 0), 2)       as refunds
  from payment.payments p
  join identity1.branches b on b.id = p.branch_id
 where p.idempotency_key like 'seed-%'
 group by b.name order by b.name;

select b.name as branch, e.category, round(sum(e.amount), 2) as total
  from payment.expenses e
  join identity1.branches b on b.id = e.branch_id
 where e.note like '[seed]%'
 group by b.name, e.category order by b.name, e.category;

commit;

-- ===================== ล้าง seed (รันแยกเมื่อต้องการลบ) =====================
-- delete from payment.payments where idempotency_key like 'seed-%';
-- delete from payment.expenses where note like '[seed]%';
