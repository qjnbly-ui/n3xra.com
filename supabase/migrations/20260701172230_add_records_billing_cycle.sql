alter table public.organizations
  add column if not exists billing_cycle text not null default 'monthly';

alter table public.organizations
  drop constraint if exists organizations_billing_cycle_check;

alter table public.organizations
  add constraint organizations_billing_cycle_check
  check (billing_cycle in ('monthly', 'yearly'));
