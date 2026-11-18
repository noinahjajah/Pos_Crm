-- =====================================================================
-- POS service — functions & triggers
--  - คำนวณยอดบิล (subtotal / ส่วนลดที่อนุมัติ / VAT 7% / total)  1.23, 1.24, 1.30
--  - sync สถานะโต๊ะตามบิล (ว่าง / มีลูกค้า / รอชำระ)            1.8, 1.26
--  - ป้องกันข้อมูลผิด: สาขาไม่ตรง, สั่งอาหารในบิลที่ปิดแล้ว ฯลฯ
--  - approvals ห้ามลบ และแก้ได้แค่ตอนตัดสิน                      1.31
-- =====================================================================

-- ---------------------------------------------------------------------
-- คำนวณยอดบิล
--   vat   = round((subtotal - discount) * 0.07, 2)
--   total = subtotal - discount + vat
-- คำนวณเฉพาะบิลที่ยังไม่จ่าย (open / waiting_payment) บิลที่จ่ายแล้วยอดไม่เปลี่ยน
-- ---------------------------------------------------------------------
create or replace function pos.recalc_order_totals(p_order_id uuid)
returns pos.orders
language plpgsql
as $$
declare
  v_subtotal numeric(12,2);
  v_discount numeric(12,2);
  v_vat      numeric(12,2);
  v_order    pos.orders;
begin
  select coalesce(sum(oi.quantity * (oi.unit_price + coalesce(opt.extra, 0))), 0)
    into v_subtotal
  from pos.order_items oi
  left join lateral (
    select sum(oio.extra_price) as extra
    from pos.order_item_options oio
    where oio.order_item_id = oi.id
  ) opt on true
  where oi.order_id = p_order_id;

  -- ส่วนลดมีผลเฉพาะที่ approved (1.30) · percent คิดจาก subtotal ปัจจุบัน
  select coalesce(sum(
           case a.value_type
             when 'percent' then round(v_subtotal * a.value / 100, 2)
             else a.value
           end), 0)
    into v_discount
  from pos.approvals a
  where a.order_id = p_order_id
    and a.type = 'discount'
    and a.status = 'approved';

  v_discount := least(v_discount, v_subtotal);
  v_vat      := round((v_subtotal - v_discount) * 0.07, 2);

  update pos.orders o
     set subtotal        = v_subtotal,
         discount_amount = v_discount,
         vat_amount      = v_vat,
         total           = v_subtotal - v_discount + v_vat
   where o.id = p_order_id
     and o.status in ('open', 'waiting_payment')
  returning o.* into v_order;

  if v_order.id is null then
    select * into v_order from pos.orders where id = p_order_id;
  end if;
  return v_order;
end;
$$;

-- trigger: order_items เปลี่ยน → คำนวณใหม่
create or replace function pos.trg_order_items_recalc()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform pos.recalc_order_totals(new.order_id);
  end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.order_id <> new.order_id) then
    perform pos.recalc_order_totals(old.order_id);
  end if;
  return null;
end;
$$;

create trigger order_items_recalc
after insert or update or delete on pos.order_items
for each row execute function pos.trg_order_items_recalc();

-- trigger: order_item_options เปลี่ยน → คำนวณใหม่
create or replace function pos.trg_order_item_options_recalc()
returns trigger
language plpgsql
as $$
declare
  v_order_id uuid;
begin
  select order_id into v_order_id
  from pos.order_items
  where id = coalesce(new.order_item_id, old.order_item_id);

  if v_order_id is not null then   -- null = order_item ถูกลบไปพร้อมกัน (cascade)
    perform pos.recalc_order_totals(v_order_id);
  end if;
  return null;
end;
$$;

create trigger order_item_options_recalc
after insert or update or delete on pos.order_item_options
for each row execute function pos.trg_order_item_options_recalc();

-- ---------------------------------------------------------------------
-- กันสั่งอาหารในบิลที่ไม่ใช่ open และ ticket ต้องอยู่สาขาเดียวกับบิล
-- ---------------------------------------------------------------------
create or replace function pos.trg_kitchen_tickets_guard()
returns trigger
language plpgsql
as $$
declare
  v_order pos.orders;
begin
  select * into v_order from pos.orders where id = new.order_id;

  if tg_op = 'INSERT' and v_order.status <> 'open' then
    raise exception 'ORDER_NOT_OPEN: สั่งอาหารได้เฉพาะบิลที่ยังเปิดอยู่ (status = %)', v_order.status
      using errcode = 'P0001';
  end if;
  if new.branch_id <> v_order.branch_id then
    raise exception 'BRANCH_MISMATCH: kitchen_ticket.branch_id ไม่ตรงกับบิล'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger kitchen_tickets_guard
before insert or update of order_id, branch_id on pos.kitchen_tickets
for each row execute function pos.trg_kitchen_tickets_guard();

