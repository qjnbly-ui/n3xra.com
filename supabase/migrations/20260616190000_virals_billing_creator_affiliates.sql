create extension if not exists pgcrypto;

create table if not exists public.virals_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan text not null default 'free',
  account_status text not null default 'active',
  monthly_analysis_limit integer not null default 5,
  analyses_used integer not null default 0,
  current_period_start timestamptz not null default date_trunc('month', now()),
  current_period_end timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  cancel_at_period_end boolean not null default false,
  subscription_current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint virals_profiles_plan_check
    check (plan in ('free', 'starter', 'creator', 'pro', 'agency')),
  constraint virals_profiles_account_status_check
    check (account_status in ('active', 'trialing', 'past_due', 'canceled', 'suspended')),
  constraint virals_profiles_monthly_analysis_limit_check
    check (monthly_analysis_limit >= 0),
  constraint virals_profiles_analyses_used_check
    check (analyses_used >= 0)
);

alter table public.virals_profiles
  alter column monthly_analysis_limit set default 5;

alter table public.virals_profiles
  drop constraint if exists virals_profiles_plan_check;

alter table public.virals_profiles
  add constraint virals_profiles_plan_check
    check (plan in ('free', 'starter', 'creator', 'pro', 'agency'));

update public.virals_profiles
set monthly_analysis_limit = 5
where plan = 'free'
  and monthly_analysis_limit = 25;

create table if not exists public.virals_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  role text not null default 'admin',
  created_at timestamptz not null default now(),
  constraint virals_admins_role_check
    check (role in ('admin', 'owner'))
);

insert into public.virals_admins (user_id, email, role)
select id, email, 'owner'
from auth.users
where lower(email) = 'quentin@n3xra.com'
on conflict (user_id) do update
set email = excluded.email,
    role = 'owner';

create table if not exists public.virals_creator_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  email text,
  display_name text,
  tiktok_username text not null,
  requested_code text not null,
  normalized_code text not null unique,
  requested_program text not null default 'standard',
  approved_program text,
  status text not null default 'pending',
  commission_rate numeric(5, 4) not null default 0.20,
  customer_discount_percent integer not null default 10,
  customer_discount_months integer not null default 3,
  ai_evaluation jsonb not null default '{}'::jsonb,
  notes text,
  admin_notes text,
  approved_by uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  rejected_at timestamptz,
  stripe_coupon_id text,
  stripe_promotion_code_id text,
  stripe_connect_account_id text,
  stripe_connect_onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint virals_creator_applications_requested_program_check
    check (requested_program in ('standard', 'founding')),
  constraint virals_creator_applications_approved_program_check
    check (approved_program is null or approved_program in ('standard', 'founding')),
  constraint virals_creator_applications_status_check
    check (status in ('pending', 'approved', 'rejected', 'suspended')),
  constraint virals_creator_applications_commission_rate_check
    check (commission_rate >= 0 and commission_rate <= 1),
  constraint virals_creator_applications_discount_check
    check (customer_discount_percent >= 0 and customer_discount_percent <= 100 and customer_discount_months >= 0)
);

create table if not exists public.virals_referrals (
  id uuid primary key default gen_random_uuid(),
  creator_application_id uuid not null references public.virals_creator_applications(id) on delete restrict,
  referred_user_id uuid not null references auth.users (id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_promotion_code_id text,
  normalized_code text not null,
  status text not null default 'active',
  first_invoice_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (referred_user_id),
  unique (stripe_subscription_id),
  constraint virals_referrals_status_check
    check (status in ('active', 'canceled', 'inactive'))
);

create table if not exists public.virals_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  creator_application_id uuid not null references public.virals_creator_applications(id) on delete restrict,
  referral_id uuid references public.virals_referrals(id) on delete set null,
  stripe_invoice_id text not null unique,
  stripe_subscription_id text,
  stripe_customer_id text,
  amount_paid integer not null default 0,
  currency text not null default 'usd',
  commission_rate numeric(5, 4) not null,
  commission_amount integer not null default 0,
  status text not null default 'pending',
  eligible_at timestamptz,
  paid_at timestamptz,
  stripe_transfer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint virals_commission_ledger_amount_check
    check (amount_paid >= 0 and commission_amount >= 0),
  constraint virals_commission_ledger_status_check
    check (status in ('pending', 'eligible', 'paid', 'reversed', 'void'))
);

create index if not exists virals_profiles_stripe_customer_id_idx on public.virals_profiles(stripe_customer_id);
create index if not exists virals_profiles_stripe_subscription_id_idx on public.virals_profiles(stripe_subscription_id);
create index if not exists virals_profiles_stripe_price_id_idx on public.virals_profiles(stripe_price_id);
create index if not exists virals_creator_applications_user_idx on public.virals_creator_applications(user_id, created_at desc);
create index if not exists virals_creator_applications_status_idx on public.virals_creator_applications(status, created_at desc);
create index if not exists virals_creator_applications_code_idx on public.virals_creator_applications(normalized_code);
create index if not exists virals_referrals_creator_idx on public.virals_referrals(creator_application_id, created_at desc);
create index if not exists virals_referrals_subscription_idx on public.virals_referrals(stripe_subscription_id);
create index if not exists virals_commission_ledger_creator_status_idx on public.virals_commission_ledger(creator_application_id, status, created_at desc);

