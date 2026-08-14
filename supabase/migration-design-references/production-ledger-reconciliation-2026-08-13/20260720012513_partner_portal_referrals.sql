alter table public.founding_partner_applications
  add column if not exists referral_code text,
  add column if not exists approved_at timestamptz;

create unique index if not exists founding_partner_applications_referral_code_unique
on public.founding_partner_applications (upper(referral_code))
where referral_code is not null;

create table if not exists public.partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_application_id uuid not null references public.founding_partner_applications(id) on delete cascade,
  referred_name text not null,
  referred_email text,
  program text not null,
  status text not null default 'submitted',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_referrals_status_check
    check (status in ('submitted', 'qualified', 'converted', 'not_qualified'))
);

create table if not exists public.partner_commission_entries (
  id uuid primary key default gen_random_uuid(),
  partner_application_id uuid not null references public.founding_partner_applications(id) on delete cascade,
  referral_id uuid references public.partner_referrals(id) on delete set null,
  description text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  status text not null default 'pending',
  earned_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint partner_commission_entries_status_check
    check (status in ('pending', 'available', 'paid', 'void'))
);

create index if not exists partner_referrals_application_created_idx
on public.partner_referrals (partner_application_id, created_at desc);

create index if not exists partner_commission_entries_application_created_idx
on public.partner_commission_entries (partner_application_id, created_at desc);

drop trigger if exists set_partner_referrals_updated_at on public.partner_referrals;
create trigger set_partner_referrals_updated_at
before update on public.partner_referrals
for each row execute function public.set_updated_at();

drop trigger if exists set_partner_commission_entries_updated_at on public.partner_commission_entries;
create trigger set_partner_commission_entries_updated_at
before update on public.partner_commission_entries
for each row execute function public.set_updated_at();

alter table public.partner_referrals enable row level security;
alter table public.partner_commission_entries enable row level security;

revoke all on public.partner_referrals from anon, authenticated;
revoke all on public.partner_commission_entries from anon, authenticated;
grant select, insert, update, delete on public.partner_referrals to service_role;
grant select, insert, update, delete on public.partner_commission_entries to service_role;
