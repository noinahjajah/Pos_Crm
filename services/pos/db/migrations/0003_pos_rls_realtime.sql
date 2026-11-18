-- =====================================================================
-- POS service — RLS + Supabase Realtime (ข้อ 6 ในสเปก)
--
--  - service pos ต่อ DB ด้วย service_role/postgres → bypass RLS
--  - client (JWT ผู้ใช้ = role `authenticated`) เห็นได้แค่ 2 ตารางที่ใช้ Realtime:
--      kitchen_tickets : จอครัว — แถวที่ branch_id ตรง claim (owner เห็นทุกสาขา)
--      approvals       : แจ้งเตือนคำขอ — manager สาขาตัวเอง, owner ทุกสาขา,
--                        staff เห็นเฉพาะคำขอของตัวเอง
--  - Realtime ใช้แค่ "แจ้ง" แล้ว client ไปดึงรายละเอียดผ่าน gateway
--  - claim `user_role`, `branch_id` ใส่โดย custom access token hook ของ Dev 1
-- =====================================================================

-- helper อ่าน claim จาก JWT
create or replace function pos.jwt_role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'user_role', '');
$$;

create or replace function pos.jwt_branch_id()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'branch_id', '')::uuid;
$$;

-- เปิด RLS ทุกตาราง (ไม่มี policy = authenticated/anon มองไม่เห็น)
alter table pos.dining_tables      enable row level security;
alter table pos.orders             enable row level security;
alter table pos.order_tables       enable row level security;
alter table pos.kitchen_tickets    enable row level security;
alter table pos.order_items        enable row level security;
alter table pos.order_item_options enable row level security;
alter table pos.approvals          enable row level security;
alter table pos.refund_items       enable row level security;

-- สิทธิ์ระดับ schema/table
grant usage on schema pos to service_role, authenticated;
grant all on all tables    in schema pos to service_role;
grant all on all sequences in schema pos to service_role;
grant execute on all functions in schema pos to service_role;
grant execute on function pos.jwt_role(), pos.jwt_branch_id() to authenticated;

grant select on pos.kitchen_tickets to authenticated;
grant select on pos.approvals       to authenticated;

-- ---------------------------------------------------------------------
-- kitchen_tickets — จอครัว (staff / manager ของสาขา, owner ทุกสาขา)
-- ---------------------------------------------------------------------
create policy kitchen_tickets_select_branch
on pos.kitchen_tickets
for select
to authenticated
using (
  (pos.jwt_role() in ('staff', 'manager') and branch_id = pos.jwt_branch_id())
  or pos.jwt_role() = 'owner'
);

-- ---------------------------------------------------------------------
-- approvals — แจ้งเตือนคำขออนุมัติ (1.29)
-- ---------------------------------------------------------------------
create policy approvals_select_manager_owner
on pos.approvals
for select
to authenticated
using (
  (pos.jwt_role() = 'manager' and branch_id = pos.jwt_branch_id())
  or pos.jwt_role() = 'owner'
);

create policy approvals_select_own_request
on pos.approvals
for select
to authenticated
using (
  pos.jwt_role() = 'staff' and requested_by = auth.uid()
);

-- ---------------------------------------------------------------------
-- Realtime: เพิ่มตารางเข้า publication ของ Supabase
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table pos.kitchen_tickets, pos.approvals;
