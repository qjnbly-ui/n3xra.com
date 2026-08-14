create table public.website_billing_customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  stripe_customer_id text unique,
  payment_method_status text not null default 'missing',
  payment_method_brand text,
  payment_method_last4 text,
  payment_method_exp_month integer,
  payment_method_exp_year integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_billing_customers_payment_status_check
    check (payment_method_status in ('missing', 'available', 'requires_update')),
  constraint website_billing_customers_last4_check
    check (payment_method_last4 is null or payment_method_last4 ~ '^[0-9]{4}$'),
  constraint website_billing_customers_expiry_check
    check (
      (payment_method_exp_month is null and payment_method_exp_year is null)
      or (
        payment_method_exp_month between 1 and 12
        and payment_method_exp_year between 2020 and 2200
      )
    )
);

create table public.website_billing_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects (id) on delete cascade,
  proposal_id uuid not null references public.website_proposals (id) on delete restrict,
  proposal_version_id uuid not null unique references public.website_proposal_versions (id) on delete restrict,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'prepared',
  currency text not null default 'usd',
  service_plan text not null default 'none',
  recurring_interval text,
  one_time_total_cents integer not null default 0,
  amount_due_now_cents integer not null default 0,
  remaining_build_balance_cents integer not null default 0,
  recurring_cents integer not null default 0,
  discount_cents integer not null default 0,
  referral_code text,
  partner_application_id uuid references public.founding_partner_applications (id) on delete set null,
  annual_partner_qualifying boolean not null default false,
  stripe_checkout_session_id text unique,
  checkout_url text,
  checkout_expires_at timestamptz,
  prepared_by_user_id uuid not null references auth.users (id) on delete restrict,
  prepared_at timestamptz not null default now(),
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_billing_snapshots_status_check
    check (status in ('prepared', 'checkout_pending', 'active', 'payment_failed', 'canceled')),
  constraint website_billing_snapshots_currency_check
    check (currency ~ '^[a-z]{3}$'),
  constraint website_billing_snapshots_plan_check
    check (service_plan in ('none', 'starter', 'starter_plus', 'advanced')),
  constraint website_billing_snapshots_interval_check
    check (
      (recurring_cents = 0 and recurring_interval is null and service_plan = 'none')
      or (
        recurring_cents > 0
        and recurring_interval in ('monthly', 'yearly')
        and service_plan <> 'none'
      )
    ),
  constraint website_billing_snapshots_amounts_check
    check (
      one_time_total_cents >= 0
      and amount_due_now_cents >= 0
      and amount_due_now_cents <= one_time_total_cents
      and remaining_build_balance_cents = one_time_total_cents - amount_due_now_cents
      and recurring_cents >= 0
      and discount_cents >= 0
    ),
  constraint website_billing_snapshots_referral_code_check
    check (referral_code is null or referral_code ~ '^[A-Z0-9-]{4,24}$'),
  constraint website_billing_snapshots_checkout_pair_check
    check (
      (stripe_checkout_session_id is null and checkout_url is null)
      or (stripe_checkout_session_id is not null and checkout_url is not null)
    )
);

create table public.website_billing_snapshot_items (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.website_billing_snapshots (id) on delete cascade,
  proposal_line_item_id uuid references public.website_proposal_line_items (id) on delete restrict,
  category text not null,
  name text not null,
  description text,
  billing_type text not null,
  quantity numeric(10, 2) not null,
  unit_amount_cents integer not null,
  total_amount_cents integer not null,
  recurring_interval text,
  included_in_initial_checkout boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint website_billing_snapshot_items_category_check
    check (category in ('website_build', 'domain', 'hosting', 'maintenance', 'email', 'ssl_cdn', 'content', 'ecommerce', 'integration', 'other', 'discount')),
  constraint website_billing_snapshot_items_type_check
    check (billing_type in ('one_time', 'recurring', 'credit')),
  constraint website_billing_snapshot_items_amount_check
    check (quantity > 0 and unit_amount_cents >= 0 and total_amount_cents >= 0),
  constraint website_billing_snapshot_items_interval_check
    check (
      (billing_type in ('one_time', 'credit') and recurring_interval is null)
      or (billing_type = 'recurring' and recurring_interval in ('monthly', 'yearly'))
    )
);

