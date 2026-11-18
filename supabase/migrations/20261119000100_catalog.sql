-- catalog: หมวดหมู่ เมนู กลุ่มตัวเลือก สต็อก (Dev 2)
-- สร้างจากโครงสร้างจริงของฐานข้อมูล · รันซ้ำได้
-- branch_id อ้างถึง identity1.branches แต่ไม่มี foreign key ข้าม schema (ตรวจผ่าน identity service)
-- เปิด RLS โดยไม่มี policy → เข้าถึงได้เฉพาะ service_role ผ่าน catalog service

create schema if not exists catalog;

do $$ begin
  create type catalog.stock_movement_type as enum ('deduct', 'restore', 'set', 'add');
exception when duplicate_object then null; end $$;

-- ===================== ตาราง =====================
create table if not exists catalog.categories (
  id uuid not null default gen_random_uuid(),
  name text not null,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  constraint categories_pkey primary key (id),
  constraint categories_name_check check (length(trim(both from name)) >= 1 and length(trim(both from name)) <= 100)
);

create table if not exists catalog.menus (
  id uuid not null default gen_random_uuid(),
  category_id uuid not null,
  branch_id uuid not null,
  name text not null,
  description text,
  price numeric(10, 2) not null,
  image_url text,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint menus_pkey primary key (id),
  constraint menus_category_id_fkey foreign key (category_id) references catalog.categories (id),
  constraint menus_name_check check (length(trim(both from name)) >= 1 and length(trim(both from name)) <= 100),
  constraint menus_price_check check (price >= 0::numeric)
);

create table if not exists catalog.option_groups (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  name text not null,
  is_required boolean not null default false,
  max_select integer not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint option_groups_pkey primary key (id),
  constraint option_groups_max_select_check check (max_select >= 1 and max_select <= 20),
  constraint option_groups_name_check check (length(trim(both from name)) >= 1 and length(trim(both from name)) <= 100)
);

create table if not exists catalog.options (
  id uuid not null default gen_random_uuid(),
  option_group_id uuid not null,
  name text not null,
  extra_price numeric(10, 2) not null default 0,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  constraint options_pkey primary key (id),
  constraint options_option_group_id_fkey foreign key (option_group_id) references catalog.option_groups (id) on delete cascade,
  constraint options_extra_price_check check (extra_price >= 0::numeric),
  constraint options_name_check check (length(trim(both from name)) >= 1 and length(trim(both from name)) <= 100)
);

create table if not exists catalog.menu_option_groups (
  menu_id uuid not null,
  option_group_id uuid not null,
  sort_order integer not null default 0,
  constraint menu_option_groups_pkey primary key (menu_id, option_group_id),
  constraint menu_option_groups_menu_id_fkey foreign key (menu_id) references catalog.menus (id) on delete cascade,
  constraint menu_option_groups_option_group_id_fkey foreign key (option_group_id) references catalog.option_groups (id) on delete cascade
);

create table if not exists catalog.stocks (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  menu_id uuid not null,
  quantity integer not null default 0,
  is_available boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint stocks_pkey primary key (id),
  constraint stocks_menu_id_key unique (menu_id),
  constraint stocks_menu_id_fkey foreign key (menu_id) references catalog.menus (id) on delete cascade,
  constraint stocks_quantity_check check (quantity >= 0),
  constraint stocks_open_needs_quantity check (not is_available or quantity > 0)
);

create table if not exists catalog.stock_movements (
  id uuid not null default gen_random_uuid(),
  branch_id uuid not null,
  menu_id uuid not null,
  type catalog.stock_movement_type not null,
  quantity_change integer not null,
  quantity_after integer not null,
  reference text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint stock_movements_pkey primary key (id),
  constraint stock_movements_menu_id_fkey foreign key (menu_id) references catalog.menus (id) on delete cascade
);

-- ===================== index =====================
create unique index if not exists categories_name_uk on catalog.categories using btree (lower(name));
create index if not exists menu_option_groups_group_idx on catalog.menu_option_groups using btree (option_group_id);
create index if not exists menus_branch_idx on catalog.menus using btree (branch_id) where (not is_deleted);
create index if not exists menus_category_idx on catalog.menus using btree (category_id);
create index if not exists option_groups_branch_idx on catalog.option_groups using btree (branch_id);
create index if not exists options_group_idx on catalog.options using btree (option_group_id);
create index if not exists stock_movements_menu_idx on catalog.stock_movements using btree (menu_id, created_at desc);
create unique index if not exists stock_movements_ref_uk on catalog.stock_movements using btree (reference, type, menu_id) where (reference is not null);
create index if not exists stocks_branch_idx on catalog.stocks using btree (branch_id);

-- ===================== trigger =====================
create or replace function catalog.tg_touch_updated_at()
 returns trigger
 language plpgsql
as $function$
begin
  new.updated_at := now();
  return new;
end $function$;

-- สร้างเมนูแล้วมีแถวสต็อก 0 ปิดขายให้อัตโนมัติ
create or replace function catalog.tg_menu_create_stock()
 returns trigger
 language plpgsql
