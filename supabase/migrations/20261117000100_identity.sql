
create schema if not exists identity;

do $$ begin
  create type identity.branch_type as enum ('restaurant', 'drinks', 'bar');
exception when duplicate_object then null; end $$;

create table if not exists identity.branches (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  branch_type identity.branch_type not null,
  address     text,
  phone       text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint branches_code_format check (code ~ '^[A-Z0-9_-]{2,20}$')
);

create table if not exists identity.roles (
  id   smallint primary key,
  name text not null unique check (name in ('staff', 'manager', 'owner'))
);

insert into identity.roles (id, name) values
  (1, 'staff'),
  (2, 'manager'),
  (3, 'owner')
on conflict (id) do update set name = excluded.name;

create table if not exists identity.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  branch_id  uuid references identity.branches (id),
  role_id    smallint not null references identity.roles (id),
  username   text not null unique,
  full_name  text not null,
  is_active  boolean not null default true,
  must_change_password boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  constraint profiles_username_format check (username ~ '^[a-z0-9._-]{3,32}$'),
  constraint profiles_branch_by_role check (
    (role_id = 3 and branch_id is null) or (role_id <> 3 and branch_id is not null)
  )
);

create index if not exists profiles_branch_id_idx on identity.profiles (branch_id);
create index if not exists profiles_role_id_idx on identity.profiles (role_id);

alter table identity.branches enable row level security;
alter table identity.roles    enable row level security;
alter table identity.profiles enable row level security;

revoke all on schema identity from anon, authenticated;
grant usage on schema identity to service_role;
grant all on all tables in schema identity to service_role;
alter default privileges in schema identity grant all on tables to service_role;

create or replace function identity.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims    jsonb := event -> 'claims';
  v_role    text;
  v_branch  uuid;
  v_active  boolean;
begin
  select r.name, p.branch_id, p.is_active
    into v_role, v_branch, v_active
    from identity.profiles p
    join identity.roles r on r.id = p.role_id
   where p.id = (event ->> 'user_id')::uuid;

  if v_role is not null and v_active then
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
    claims := jsonb_set(claims, '{branch_id}', coalesce(to_jsonb(v_branch::text), 'null'::jsonb));
  else
    claims := jsonb_set(claims, '{user_role}', 'null'::jsonb);
    claims := jsonb_set(claims, '{branch_id}', 'null'::jsonb);
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$$;

grant usage on schema identity to supabase_auth_admin;
grant execute on function identity.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function identity.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on identity.profiles, identity.roles to supabase_auth_admin;

drop policy if exists "auth admin reads profiles" on identity.profiles;
create policy "auth admin reads profiles" on identity.profiles
  as permissive for select to supabase_auth_admin using (true);

drop policy if exists "auth admin reads roles" on identity.roles;
create policy "auth admin reads roles" on identity.roles
  as permissive for select to supabase_auth_admin using (true);