create table public.website_subscriptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.website_projects (id) on delete cascade,
  snapshot_id uuid not null unique references public.website_billing_snapshots (id) on delete restrict,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  website_billing_customer_id uuid not null references public.website_billing_customers (id) on delete restrict,
  stripe_subscription_id text unique,
  stripe_price_id text,
  service_plan text not null,
  billing_interval text not null,
  amount_cents integer not null,
  status text not null default 'incomplete',
  current_period_start timestamptz,
  current_period_end timestamptz,
  commitment_ends_at timestamptz,
  cancel_at_period_end boolean not null default false,
  annual_partner_qualifying boolean not null default false,
  referral_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_subscriptions_plan_check
    check (service_plan in ('starter', 'starter_plus', 'advanced')),
  constraint website_subscriptions_interval_check
    check (billing_interval in ('monthly', 'yearly')),
  constraint website_subscriptions_amount_check check (amount_cents > 0),
  constraint website_subscriptions_status_check
    check (status in ('incomplete', 'trialing', 'active', 'past_due', 'unpaid', 'paused', 'canceled')),
  constraint website_subscriptions_referral_code_check
    check (referral_code is null or referral_code ~ '^[A-Z0-9-]{4,24}$')
);

create table public.website_invoices (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects (id) on delete cascade,
  snapshot_id uuid references public.website_billing_snapshots (id) on delete set null,
  subscription_id uuid references public.website_subscriptions (id) on delete set null,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  stripe_invoice_id text not null unique,
  stripe_customer_id text not null,
  stripe_subscription_id text,
  status text not null,
  currency text not null default 'usd',
  subtotal_cents integer not null default 0,
  discount_cents integer not null default 0,
  total_cents integer not null default 0,
  amount_due_cents integer not null default 0,
  amount_paid_cents integer not null default 0,
  hosted_invoice_url text,
  invoice_pdf_url text,
  due_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_invoices_status_check
    check (status in ('draft', 'open', 'paid', 'void', 'uncollectible', 'deleted')),
  constraint website_invoices_amounts_check
    check (
      subtotal_cents >= 0
      and discount_cents >= 0
      and total_cents >= 0
      and amount_due_cents >= 0
      and amount_paid_cents >= 0
    )
);

create table public.website_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.website_invoices (id) on delete cascade,
  stripe_invoice_line_id text,
  description text not null,
  quantity numeric(10, 2) not null default 1,
  unit_amount_cents integer not null default 0,
  total_amount_cents integer not null default 0,
  currency text not null default 'usd',
  created_at timestamptz not null default now(),
  constraint website_invoice_items_amounts_check
    check (quantity > 0 and unit_amount_cents >= 0 and total_amount_cents >= 0)
);

create table public.website_stripe_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text not null unique,
  event_type text not null,
  stripe_object_id text,
  livemode boolean not null default false,
  processing_status text not null default 'processing',
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  constraint website_stripe_events_status_check
    check (processing_status in ('processing', 'processed', 'ignored', 'failed'))
);

create index website_billing_snapshots_client_created_idx
  on public.website_billing_snapshots (client_user_id, created_at desc);
create index website_billing_snapshots_project_created_idx
  on public.website_billing_snapshots (project_id, created_at desc);
create index website_billing_snapshots_status_idx
  on public.website_billing_snapshots (status, updated_at desc);
create index website_billing_snapshot_items_snapshot_sort_idx
  on public.website_billing_snapshot_items (snapshot_id, sort_order, created_at);
create index website_subscriptions_client_status_idx
  on public.website_subscriptions (client_user_id, status, updated_at desc);
create index website_invoices_client_created_idx
  on public.website_invoices (client_user_id, created_at desc);
create index website_invoices_project_created_idx
  on public.website_invoices (project_id, created_at desc);
create index website_invoices_subscription_idx
  on public.website_invoices (subscription_id)
  where subscription_id is not null;
create index website_invoice_items_invoice_idx
  on public.website_invoice_items (invoice_id, created_at);
create index website_stripe_events_status_received_idx
  on public.website_stripe_events (processing_status, received_at desc);