as $function$
begin
  insert into catalog.stocks (branch_id, menu_id, quantity, is_available)
  values (new.branch_id, new.id, 0, false)
  on conflict (menu_id) do nothing;
  return new;
end $function$;

drop trigger if exists menus_touch on catalog.menus;
create trigger menus_touch before update on catalog.menus
  for each row execute function catalog.tg_touch_updated_at();

drop trigger if exists menu_create_stock on catalog.menus;
create trigger menu_create_stock after insert on catalog.menus
  for each row execute function catalog.tg_menu_create_stock();

-- ===================== ฟังก์ชันที่ service เรียก =====================
-- ตั้งหรือเติมสต็อก · เหลือ 0 ปิดขาย · เติมจาก 0 ไม่เปิดขายให้
create or replace function catalog.adjust_stock(p_menu_id uuid, p_quantity integer default null::integer, p_add integer default null::integer, p_actor uuid default null::uuid)
 returns catalog.stocks
 language plpgsql
as $function$
declare
  s catalog.stocks;
  v_next int;
  v_change int;
begin
  select * into s from catalog.stocks where menu_id = p_menu_id for update;
  if not found then raise exception 'CATALOG:NOT_FOUND'; end if;
  v_next := coalesce(p_quantity, s.quantity + p_add);
  if v_next is null then raise exception 'CATALOG:BAD_INPUT'; end if;
  if v_next < 0 then raise exception 'CATALOG:NEGATIVE_STOCK'; end if;
  v_change := v_next - s.quantity;

  update catalog.stocks
     set quantity = v_next,
         is_available = case when v_next = 0 then false else is_available end,
         updated_at = now()
   where menu_id = p_menu_id
  returning * into s;

  insert into catalog.stock_movements (branch_id, menu_id, type, quantity_change, quantity_after, created_by)
  values (s.branch_id, s.menu_id,
          (case when p_quantity is not null then 'set' else 'add' end)::catalog.stock_movement_type,
          v_change, v_next, p_actor);
  return s;
end $function$;

-- คัดลอกเมนูพร้อมกลุ่มตัวเลือกไปสาขาอื่น
create or replace function catalog.copy_menu(p_menu_id uuid, p_to_branch uuid)
 returns uuid
 language plpgsql
as $function$
declare
  src     catalog.menus;
  v_new   uuid;
  v_group uuid;
  g record;
begin
  select * into src from catalog.menus where id = p_menu_id and not is_deleted;
  if not found then raise exception 'CATALOG:NOT_FOUND'; end if;
  if src.branch_id = p_to_branch then raise exception 'CATALOG:SAME_BRANCH'; end if;

  insert into catalog.menus (category_id, branch_id, name, description, price, image_url)
  values (src.category_id, p_to_branch, src.name, src.description, src.price, src.image_url)
  returning id into v_new;

  for g in
    select og.*, mog.sort_order as link_order
      from catalog.menu_option_groups mog
      join catalog.option_groups og on og.id = mog.option_group_id
     where mog.menu_id = p_menu_id and og.is_active
     order by mog.sort_order
  loop
    insert into catalog.option_groups (branch_id, name, is_required, max_select)
    values (p_to_branch, g.name, g.is_required, g.max_select)
    returning id into v_group;

    insert into catalog.options (option_group_id, name, extra_price, sort_order)
    select v_group, o.name, o.extra_price, o.sort_order
      from catalog.options o where o.option_group_id = g.id and o.is_active;

    insert into catalog.menu_option_groups (menu_id, option_group_id, sort_order)
    values (v_new, v_group, g.link_order);
  end loop;

  return v_new;
end $function$;

-- ตัดสต็อกตอนสั่ง: ตัดครบทุกรายการหรือไม่ตัดเลย · reference เดิมเรียกซ้ำได้
create or replace function catalog.deduct_stocks(p_branch_id uuid, p_items jsonb, p_reference text default null::text, p_actor uuid default null::uuid)
 returns jsonb
 language plpgsql
as $function$
declare
  v_problems jsonb := '[]'::jsonb;
  v_items    jsonb := '[]'::jsonb;
  r record;
