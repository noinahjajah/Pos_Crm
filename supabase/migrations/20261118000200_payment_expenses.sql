-- payment.expenses: รายจ่ายของแต่ละสาขา 4 หมวด (ใช้กับ services/payment/expenses.js และ report_expenses / report_monthly_expenses)
-- รันซ้ำได้ · ใช้ enum payment.expense_category ที่มีอยู่แล้ว (สร้างให้ถ้ายังไม่มี)

create schema if not exists payment;

do $$ begin
  create type payment.expense_category as enum ('labor', 'rent_utilities', 'ingredients', 'other');
exception when duplicate_object then null; end $$;

create table if not exists payment.expenses (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null,
  category payment.expense_category not null,
  amount numeric(12, 2) not null check (amount > 0),
  expense_date date not null default (now() at time zone 'Asia/Bangkok')::date,
  note text check (char_length(note) <= 500),
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists expenses_branch_date_idx on payment.expenses (branch_id, expense_date desc);

-- เหมือน payment.payments: เปิด RLS ไม่มี policy → เข้าถึงได้เฉพาะ service_role ผ่าน payment service
alter table payment.expenses enable row level security;
revoke all on payment.expenses from anon, authenticated;
grant select, insert, update, delete on payment.expenses to service_role;

-- ให้ Data API เห็นตารางใหม่ทันที
notify pgrst, 'reload schema';
