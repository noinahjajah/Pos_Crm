-- ยกเลิกรายการอาหารหลังส่งเข้าครัว (ทีละรายการ ยกเลิกบางจำนวนได้)
-- - ยกเลิกได้เมื่อบิลยังไม่จ่าย (open / waiting_payment) · staff/manager ยกเลิกเองได้ ไม่ต้องขออนุมัติ
-- - พนักงานเลือกเองว่า "ยังไม่ได้ทำ" (cooked = false → pos คืนสต็อกที่ catalog) หรือ "ทำไปแล้ว" (cooked = true → ไม่คืนสต็อก)
-- - order_items.quantity = จำนวนที่สั่งตอนแรก (ไม่แก้) · cancelled_quantity = จำนวนที่ยกเลิกแล้ว
--   ยอดบิล / เรียกเก็บเงิน / คืนเงิน / เมนูขายดี นับเฉพาะ quantity - cancelled_quantity
-- - ยกเลิกครบทุกรายการแล้ว → ยกเลิกทั้งบิลได้ (cancel_order) แม้อยู่ในสถานะรอชำระ
-- รันซ้ำได้

-- ===================== ตาราง =====================
alter table pos.order_items add column if not exists cancelled_quantity integer not null default 0;
alter table pos.order_items drop constraint if exists order_items_cancelled_quantity_check;
alter table pos.order_items add constraint order_items_cancelled_quantity_check
  check (cancelled_quantity between 0 and quantity);

-- ประวัติการยกเลิก (ห้ามแก้/ลบ) · cooked = ทำไปแล้ว (ของเสีย ไม่คืนสต็อก)
create table if not exists pos.order_item_cancellations (
  id uuid not null default gen_random_uuid(),
  order_item_id uuid not null,
  quantity integer not null,
  cooked boolean not null,
  reason text,
  cancelled_by uuid not null,
  cancelled_at timestamptz not null default now(),
  constraint order_item_cancellations_pkey primary key (id),
  constraint order_item_cancellations_item_fkey foreign key (order_item_id) references pos.order_items (id),
  constraint order_item_cancellations_quantity_check check (quantity between 1 and 999),
  constraint order_item_cancellations_reason_check check (reason is null or length(reason) <= 200)
);
create index if not exists order_item_cancellations_item_idx on pos.order_item_cancellations using btree (order_item_id);

alter table pos.order_item_cancellations enable row level security;
revoke all on pos.order_item_cancellations from public, anon, authenticated;
grant all on pos.order_item_cancellations to service_role;

create or replace function pos.tg_order_item_cancellations_immutable()
 returns trigger
 language plpgsql
as $function$
begin
  raise exception 'POS:CANCELLATION_IMMUTABLE';
end $function$;

drop trigger if exists order_item_cancellations_immutable on pos.order_item_cancellations;
create trigger order_item_cancellations_immutable before update or delete on pos.order_item_cancellations
  for each row execute function pos.tg_order_item_cancellations_immutable();

