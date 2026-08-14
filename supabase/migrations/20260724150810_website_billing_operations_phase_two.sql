create table public.website_billing_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.website_projects (id) on delete cascade,
  snapshot_id uuid not null unique references public.website_billing_snapshots (id) on delete restrict,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  service_start_at timestamptz,
  billing_anchor_day smallint,
  collection_method text not null default 'charge_automatically',
  days_until_due smallint,
  require_payment_method boolean not null default true,
  status text not null default 'draft',
  approved_by_user_id uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  activated_at timestamptz,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_billing_schedules_anchor_check
    check (billing_anchor_day is null or billing_anchor_day between 1 and 28),
  constraint website_billing_schedules_collection_check
    check (collection_method in ('charge_automatically', 'send_invoice')),
  constraint website_billing_schedules_due_check
    check (
      (collection_method = 'charge_automatically' and days_until_due is null)
      or (collection_method = 'send_invoice' and days_until_due between 1 and 60)
    ),
  constraint website_billing_schedules_status_check
    check (status in ('draft', 'approved', 'active', 'canceled'))
);

create table public.website_billing_charges (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects (id) on delete cascade,
  snapshot_id uuid references public.website_billing_snapshots (id) on delete restrict,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  source text not null,
  category text not null,
  name text not null,
  description text,
  amount_cents integer not null,
  currency text not null default 'usd',
  approval_status text not null default 'pending',
  approval_reference text,
  approved_by_user_id uuid references auth.users (id) on delete set null,
  approved_at timestamptz,
  collection_method text not null default 'send_invoice',
  scheduled_for timestamptz,
  days_until_due smallint,
  status text not null default 'draft',
  stripe_invoice_id text unique,
  local_invoice_id uuid references public.website_invoices (id) on delete set null,
  idempotency_key text not null unique,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_billing_charges_source_check
    check (source in ('proposal_balance', 'milestone', 'domain', 'third_party', 'extra_edits', 'additional_service')),
  constraint website_billing_charges_category_check
    check (category in ('website_build', 'domain', 'hosting', 'maintenance', 'email', 'ssl_cdn', 'content', 'ecommerce', 'integration', 'other')),
  constraint website_billing_charges_amount_check check (amount_cents > 0),
  constraint website_billing_charges_currency_check check (currency ~ '^[a-z]{3}$'),
  constraint website_billing_charges_approval_check
    check (approval_status in ('pending', 'approved', 'rejected')),
  constraint website_billing_charges_collection_check
    check (collection_method in ('charge_automatically', 'send_invoice')),
  constraint website_billing_charges_due_check
    check (
      (collection_method = 'charge_automatically' and days_until_due is null)
      or (collection_method = 'send_invoice' and days_until_due between 1 and 60)
    ),
  constraint website_billing_charges_status_check
    check (status in ('draft', 'scheduled', 'invoiced', 'paid', 'failed', 'void', 'canceled'))
);

create table public.website_billing_communications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  invoice_id uuid references public.website_invoices (id) on delete set null,
  charge_id uuid references public.website_billing_charges (id) on delete set null,
  template text not null,
  recipient_email text not null,
  subject text not null,
  status text not null default 'pending',
  provider_message_id text,
  error_message text,
  sent_by_user_id uuid references auth.users (id) on delete set null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  constraint website_billing_communications_template_check
    check (template in ('billing_setup_ready', 'invoice_issued', 'payment_received', 'upcoming_renewal', 'payment_failed', 'card_expiring', 'cancellation_scheduled')),
  constraint website_billing_communications_status_check
    check (status in ('pending', 'sent', 'failed'))
);

create index website_billing_charges_project_created_idx
  on public.website_billing_charges (project_id, created_at desc);
create index website_billing_charges_status_schedule_idx
  on public.website_billing_charges (status, scheduled_for)
  where status in ('draft', 'scheduled');
create index website_billing_communications_project_created_idx
  on public.website_billing_communications (project_id, created_at desc);

drop trigger if exists website_billing_schedules_set_updated_at on public.website_billing_schedules;
create trigger website_billing_schedules_set_updated_at
before update on public.website_billing_schedules
for each row execute function public.set_updated_at();

drop trigger if exists website_billing_charges_set_updated_at on public.website_billing_charges;
create trigger website_billing_charges_set_updated_at
before update on public.website_billing_charges
for each row execute function public.set_updated_at();

create or replace function private.protect_website_billing_charge()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if old.status <> 'draft' and row(
    new.project_id, new.snapshot_id, new.client_user_id, new.source, new.category,
    new.name, new.description, new.amount_cents, new.currency,
    new.approval_status, new.approval_reference
  ) is distinct from row(
    old.project_id, old.snapshot_id, old.client_user_id, old.source, old.category,
    old.name, old.description, old.amount_cents, old.currency,
    old.approval_status, old.approval_reference
  ) then
    raise exception 'Issued website billing charge terms are immutable.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_website_billing_charge() from public;
create trigger website_billing_charges_protect_terms
before update on public.website_billing_charges
for each row execute function private.protect_website_billing_charge();

alter table public.website_billing_schedules enable row level security;
alter table public.website_billing_charges enable row level security;
alter table public.website_billing_communications enable row level security;

revoke all on public.website_billing_schedules from anon, authenticated;
revoke all on public.website_billing_charges from anon, authenticated;
revoke all on public.website_billing_communications from anon, authenticated;

grant select on public.website_billing_schedules to authenticated;
grant select on public.website_billing_charges to authenticated;
grant select on public.website_billing_communications to authenticated;
grant all on public.website_billing_schedules to service_role;
grant all on public.website_billing_charges to service_role;
grant all on public.website_billing_communications to service_role;

create policy "website_billing_schedules_select"
on public.website_billing_schedules
for select to authenticated
using (client_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "website_billing_charges_select"
on public.website_billing_charges
for select to authenticated
using (client_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create policy "website_billing_communications_select"
on public.website_billing_communications
for select to authenticated
using (client_user_id = (select auth.uid()) or (select public.is_platform_admin()));
;