begin
  if p_reference is not null then
    perform pg_advisory_xact_lock(hashtext('catalog.stock_ref:' || p_reference));
    if exists (select 1 from catalog.stock_movements where reference = p_reference and type = 'deduct') then
      select coalesce(jsonb_agg(jsonb_build_object('menu_id', s.menu_id, 'quantity', s.quantity, 'is_available', s.is_available)), '[]')
        into v_items
        from catalog.stocks s
       where s.menu_id in (select menu_id from catalog.stock_movements where reference = p_reference and type = 'deduct');
      return jsonb_build_object('ok', true, 'replayed', true, 'items', v_items);
    end if;
  end if;

  -- ล็อกแถวสต็อกเรียงตาม menu_id กัน deadlock
  perform 1 from catalog.stocks
   where menu_id in (select (e ->> 'menu_id')::uuid from jsonb_array_elements(p_items) e)
   order by menu_id
   for update;

  for r in
    select w.menu_id, w.qty, m.name, m.branch_id, m.is_deleted, s.quantity, s.is_available
      from (select (e ->> 'menu_id')::uuid as menu_id, sum((e ->> 'quantity')::int) as qty
              from jsonb_array_elements(p_items) e group by 1) w
      left join catalog.menus m on m.id = w.menu_id
      left join catalog.stocks s on s.menu_id = w.menu_id
     order by w.menu_id
  loop
    if r.name is null or r.is_deleted or r.branch_id <> p_branch_id or r.quantity is null then
      v_problems := v_problems || jsonb_build_object('menu_id', r.menu_id, 'name', r.name, 'reason', 'MENU_NOT_FOUND', 'requested', r.qty, 'available', 0);
    elsif not r.is_available then
      v_problems := v_problems || jsonb_build_object('menu_id', r.menu_id, 'name', r.name, 'reason', 'MENU_UNAVAILABLE', 'requested', r.qty, 'available', r.quantity);
    elsif r.quantity < r.qty then
      v_problems := v_problems || jsonb_build_object('menu_id', r.menu_id, 'name', r.name, 'reason', 'STOCK_NOT_ENOUGH', 'requested', r.qty, 'available', r.quantity);
    end if;
  end loop;

  if jsonb_array_length(v_problems) > 0 then
    return jsonb_build_object('ok', false, 'items', v_problems);
  end if;

  for r in
    select (e ->> 'menu_id')::uuid as menu_id, sum((e ->> 'quantity')::int) as qty
      from jsonb_array_elements(p_items) e group by 1 order by 1
  loop
    update catalog.stocks
       set quantity = quantity - r.qty,
           is_available = case when quantity - r.qty = 0 then false else is_available end,
           updated_at = now()
     where menu_id = r.menu_id;
    insert into catalog.stock_movements (branch_id, menu_id, type, quantity_change, quantity_after, reference, created_by)
    select branch_id, menu_id, 'deduct', -r.qty, quantity, p_reference, p_actor from catalog.stocks where menu_id = r.menu_id;
    select v_items || jsonb_build_object('menu_id', s.menu_id, 'quantity', s.quantity, 'is_available', s.is_available)
      into v_items from catalog.stocks s where s.menu_id = r.menu_id;
  end loop;

  return jsonb_build_object('ok', true, 'replayed', false, 'items', v_items);
end $function$;

-- คืนสต็อกเมื่อสั่งไม่สำเร็จเท่านั้น (ไม่ใช้ตอนคืนเงิน) · ไม่เปิดขายให้
create or replace function catalog.restore_stocks(p_branch_id uuid, p_items jsonb default '[]'::jsonb, p_reference text default null::text, p_actor uuid default null::uuid)
 returns jsonb
 language plpgsql
as $function$
declare
  v_items jsonb := '[]'::jsonb;
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
       where p_reference is not null and reference = p_reference and type = 'deduct'
       group by menu_id
      union all
      select (e ->> 'menu_id')::uuid, sum((e ->> 'quantity')::int)::int
        from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) e
       where p_reference is null
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

-- แทนที่กลุ่มตัวเลือกของเมนูทั้งชุด · กลุ่มต้องอยู่สาขาเดียวกับเมนูและยังเปิดใช้
create or replace function catalog.set_menu_option_groups(p_menu_id uuid, p_links jsonb)
 returns void
 language plpgsql
as $function$
declare
  v_branch uuid;
begin
  select branch_id into v_branch from catalog.menus where id = p_menu_id and not is_deleted for update;
  if not found then raise exception 'CATALOG:NOT_FOUND'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_links) e
      left join catalog.option_groups g on g.id = (e ->> 'option_group_id')::uuid
     where g.id is null or g.branch_id <> v_branch or not g.is_active
  ) then
    raise exception 'CATALOG:GROUP_BRANCH_MISMATCH';
  end if;

  delete from catalog.menu_option_groups where menu_id = p_menu_id;
  insert into catalog.menu_option_groups (menu_id, option_group_id, sort_order)
  select p_menu_id, (e ->> 'option_group_id')::uuid, coalesce((e ->> 'sort_order')::int, (ord)::int)
    from jsonb_array_elements(p_links) with ordinality as t(e, ord);
end $function$;

-- ===================== สิทธิ์ =====================
alter table catalog.categories enable row level security;
alter table catalog.menus enable row level security;
alter table catalog.option_groups enable row level security;
alter table catalog.options enable row level security;
alter table catalog.menu_option_groups enable row level security;
alter table catalog.stocks enable row level security;
alter table catalog.stock_movements enable row level security;

revoke all on schema catalog from public, anon, authenticated;
grant usage on schema catalog to service_role;

revoke all on all tables in schema catalog from public, anon, authenticated;
grant all on all tables in schema catalog to service_role;
alter default privileges in schema catalog grant all on tables to service_role;

revoke all on all functions in schema catalog from public, anon, authenticated;
grant execute on all functions in schema catalog to service_role;

-- ===================== รูปเมนู =====================
insert into storage.buckets (id, name, public)
values ('menu-images', 'menu-images', true)
on conflict (id) do nothing;

-- ให้ Data API เห็นโครงสร้างใหม่ทันที
notify pgrst, 'reload schema';
