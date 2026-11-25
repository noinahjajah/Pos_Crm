-- รวมโต๊ะเป็นบิลเดียว (1.12) · โต๊ะว่าง = เพิ่มเข้าบิล · โต๊ะที่มีบิลอื่น = ย้ายตั๋วและรายการเข้าบิลหลัก แล้วปล่อยโต๊ะนั้นให้ว่าง
-- บิลเดิมเปลี่ยนเป็น merged · นับเวลาเปิดจากบิลที่เปิดก่อน · จำนวนลูกค้ารวมกัน
create or replace function pos.merge_tables(p_order_id uuid, p_table_ids uuid[])
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
  src pos.orders;
  t pos.dining_tables;
  v_src uuid;
  v_round int;
  k record;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;

  for t in select * from pos.dining_tables where id = any (p_table_ids) order by id for update loop
    if t.branch_id <> o.branch_id or not t.is_active then raise exception 'POS:TABLE_NOT_FOUND'; end if;
    select order_id into v_src from pos.order_tables where table_id = t.id and left_at is null;
    if v_src = o.id then continue; end if;

    if v_src is null then
      insert into pos.order_tables (order_id, table_id) values (o.id, t.id);
      continue;
    end if;

    select * into src from pos.orders where id = v_src for update;
    if src.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
    -- คำขอเป็น log ห้ามแก้ (1.31) ย้ายไปบิลใหม่ไม่ได้ → บิลที่มีคำขอส่วนลดค้างหรืออนุมัติแล้ว ห้ามรวม
    if exists (select 1 from pos.approvals where order_id = src.id and status <> 'rejected') then
      raise exception 'POS:MERGE_HAS_APPROVAL';
    end if;

    -- ย้ายตั๋วต่อท้ายรอบของบิลหลัก (order_items ตามไปด้วย foreign key on update cascade)
    select coalesce(max(round_no), 0) into v_round from pos.kitchen_tickets where order_id = o.id;
    for k in select id from pos.kitchen_tickets where order_id = src.id order by round_no loop
      v_round := v_round + 1;
      update pos.kitchen_tickets set order_id = o.id, round_no = v_round where id = k.id;
    end loop;

    -- โต๊ะของบิลที่ถูกรวมถูกปล่อยว่าง (ไม่ผูกเข้าบิลหลัก) · บิลหลักยังอยู่ที่โต๊ะแรกที่เลือก
    update pos.order_tables set left_at = now() where order_id = src.id and left_at is null;

    update pos.orders
       set guest_count = guest_count + src.guest_count,
           opened_at = least(opened_at, src.opened_at)
     where id = o.id;
    update pos.orders set status = 'merged', merged_into = o.id where id = src.id;
  end loop;

  return pos.recalc_order_totals(o.id);
end $function$;

