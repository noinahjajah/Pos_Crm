-- VAT 7% และส่วนลดแบบเปอร์เซ็นต์ปัดเป็นบาทเต็ม (ปัดตามปกติ: .50 ขึ้นไปปัดขึ้น)
-- ราคาเมนูเป็นบาทเต็ม → ยอดบิล (total) เป็นบาทเต็มเสมอ ไม่มีสตางค์
-- เช่น 315 → VAT 22.05 → 22 · total 337
-- บิลที่จ่ายแล้ว/คืนเงินแล้วไม่เปลี่ยน (recalc แก้เฉพาะบิล open / waiting_payment)

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

  select coalesce(sum(case a.value_type when 'percent' then round(v_subtotal * a.value / 100, 0) else a.value end), 0)
    into v_discount
    from pos.approvals a
   where a.order_id = p_order_id and a.type = 'discount' and a.status = 'approved';

  v_discount := least(v_discount, v_subtotal);
  v_vat := round((v_subtotal - v_discount) * 0.07, 0);

  update pos.orders
     set subtotal = v_subtotal, discount_amount = v_discount, vat_amount = v_vat, total = v_subtotal - v_discount + v_vat
   where id = p_order_id and status in ('open', 'waiting_payment')
  returning * into o;

  if o.id is null then select * into o from pos.orders where id = p_order_id; end if;
  return o;
end $function$;

-- คำขอส่วนลด % / คืนเงินบางรายการ: ยอดเป็นบาทเต็มให้ตรงกับบิล (เหมือนเดิมทุกอย่าง ยกเว้น round(..., 0))
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
    v_amount := case p_value_type when 'percent' then round(o.subtotal * p_value / 100, 0) else p_value end;
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
      v_amount := round(v_amount * v_ratio, 0);
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
                 * (x ->> 'quantity')::int * case when o.subtotal > 0 then o.total / o.subtotal else 1 end, 0)
      from jsonb_array_elements(p_refund_items) x
      join pos.order_items oi on oi.id = (x ->> 'order_item_id')::uuid;
  end if;
  return a;
end $function$;

-- คิดยอดบิลที่ยังไม่จ่ายใหม่ด้วยสูตรใหม่
select pos.recalc_order_totals(id) from pos.orders where status in ('open', 'waiting_payment');
