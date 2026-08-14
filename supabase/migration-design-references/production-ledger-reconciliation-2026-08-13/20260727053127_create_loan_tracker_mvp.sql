create table if not exists public.loan_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  borrower_name text,
  payment_recipient_name text,
  lender_name text,
  loan_number text,
  original_balance numeric(12,2) not null check (original_balance > 0),
  amount_financed numeric(12,2),
  current_official_balance numeric(12,2),
  official_balance_date date,
  annual_interest_rate numeric(7,4) not null check (annual_interest_rate >= 0),
  required_monthly_payment numeric(12,2) not null check (required_monthly_payment > 0),
  planned_monthly_payment numeric(12,2) not null check (planned_monthly_payment > 0),
  private_payment_day integer check (private_payment_day between 1 and 28),
  lender_due_day integer check (lender_due_day between 1 and 28),
  first_payment_date date,
  calculation_start_date date,
  status text not null default 'active' check (status in ('active', 'paid_off', 'closed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  loan_account_id uuid not null references public.loan_accounts(id) on delete restrict,
  payment_number integer,
  scheduled_date date,
  payment_date date not null,
  amount numeric(12,2) not null check (amount > 0),
  interest_amount numeric(12,2),
  principal_amount numeric(12,2),
  beginning_balance numeric(12,2),
  ending_balance numeric(12,2),
  official_balance_after_payment numeric(12,2) check (official_balance_after_payment >= 0),
  confirmation_number text,
  notes text,
  applied_to_loan boolean not null default true,
  status text not null default 'completed' check (status in ('completed', 'voided')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists loan_accounts_one_active_per_user
on public.loan_accounts(user_id)
where status = 'active';

create index if not exists loan_accounts_user_id_idx on public.loan_accounts(user_id);
create index if not exists loan_payments_account_date_idx
on public.loan_payments(loan_account_id, payment_date, created_at);

drop trigger if exists loan_accounts_set_updated_at on public.loan_accounts;
create trigger loan_accounts_set_updated_at before update on public.loan_accounts
for each row execute function public.set_updated_at();

drop trigger if exists loan_payments_set_updated_at on public.loan_payments;
create trigger loan_payments_set_updated_at before update on public.loan_payments
for each row execute function public.set_updated_at();

alter table public.loan_accounts enable row level security;
alter table public.loan_payments enable row level security;

revoke all on public.loan_accounts from anon;
revoke all on public.loan_payments from anon;
revoke all on public.loan_accounts from authenticated;
revoke all on public.loan_payments from authenticated;
grant select, insert, update on public.loan_accounts to authenticated;
grant select, insert, update on public.loan_payments to authenticated;

drop policy if exists "loan_accounts_owner_or_admin_select" on public.loan_accounts;
create policy "loan_accounts_owner_or_admin_select"
on public.loan_accounts for select to authenticated
using ((select auth.uid()) = user_id or (select public.is_platform_admin()));

drop policy if exists "loan_accounts_admin_insert" on public.loan_accounts;
create policy "loan_accounts_admin_insert"
on public.loan_accounts for insert to authenticated
with check ((select public.is_platform_admin()));

drop policy if exists "loan_accounts_admin_update" on public.loan_accounts;
create policy "loan_accounts_admin_update"
on public.loan_accounts for update to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

drop policy if exists "loan_payments_owner_or_admin_select" on public.loan_payments;
create policy "loan_payments_owner_or_admin_select"
on public.loan_payments for select to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
);

drop policy if exists "loan_payments_owner_or_admin_insert" on public.loan_payments;
create policy "loan_payments_owner_or_admin_insert"
on public.loan_payments for insert to authenticated
with check (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
);

drop policy if exists "loan_payments_owner_or_admin_update" on public.loan_payments;
create policy "loan_payments_owner_or_admin_update"
on public.loan_payments for update to authenticated
using (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
)
with check (
  (select public.is_platform_admin())
  or exists (
    select 1 from public.loan_accounts
    where loan_accounts.id = loan_payments.loan_account_id
      and loan_accounts.user_id = (select auth.uid())
  )
);

-- Dave's row is intentionally assigned by verified auth.users.id after signup.
-- Do not derive financial-record access from editable profile or user metadata.