create or replace function pos.trg_order_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_status pos.order_status;
begin
  select status into v_status from pos.orders where id = new.order_id;
  if v_status <> 'open' then
    raise exception 'ORDER_NOT_OPEN: แก้รายการได้เฉพาะบิลที่ยังเปิดอยู่ (status = %)', v_status
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_items_guard
before insert or update on pos.order_items
for each row execute function pos.trg_order_items_guard();

-- รอบถัดไปของบิล (ใช้ตอนสร้าง kitchen_ticket; unique(order_id, round_no) กันชนกัน)
create or replace function pos.next_round_no(p_order_id uuid)
returns int
language sql
stable
as $$
  select coalesce(max(round_no), 0) + 1 from pos.kitchen_tickets where order_id = p_order_id;
$$;

-- ---------------------------------------------------------------------
-- สถานะโต๊ะ: คำนวณจากบิลที่ใช้โต๊ะอยู่ (order_tables.left_at is null)
--   open → occupied, waiting_payment → waiting_payment, ไม่มีบิล → available
-- ---------------------------------------------------------------------
create or replace function pos.sync_table_status(p_table_id uuid)
returns void
language plpgsql
as $$
declare
  v_order_status pos.order_status;
begin
  select o.status into v_order_status
  from pos.order_tables ot
  join pos.orders o on o.id = ot.order_id
  where ot.table_id = p_table_id
    and ot.left_at is null
  limit 1;

  update pos.dining_tables t
     set status = case v_order_status
                    when 'open'            then 'occupied'::pos.table_status
                    when 'waiting_payment' then 'waiting_payment'::pos.table_status
                    else 'available'::pos.table_status
                  end
   where t.id = p_table_id;
end;
$$;

-- order_tables: เช็กสาขา/โต๊ะ active ก่อนใช้โต๊ะ
create or replace function pos.trg_order_tables_guard()
returns trigger
language plpgsql
as $$
declare
  v_order_branch uuid;
  v_table        pos.dining_tables;
begin
  if new.left_at is not null then
    return new;   -- ปิดการใช้โต๊ะ ไม่ต้องเช็ก
  end if;

  select branch_id into v_order_branch from pos.orders where id = new.order_id;
  select * into v_table from pos.dining_tables where id = new.table_id;

  if v_table.branch_id <> v_order_branch then
    raise exception 'BRANCH_MISMATCH: โต๊ะไม่ได้อยู่สาขาเดียวกับบิล' using errcode = 'P0001';
  end if;
  if not v_table.is_active then
    raise exception 'TABLE_INACTIVE: โต๊ะถูกปิดใช้งาน' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger order_tables_guard
before insert or update on pos.order_tables
for each row execute function pos.trg_order_tables_guard();

create or replace function pos.trg_order_tables_sync()
returns trigger
language plpgsql
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform pos.sync_table_status(new.table_id);
  end if;
  if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.table_id <> new.table_id) then
    perform pos.sync_table_status(old.table_id);
  end if;
  return null;
end;
$$;

create trigger order_tables_sync
after insert or update or delete on pos.order_tables
for each row execute function pos.trg_order_tables_sync();

-- orders: ห้ามย้อนสถานะจากบิลที่ปิดแล้ว + ตั้ง closed_at ให้อัตโนมัติ
create or replace function pos.trg_orders_status_guard()
returns trigger
language plpgsql
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status = 'paid' and new.status <> 'refunded' then
    raise exception 'INVALID_STATUS: บิลที่จ่ายแล้วเปลี่ยนได้เป็น refunded เท่านั้น' using errcode = 'P0001';
  end if;
  if old.status = 'refunded' then
    raise exception 'INVALID_STATUS: บิลที่คืนเงินแล้วเปลี่ยนสถานะไม่ได้' using errcode = 'P0001';
  end if;
  if new.status = 'refunded' and old.status <> 'paid' then
    raise exception 'INVALID_STATUS: คืนเงินได้เฉพาะบิลที่จ่ายแล้ว' using errcode = 'P0001';
  end if;

  if new.status = 'paid' and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end;
$$;

create trigger orders_status_guard
before update of status on pos.orders
for each row execute function pos.trg_orders_status_guard();

-- orders: สถานะเปลี่ยน → paid ปล่อยโต๊ะทั้งหมด (1.26), อื่น ๆ sync สถานะโต๊ะ
create or replace function pos.trg_orders_status_sync()
returns trigger
language plpgsql
as $$
declare
  r record;
begin
  if new.status = old.status then
    return null;
  end if;

  if new.status in ('paid', 'refunded') then
    update pos.order_tables
       set left_at = coalesce(new.closed_at, now())
     where order_id = new.id
       and left_at is null;               -- trigger order_tables_sync จะคืนโต๊ะเป็น available
  else
    for r in select table_id from pos.order_tables where order_id = new.id and left_at is null loop
      perform pos.sync_table_status(r.table_id);
    end loop;
  end if;
  return null;
end;
$$;

create trigger orders_status_sync
after update of status on pos.orders
for each row execute function pos.trg_orders_status_sync();

