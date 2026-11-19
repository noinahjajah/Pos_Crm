-- ลบข้อมูล seed ทั้งหมดที่สร้างจาก seed_dashboard_real_menus.sql และ seed_dashboard_history.sql
-- ลบเฉพาะแถวที่เป็น seed: pos.orders.order_no ขึ้นต้น 'S' · payments.idempotency_key ขึ้นต้น 'seed-' · expenses.note ขึ้นต้น '[seed]'
-- ข้อมูลจริงไม่ถูกแตะ · รันซ้ำได้ · รันใน Supabase SQL Editor

begin;

-- ดูก่อนว่าจะลบกี่แถว (ถ้าไม่ตรงที่คาด ให้พิมพ์ rollback; แทน commit; ท้ายไฟล์)
select (select count(*) from pos.orders where order_no like 'S%')                as seed_orders,
       (select count(*) from payment.payments where idempotency_key like 'seed-%') as seed_payments,
       (select count(*) from payment.expenses where note like '[seed]%')          as seed_expenses;

alter table pos.approvals disable trigger approvals_no_delete; -- log คำขอปกติห้ามลบ เปิดคืนด้านล่าง

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

alter table pos.approvals enable trigger approvals_no_delete;

-- ตรวจหลังลบ: ต้องเป็น 0 ทั้งหมด
select (select count(*) from pos.orders where order_no like 'S%')                as seed_orders,
       (select count(*) from payment.payments where idempotency_key like 'seed-%') as seed_payments,
       (select count(*) from payment.expenses where note like '[seed]%')          as seed_expenses;

commit;
