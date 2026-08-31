alter table public.n3xra_product_catalog
  add column if not exists setup_fee_cents integer not null default 0,
  add column if not exists monthly_price_cents integer not null default 0,
  add column if not exists stripe_product_id text,
  add column if not exists stripe_monthly_price_id text,
  add column if not exists stripe_setup_price_id text;

alter table public.n3xra_product_catalog
  drop constraint if exists n3xra_product_catalog_billing_amounts_check;

alter table public.n3xra_product_catalog
  add constraint n3xra_product_catalog_billing_amounts_check
  check (setup_fee_cents >= 0 and monthly_price_cents >= 0);

create table if not exists public.organization_product_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_key text not null references public.n3xra_product_catalog (product_key) on delete restrict,
  stripe_customer_id text not null,
  stripe_subscription_id text unique,
  stripe_price_id text,
  stripe_checkout_session_id text unique,
  checkout_url text,
  checkout_expires_at timestamptz,
  status text not null default 'not_started',
  currency text not null default 'usd',
  setup_fee_cents integer not null default 0,
  monthly_price_cents integer not null default 0,
  setup_fee_paid boolean not null default false,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_product_subscriptions_org_product_key
    unique (organization_id, product_key),
  constraint organization_product_subscriptions_status_check
    check (status in ('not_started', 'checkout_pending', 'incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled')),
  constraint organization_product_subscriptions_currency_check
    check (currency ~ '^[a-z]{3}$'),
  constraint organization_product_subscriptions_amounts_check
    check (setup_fee_cents >= 0 and monthly_price_cents >= 0)
);

create index if not exists organization_product_subscriptions_customer_idx
  on public.organization_product_subscriptions (stripe_customer_id);

create index if not exists organization_product_subscriptions_status_idx
  on public.organization_product_subscriptions (organization_id, status, product_key);

drop trigger if exists organization_product_subscriptions_set_updated_at
  on public.organization_product_subscriptions;
create trigger organization_product_subscriptions_set_updated_at
before update on public.organization_product_subscriptions
for each row execute function public.set_updated_at();

alter table public.organization_product_subscriptions enable row level security;

revoke all on public.organization_product_subscriptions from anon, authenticated;
grant select on public.organization_product_subscriptions to authenticated;
grant all on public.organization_product_subscriptions to service_role;

drop policy if exists "organization_product_subscriptions_member_select"
  on public.organization_product_subscriptions;
create policy "organization_product_subscriptions_member_select"
on public.organization_product_subscriptions
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships as membership
    where membership.organization_id = organization_product_subscriptions.organization_id
      and membership.user_id = (select auth.uid())
  )
  or exists (
    select 1
    from public.organizations as organization
    where organization.id = organization_product_subscriptions.organization_id
      and organization.owner_user_id = (select auth.uid())
  )
  or public.is_platform_admin()
);

update public.n3xra_product_catalog
set
  setup_fee_cents = 2900,
  monthly_price_cents = 1900,
  stripe_product_id = 'prod_V90OsZl7oeDAid',
  stripe_monthly_price_id = 'price_1U8iNG4fYoWkBJCDueCP9iAe',
  stripe_setup_price_id = 'price_1U8iTw4fYoWkBJCDBMrndlhW'
where product_key = 'communications';;