-- ---------------------------------------------------------------------
-- approvals (1.27–1.31)
-- ---------------------------------------------------------------------
create or replace function pos.trg_approvals_insert_guard()
returns trigger
language plpgsql
as $$
declare
  v_order pos.orders;
begin
  select * into v_order from pos.orders where id = new.order_id;

  if new.branch_id <> v_order.branch_id then
    raise exception 'BRANCH_MISMATCH: approval.branch_id ไม่ตรงกับบิล' using errcode = 'P0001';
  end if;
  if new.type = 'discount' and v_order.status not in ('open', 'waiting_payment') then
    raise exception 'ORDER_ALREADY_PAID: ขอส่วนลดได้เฉพาะบิลที่ยังไม่จ่าย' using errcode = 'P0001';
  end if;
  if new.type = 'refund' and v_order.status <> 'paid' then
    raise exception 'ORDER_NOT_PAID: ขอคืนเงินได้เฉพาะบิลที่จ่ายแล้ว' using errcode = 'P0001';
  end if;

  -- คำขอใหม่ต้องเป็น pending เสมอ
  new.status       := 'pending';
  new.approved_by  := null;
  new.decided_at   := null;
  new.requested_at := coalesce(new.requested_at, now());
  return new;
end;
$$;

create trigger approvals_insert_guard
before insert on pos.approvals
for each row execute function pos.trg_approvals_insert_guard();

-- log ห้ามแก้หลังตัดสิน และแก้ได้เฉพาะฟิลด์การตัดสิน (1.31)
create or replace function pos.trg_approvals_update_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'pending' then
    raise exception 'APPROVAL_DECIDED: คำขอนี้ตัดสินไปแล้ว แก้ไขไม่ได้' using errcode = 'P0001';
  end if;

  if (new.order_id, new.branch_id, new.requested_by, new.type, new.value_type,
      new.value, new.reason, new.requested_at)
     is distinct from
     (old.order_id, old.branch_id, old.requested_by, old.type, old.value_type,
      old.value, old.reason, old.requested_at) then
    raise exception 'APPROVAL_IMMUTABLE: แก้ได้เฉพาะ status / approved_by / decided_at / amount'
      using errcode = 'P0001';
  end if;

  if new.status <> 'pending' and new.decided_at is null then
    new.decided_at := now();
  end if;
  return new;
end;
$$;

create trigger approvals_update_guard
before update on pos.approvals
for each row execute function pos.trg_approvals_update_guard();

create or replace function pos.trg_approvals_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'APPROVAL_UNDELETABLE: ห้ามลบ log คำขออนุมัติ' using errcode = 'P0001';
end;
$$;

create trigger approvals_no_delete
before delete on pos.approvals
for each row execute function pos.trg_approvals_no_delete();

-- ส่วนลดถูกอนุมัติ → คำนวณยอดบิลใหม่ (1.30)
create or replace function pos.trg_approvals_recalc()
returns trigger
language plpgsql
as $$
begin
  if new.type = 'discount' and new.status is distinct from old.status then
    perform pos.recalc_order_totals(new.order_id);
  end if;
  return null;
end;
$$;

create trigger approvals_recalc
after update of status on pos.approvals
for each row execute function pos.trg_approvals_recalc();

-- refund_items: order_item ต้องอยู่ในบิลเดียวกับคำขอ, type = refund, คืนเกินจำนวนที่สั่งไม่ได้
create or replace function pos.trg_refund_items_guard()
returns trigger
language plpgsql
as $$
declare
  v_approval  pos.approvals;
  v_item      pos.order_items;
  v_refunded  int;
begin
  select * into v_approval from pos.approvals where id = new.approval_id;
  select * into v_item     from pos.order_items where id = new.order_item_id;

  if v_approval.type <> 'refund' then
    raise exception 'VALIDATION_ERROR: refund_items ใช้กับคำขอ type = refund เท่านั้น' using errcode = 'P0001';
  end if;
  if v_item.order_id <> v_approval.order_id then
    raise exception 'VALIDATION_ERROR: รายการไม่ได้อยู่ในบิลของคำขอนี้' using errcode = 'P0001';
  end if;

  -- จำนวนที่คืนไปแล้ว (เฉพาะคำขอที่ไม่ถูกปฏิเสธ) + ครั้งนี้ ต้องไม่เกินที่สั่ง
  select coalesce(sum(ri.quantity), 0) into v_refunded
  from pos.refund_items ri
  join pos.approvals a on a.id = ri.approval_id
  where ri.order_item_id = new.order_item_id
    and a.status <> 'rejected'
    and ri.id <> new.id;

  if v_refunded + new.quantity > v_item.quantity then
    raise exception 'VALIDATION_ERROR: คืนเกินจำนวนที่สั่ง (สั่ง %, คืนแล้ว %, ขอคืน %)',
      v_item.quantity, v_refunded, new.quantity using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger refund_items_guard
before insert or update on pos.refund_items
for each row execute function pos.trg_refund_items_guard();