-- ===================== คำนวณยอด: ไม่นับจำนวนที่ยกเลิก =====================
create or replace function pos.recalc_order_totals(p_order_id uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  v_subtotal numeric(12, 2);
  v_discount numeric(12, 2);
  v_vat numeric(12, 2);
  o pos.orders;
begin
  select coalesce(sum((oi.quantity - oi.cancelled_quantity) * (oi.unit_price + coalesce(x.extra, 0))), 0)
    into v_subtotal
    from pos.order_items oi
    left join lateral (select sum(extra_price) as extra from pos.order_item_options where order_item_id = oi.id) x on true
   where oi.order_id = p_order_id;

  select coalesce(sum(case a.value_type when 'percent' then round(v_subtotal * a.value / 100, 2) else a.value end), 0)
    into v_discount
    from pos.approvals a
   where a.order_id = p_order_id and a.type = 'discount' and a.status = 'approved';

  v_discount := least(v_discount, v_subtotal);
  v_vat := round((v_subtotal - v_discount) * 0.07, 2);

  update pos.orders
     set subtotal = v_subtotal, discount_amount = v_discount, vat_amount = v_vat, total = v_subtotal - v_discount + v_vat
   where id = p_order_id and status in ('open', 'waiting_payment')
  returning * into o;

  if o.id is null then select * into o from pos.orders where id = p_order_id; end if;
  return o;
end $function$;

-- ===================== guard =====================
-- เพิ่ม/แก้รายการได้เฉพาะบิลที่เปิดอยู่ · ยกเว้นแก้แค่ cancelled_quantity ตอนบิลรอชำระ
create or replace function pos.tg_order_items_guard()
 returns trigger
 language plpgsql
as $function$
declare
  v_status pos.order_status;
begin
  select status into v_status from pos.orders where id = new.order_id;
  if tg_op = 'UPDATE' and v_status = 'waiting_payment'
     and (to_jsonb(new) - 'cancelled_quantity') = (to_jsonb(old) - 'cancelled_quantity') then
    return new;
  end if;
  if v_status is distinct from 'open' then
    raise exception 'POS:ORDER_NOT_OPEN';
  end if;
  return new;
end $function$;

-- เพิ่ม waiting_payment → cancelled (ยกเลิกครบทุกรายการตอนรอชำระ)
create or replace function pos.tg_orders_status_guard()
 returns trigger
 language plpgsql
as $function$
begin
  if new.status = old.status then return new; end if;
  if not (
       (old.status = 'open' and new.status in ('waiting_payment', 'merged', 'cancelled'))
    or (old.status = 'waiting_payment' and new.status in ('open', 'paid', 'merged', 'cancelled'))
    or (old.status = 'paid' and new.status = 'refunded')
  ) then
    raise exception 'POS:INVALID_STATUS % -> %', old.status, new.status;
  end if;
  if new.status in ('paid', 'refunded', 'merged', 'cancelled') and new.closed_at is null then
    new.closed_at := now();
  end if;
  return new;
end $function$;

-- ===================== ยกเลิกรายการ =====================
-- ล็อกบิลก่อนรายการ (ลำดับเดียวกับ add_ticket / merge_tables) กันยกเลิกพร้อมเรียกเก็บเงิน/รวมโต๊ะ
create or replace function pos.cancel_order_item(p_order_id uuid, p_item_id uuid, p_quantity integer, p_cooked boolean, p_reason text, p_actor uuid)
 returns pos.order_item_cancellations
 language plpgsql
as $function$
declare
  o pos.orders;
  it pos.order_items;
  c pos.order_item_cancellations;
begin
  if p_quantity is null or p_quantity < 1 or p_cooked is null then raise exception 'POS:BAD_INPUT'; end if;
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status not in ('open', 'waiting_payment') then raise exception 'POS:ORDER_ALREADY_CLOSED'; end if;

  select * into it from pos.order_items where id = p_item_id and order_id = o.id for update;
  if not found then raise exception 'POS:ITEM_NOT_IN_ORDER'; end if;
  if it.cancelled_quantity + p_quantity > it.quantity then raise exception 'POS:CANCEL_QTY_EXCEEDED'; end if;

  insert into pos.order_item_cancellations (order_item_id, quantity, cooked, reason, cancelled_by)
  values (it.id, p_quantity, p_cooked, nullif(trim(both from coalesce(p_reason, '')), ''), p_actor)
  returning * into c;

  -- trigger order_items_recalc คำนวณยอดบิลใหม่ให้
  update pos.order_items set cancelled_quantity = cancelled_quantity + p_quantity where id = it.id;
  return c;
end $function$;

-- ยกเลิกทั้งบิล: บิลที่ยังไม่ได้สั่ง หรือยกเลิกครบทุกรายการแล้ว (open / waiting_payment) → โต๊ะว่าง
create or replace function pos.cancel_order(p_order_id uuid, p_actor uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status not in ('open', 'waiting_payment') then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  if exists (select 1 from pos.order_items where order_id = o.id and quantity > cancelled_quantity) then
    raise exception 'POS:ORDER_HAS_ITEMS';
  end if;
  if exists (select 1 from pos.approvals where order_id = o.id and status = 'pending') then
    raise exception 'POS:PENDING_APPROVAL';
  end if;
  update pos.orders set status = 'cancelled', closed_by = p_actor where id = o.id returning * into o;
  return o;
end $function$;

-- เรียกเก็บเงินได้เมื่อยังมีรายการที่ไม่ได้ยกเลิก
create or replace function pos.request_payment(p_order_id uuid)
 returns pos.orders
 language plpgsql
as $function$
declare
  o pos.orders;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if o.status = 'waiting_payment' then return o; end if;
  if o.status <> 'open' then raise exception 'POS:ORDER_NOT_OPEN'; end if;
  if not exists (select 1 from pos.order_items where order_id = o.id and quantity > cancelled_quantity) then
    raise exception 'POS:ORDER_EMPTY';
  end if;
  perform pos.recalc_order_totals(o.id);
  update pos.orders set status = 'waiting_payment' where id = o.id returning * into o;
  return o;
end $function$;

-- ===================== คืนเงิน: คืนได้ไม่เกินจำนวนที่ไม่ได้ยกเลิก =====================
create or replace function pos.create_approval(p_order_id uuid, p_actor uuid, p_type pos.approval_type, p_value_type pos.approval_value_type, p_value numeric, p_reason text, p_refund_items jsonb default null::jsonb)
 returns pos.approvals
 language plpgsql
as $function$
declare
  o pos.orders;
  a pos.approvals;
  v_amount numeric(12, 2);
  v_ratio numeric;
  v_remaining numeric(12, 2);
  e jsonb;
  it pos.order_items;
  v_unit numeric;
  v_qty int;
  v_done int;
begin
  select * into o from pos.orders where id = p_order_id for update;
  if not found then raise exception 'POS:ORDER_NOT_FOUND'; end if;
  if p_value is null or p_value <= 0 then raise exception 'POS:BAD_INPUT'; end if;

  if p_type = 'discount' then
    if o.status not in ('open', 'waiting_payment') then raise exception 'POS:ORDER_ALREADY_PAID'; end if;
    v_amount := case p_value_type when 'percent' then round(o.subtotal * p_value / 100, 2) else p_value end;
    if v_amount > o.subtotal - o.discount_amount then raise exception 'POS:DISCOUNT_TOO_LARGE'; end if;
  else
    if o.status not in ('paid', 'refunded') then raise exception 'POS:ORDER_NOT_PAID'; end if;
    if p_value_type <> 'amount' then raise exception 'POS:BAD_INPUT'; end if;
    -- ยอดที่ยังคืนได้ = จ่าย − คืนแล้ว − คำขอคืนเงินที่อนุมัติแล้วแต่ยังไม่ได้คืน
    v_remaining := o.total - o.refunded_amount
      - coalesce((select sum(amount) from pos.approvals where order_id = o.id and type = 'refund' and status = 'approved' and refunded_at is null), 0);
    if p_refund_items is null or jsonb_array_length(p_refund_items) = 0 then
      v_amount := v_remaining;
    else
      v_ratio := case when o.subtotal > 0 then o.total / o.subtotal else 1 end;
      v_amount := 0;
      for e in select * from jsonb_array_elements(p_refund_items) loop
        select * into it from pos.order_items where id = (e ->> 'order_item_id')::uuid and order_id = o.id;
        if not found then raise exception 'POS:ITEM_NOT_IN_ORDER'; end if;
        v_qty := (e ->> 'quantity')::int;
        select coalesce(sum(ri.quantity), 0) into v_done
          from pos.refund_items ri join pos.approvals ap on ap.id = ri.approval_id
         where ri.order_item_id = it.id and ap.status <> 'rejected';
        if v_qty < 1 or v_done + v_qty > it.quantity - it.cancelled_quantity then raise exception 'POS:REFUND_QTY_EXCEEDED'; end if;
        select it.unit_price + coalesce(sum(extra_price), 0) into v_unit from pos.order_item_options where order_item_id = it.id;
        v_amount := v_amount + v_unit * v_qty;
      end loop;
      v_amount := round(v_amount * v_ratio, 2);
    end if;
    v_amount := least(v_amount, v_remaining);
    if v_amount <= 0 then raise exception 'POS:NOTHING_TO_REFUND'; end if;
  end if;

  begin
    insert into pos.approvals (order_id, branch_id, requested_by, type, value_type, value, amount, reason)
    values (o.id, o.branch_id, p_actor, p_type, p_value_type, case when p_type = 'refund' then v_amount else p_value end, v_amount, trim(both from p_reason))
    returning * into a;
  exception when unique_violation then
    raise exception 'POS:APPROVAL_PENDING_EXISTS';
  end;

  if p_type = 'refund' and p_refund_items is not null and jsonb_array_length(p_refund_items) > 0 then
    insert into pos.refund_items (approval_id, order_item_id, quantity, amount)
    select a.id, oi.id, (x ->> 'quantity')::int,
           round((oi.unit_price + coalesce((select sum(extra_price) from pos.order_item_options where order_item_id = oi.id), 0))
                 * (x ->> 'quantity')::int * case when o.subtotal > 0 then o.total / o.subtotal else 1 end, 2)
      from jsonb_array_elements(p_refund_items) x
      join pos.order_items oi on oi.id = (x ->> 'order_item_id')::uuid;
  end if;
  return a;
end $function$;

-- ===================== เมนูขายดี: ไม่นับจำนวนที่ยกเลิก =====================
create or replace function pos.top_menus(p_from date, p_to date, p_branch uuid default null::uuid, p_limit integer default 5)
 returns table (menu_id uuid, menu_name text, quantity bigint, amount numeric)
 language sql
 stable
as $function$
  select oi.menu_id,
         (array_agg(oi.menu_name order by oi.created_at desc))[1] as menu_name,
         sum(oi.quantity - oi.cancelled_quantity) as quantity,
         round(sum((oi.quantity - oi.cancelled_quantity) * (oi.unit_price + coalesce(x.extra, 0))), 2) as amount
    from pos.order_items oi
    join pos.orders o on o.id = oi.order_id
    left join lateral (select sum(extra_price) as extra from pos.order_item_options where order_item_id = oi.id) x on true
   where o.status in ('paid', 'refunded')
     and oi.quantity > oi.cancelled_quantity
     and (o.closed_at at time zone 'Asia/Bangkok')::date between p_from and p_to
     and (p_branch is null or o.branch_id = p_branch)
   group by oi.menu_id
   order by 3 desc, 4 desc
   limit greatest(1, least(p_limit, 50));
$function$;

revoke all on function pos.cancel_order_item(uuid, uuid, integer, boolean, text, uuid) from public, anon, authenticated;
grant execute on function pos.cancel_order_item(uuid, uuid, integer, boolean, text, uuid) to service_role;

-- ===================== catalog: คืนสต็อกตามรายการที่ส่งมา (ใช้ตอนยกเลิกรายการ) =====================
-- ไม่ส่ง items + ส่ง reference → คืนทั้งหมดที่เคยตัดด้วย reference นั้น (สั่งไม่สำเร็จ · เหมือนเดิม)
-- ส่ง items → คืนตาม items · reference ใช้กันคืนซ้ำ (pos ใช้ 'cancel:<id การยกเลิก>')
create or replace function catalog.restore_stocks(p_branch_id uuid, p_items jsonb default '[]'::jsonb, p_reference text default null::text, p_actor uuid default null::uuid)
 returns jsonb
 language plpgsql
as $function$
declare
  v_items jsonb := '[]'::jsonb;
  v_by_items boolean := jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 0;
  r record;
begin
  if p_reference is not null then
    perform pg_advisory_xact_lock(hashtext('catalog.stock_ref:' || p_reference));
    if exists (select 1 from catalog.stock_movements where reference = p_reference and type = 'restore') then
      return jsonb_build_object('ok', true, 'replayed', true, 'items', '[]'::jsonb);
    end if;
  end if;

  for r in
    select x.menu_id, x.qty from (
      select menu_id, -sum(quantity_change)::int as qty
        from catalog.stock_movements
       where not v_by_items and p_reference is not null and reference = p_reference and type = 'deduct'
       group by menu_id
      union all
      select (e ->> 'menu_id')::uuid, sum((e ->> 'quantity')::int)::int
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
       where v_by_items
       group by 1
    ) x
    join catalog.stocks s on s.menu_id = x.menu_id and s.branch_id = p_branch_id
    order by x.menu_id
  loop
    update catalog.stocks set quantity = quantity + r.qty, updated_at = now() where menu_id = r.menu_id;
    insert into catalog.stock_movements (branch_id, menu_id, type, quantity_change, quantity_after, reference, created_by)
    select branch_id, menu_id, 'restore', r.qty, quantity, p_reference, p_actor from catalog.stocks where menu_id = r.menu_id;
    select v_items || jsonb_build_object('menu_id', s.menu_id, 'quantity', s.quantity, 'is_available', s.is_available)
      into v_items from catalog.stocks s where s.menu_id = r.menu_id;
  end loop;

  return jsonb_build_object('ok', true, 'replayed', false, 'items', v_items);
end $function$;

notify pgrst, 'reload schema';