alter table public.virals_profiles enable row level security;
alter table public.virals_admins enable row level security;
alter table public.virals_creator_applications enable row level security;
alter table public.virals_referrals enable row level security;
alter table public.virals_commission_ledger enable row level security;

create or replace function public.set_virals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.protect_virals_profile_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if new.plan is distinct from old.plan
    or new.account_status is distinct from old.account_status
    or new.monthly_analysis_limit is distinct from old.monthly_analysis_limit
    or new.analyses_used is distinct from old.analyses_used
    or new.current_period_start is distinct from old.current_period_start
    or new.current_period_end is distinct from old.current_period_end
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_price_id is distinct from old.stripe_price_id
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
    raise exception 'N3XRA Virals billing fields require service access.';
  end if;

  return new;
end;
$$;

create or replace function public.is_virals_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.virals_admins admin
    where admin.user_id = auth.uid()
  );
$$;

create or replace function public.protect_virals_creator_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') or public.is_virals_admin() then
    return new;
  end if;

  if new.status is distinct from old.status
    or new.requested_code is distinct from old.requested_code
    or new.normalized_code is distinct from old.normalized_code
    or new.requested_program is distinct from old.requested_program
    or new.approved_program is distinct from old.approved_program
    or new.commission_rate is distinct from old.commission_rate
    or new.customer_discount_percent is distinct from old.customer_discount_percent
    or new.customer_discount_months is distinct from old.customer_discount_months
    or new.ai_evaluation is distinct from old.ai_evaluation
    or new.admin_notes is distinct from old.admin_notes
    or new.approved_by is distinct from old.approved_by
    or new.approved_at is distinct from old.approved_at
    or new.rejected_at is distinct from old.rejected_at
    or new.stripe_coupon_id is distinct from old.stripe_coupon_id
    or new.stripe_promotion_code_id is distinct from old.stripe_promotion_code_id
    or new.stripe_connect_account_id is distinct from old.stripe_connect_account_id
    or new.stripe_connect_onboarding_completed is distinct from old.stripe_connect_onboarding_completed then
    raise exception 'N3XRA Virals creator approval and billing fields require admin access.';
  end if;

  return new;
end;
$$;

drop policy if exists virals_admins_select_admin on public.virals_admins;
create policy virals_admins_select_admin
on public.virals_admins
for select
using (public.is_virals_admin());

drop policy if exists virals_creator_applications_select on public.virals_creator_applications;
create policy virals_creator_applications_select
on public.virals_creator_applications
for select
using (auth.uid() = user_id or public.is_virals_admin());

drop policy if exists virals_creator_applications_insert_own on public.virals_creator_applications;

drop policy if exists virals_creator_applications_update on public.virals_creator_applications;
create policy virals_creator_applications_update
on public.virals_creator_applications
for update
using (auth.uid() = user_id or public.is_virals_admin())
with check (auth.uid() = user_id or public.is_virals_admin());

drop policy if exists virals_referrals_select on public.virals_referrals;
create policy virals_referrals_select
on public.virals_referrals
for select
using (
  public.is_virals_admin()
  or referred_user_id = auth.uid()
  or exists (
    select 1
    from public.virals_creator_applications app
    where app.id = virals_referrals.creator_application_id
      and app.user_id = auth.uid()
  )
);

drop policy if exists virals_commission_ledger_select on public.virals_commission_ledger;
create policy virals_commission_ledger_select
on public.virals_commission_ledger
for select
using (
  public.is_virals_admin()
  or exists (
    select 1
    from public.virals_creator_applications app
    where app.id = virals_commission_ledger.creator_application_id
      and app.user_id = auth.uid()
  )
);

drop policy if exists virals_profiles_select_own on public.virals_profiles;
create policy virals_profiles_select_own
on public.virals_profiles
for select
using (auth.uid() = user_id);

drop policy if exists virals_profiles_update_own_display_name on public.virals_profiles;
create policy virals_profiles_update_own_display_name
on public.virals_profiles
for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop trigger if exists set_virals_profiles_updated_at on public.virals_profiles;
create trigger set_virals_profiles_updated_at
before update on public.virals_profiles
for each row execute function public.set_virals_updated_at();

drop trigger if exists virals_profiles_protect_billing_fields on public.virals_profiles;
create trigger virals_profiles_protect_billing_fields
before update on public.virals_profiles
for each row execute function public.protect_virals_profile_billing_fields();

drop trigger if exists set_virals_creator_applications_updated_at on public.virals_creator_applications;
create trigger set_virals_creator_applications_updated_at
before update on public.virals_creator_applications
for each row execute function public.set_virals_updated_at();

drop trigger if exists virals_creator_applications_protect_billing_fields on public.virals_creator_applications;
create trigger virals_creator_applications_protect_billing_fields
before update on public.virals_creator_applications
for each row execute function public.protect_virals_creator_billing_fields();

drop trigger if exists set_virals_referrals_updated_at on public.virals_referrals;
create trigger set_virals_referrals_updated_at
before update on public.virals_referrals
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_commission_ledger_updated_at on public.virals_commission_ledger;
create trigger set_virals_commission_ledger_updated_at
before update on public.virals_commission_ledger
for each row execute function public.set_virals_updated_at();