drop trigger if exists website_billing_customers_set_updated_at on public.website_billing_customers;
create trigger website_billing_customers_set_updated_at
before update on public.website_billing_customers
for each row execute function public.set_updated_at();

drop trigger if exists website_billing_snapshots_set_updated_at on public.website_billing_snapshots;
create trigger website_billing_snapshots_set_updated_at
before update on public.website_billing_snapshots
for each row execute function public.set_updated_at();

create or replace function private.protect_website_billing_snapshot()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if row(
    new.project_id, new.proposal_id, new.proposal_version_id, new.client_user_id,
    new.currency, new.service_plan, new.recurring_interval, new.one_time_total_cents,
    new.amount_due_now_cents, new.remaining_build_balance_cents, new.recurring_cents,
    new.discount_cents, new.referral_code, new.partner_application_id,
    new.annual_partner_qualifying, new.prepared_by_user_id, new.prepared_at
  ) is distinct from row(
    old.project_id, old.proposal_id, old.proposal_version_id, old.client_user_id,
    old.currency, old.service_plan, old.recurring_interval, old.one_time_total_cents,
    old.amount_due_now_cents, old.remaining_build_balance_cents, old.recurring_cents,
    old.discount_cents, old.referral_code, old.partner_application_id,
    old.annual_partner_qualifying, old.prepared_by_user_id, old.prepared_at
  ) then
    raise exception 'Website billing snapshot financial terms are immutable.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_website_billing_snapshot() from public;
create trigger website_billing_snapshots_protect_terms
before update on public.website_billing_snapshots
for each row execute function private.protect_website_billing_snapshot();

drop trigger if exists website_subscriptions_set_updated_at on public.website_subscriptions;
create trigger website_subscriptions_set_updated_at
before update on public.website_subscriptions
for each row execute function public.set_updated_at();

drop trigger if exists website_invoices_set_updated_at on public.website_invoices;
create trigger website_invoices_set_updated_at
before update on public.website_invoices
for each row execute function public.set_updated_at();

alter table public.website_billing_customers enable row level security;
alter table public.website_billing_snapshots enable row level security;
alter table public.website_billing_snapshot_items enable row level security;
alter table public.website_subscriptions enable row level security;
alter table public.website_invoices enable row level security;
alter table public.website_invoice_items enable row level security;
alter table public.website_stripe_events enable row level security;

revoke all on public.website_billing_customers from anon, authenticated;
revoke all on public.website_billing_snapshots from anon, authenticated;
revoke all on public.website_billing_snapshot_items from anon, authenticated;
revoke all on public.website_subscriptions from anon, authenticated;
revoke all on public.website_invoices from anon, authenticated;
revoke all on public.website_invoice_items from anon, authenticated;
revoke all on public.website_stripe_events from anon, authenticated;

grant select on public.website_billing_customers to authenticated;
grant select on public.website_billing_snapshots to authenticated;
grant select on public.website_billing_snapshot_items to authenticated;
grant select on public.website_subscriptions to authenticated;
grant select on public.website_invoices to authenticated;
grant select on public.website_invoice_items to authenticated;

grant all on public.website_billing_customers to service_role;
grant all on public.website_billing_snapshots to service_role;
grant all on public.website_billing_snapshot_items to service_role;
grant all on public.website_subscriptions to service_role;
grant all on public.website_invoices to service_role;
grant all on public.website_invoice_items to service_role;
grant all on public.website_stripe_events to service_role;

create policy "website_billing_customers_select"
on public.website_billing_customers
for select to authenticated
using (user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "website_billing_snapshots_select"
on public.website_billing_snapshots
for select to authenticated
using (client_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "website_billing_snapshot_items_select"
on public.website_billing_snapshot_items
for select to authenticated
using (
  exists (
    select 1
    from public.website_billing_snapshots snapshot
    where snapshot.id = snapshot_id
      and (
        snapshot.client_user_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  )
);

create policy "website_subscriptions_select"
on public.website_subscriptions
for select to authenticated
using (client_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "website_invoices_select"
on public.website_invoices
for select to authenticated
using (client_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "website_invoice_items_select"
on public.website_invoice_items
for select to authenticated
using (
  exists (
    select 1
    from public.website_invoices invoice
    where invoice.id = invoice_id
      and (
        invoice.client_user_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  )
);
;
