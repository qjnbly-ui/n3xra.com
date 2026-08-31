create table public.communications_plan_catalog (
  plan_key text primary key,
  name text not null,
  description text not null,
  status text not null default 'active',
  audience text not null default 'organization',
  monthly_price_cents integer not null,
  included_sms_segments integer not null,
  included_email_deliveries integer not null,
  sms_overage_cents integer not null default 3,
  mms_unit_cents integer not null default 8,
  email_overage_per_1000_cents integer not null default 200,
  stripe_price_id text not null unique,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_plan_catalog_status_check
    check (status in ('active', 'grandfathered', 'inactive')),
  constraint communications_plan_catalog_audience_check
    check (audience in ('organization', 'standalone', 'all')),
  constraint communications_plan_catalog_amounts_check
    check (
      monthly_price_cents >= 0
      and included_sms_segments >= 0
      and included_email_deliveries >= 0
      and sms_overage_cents >= 0
      and mms_unit_cents >= 0
      and email_overage_per_1000_cents >= 0
    )
);

drop trigger if exists communications_plan_catalog_set_updated_at
  on public.communications_plan_catalog;
create trigger communications_plan_catalog_set_updated_at
before update on public.communications_plan_catalog
for each row execute function public.set_updated_at();

alter table public.communications_plan_catalog enable row level security;
revoke all on public.communications_plan_catalog from public, anon, authenticated;
grant all on public.communications_plan_catalog to service_role;

comment on table public.communications_plan_catalog is
  'Server-managed Communications plans, Stripe prices, and monthly usage allowances.';

insert into public.communications_plan_catalog (
  plan_key,
  name,
  description,
  status,
  audience,
  monthly_price_cents,
  included_sms_segments,
  included_email_deliveries,
  sms_overage_cents,
  mms_unit_cents,
  email_overage_per_1000_cents,
  stripe_price_id,
  sort_order
)
values
  (
    'founding',
    'Communications Founding',
    'Grandfathered founding-customer plan.',
    'grandfathered',
    'organization',
    1900,
    500,
    3000,
    3,
    8,
    200,
    'price_1U8iNG4fYoWkBJCDueCP9iAe',
    10
  ),
  (
    'basic',
    'Communications Basic',
    'Permission-based email and text messaging for organizations with moderate monthly outreach.',
    'active',
    'organization',
    3900,
    500,
    3000,
    3,
    8,
    200,
    'price_1UAeYJ4fYoWkBJCDbL4gSRqa',
    20
  ),
  (
    'plus',
    'Communications Plus',
    'Expanded email and text capacity for organizations communicating with larger audiences.',
    'active',
    'organization',
    6900,
    2000,
    10000,
    3,
    8,
    200,
    'price_1UAeYY4fYoWkBJCDImuMhtvW',
    30
  );

alter table public.communications_workspaces
  add column if not exists plan_key text references public.communications_plan_catalog (plan_key) on delete restrict,
  add column if not exists included_email_deliveries integer not null default 3000,
  add column if not exists email_overage_per_1000_cents integer not null default 200;

alter table public.communications_workspaces
  drop constraint if exists communications_workspaces_email_allowance_check;
alter table public.communications_workspaces
  add constraint communications_workspaces_email_allowance_check
  check (included_email_deliveries >= 0 and email_overage_per_1000_cents >= 0);

alter table public.organization_product_subscriptions
  add column if not exists plan_key text references public.communications_plan_catalog (plan_key) on delete restrict;

create or replace function public.apply_communications_plan_to_workspace()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  selected_plan public.communications_plan_catalog%rowtype;
  selected_plan_key text;
begin
  if new.plan_key is null then
    select subscription.plan_key
    into selected_plan_key
    from public.organization_product_subscriptions as subscription
    where subscription.organization_id = new.organization_id
      and subscription.product_key = 'communications'
    limit 1;
    new.plan_key := selected_plan_key;
  end if;

  new.plan_key := coalesce(new.plan_key, 'founding');
  select * into selected_plan
  from public.communications_plan_catalog
  where plan_key = new.plan_key;

  if found then
    new.included_sms_segments := selected_plan.included_sms_segments;
    new.included_email_deliveries := selected_plan.included_email_deliveries;
    new.sms_overage_cents := selected_plan.sms_overage_cents;
    new.mms_unit_cents := selected_plan.mms_unit_cents;
    new.email_overage_per_1000_cents := selected_plan.email_overage_per_1000_cents;
  end if;
  return new;
end;
$$;

revoke all on function public.apply_communications_plan_to_workspace() from public, anon, authenticated;
grant execute on function public.apply_communications_plan_to_workspace() to service_role;

drop trigger if exists communications_workspaces_apply_plan
  on public.communications_workspaces;
create trigger communications_workspaces_apply_plan
before insert on public.communications_workspaces
for each row execute function public.apply_communications_plan_to_workspace();

update public.organization_product_subscriptions
set plan_key = 'founding'
where product_key = 'communications'
  and stripe_price_id = 'price_1U8iNG4fYoWkBJCDueCP9iAe'
  and plan_key is null;

update public.communications_workspaces as workspace
set plan_key = coalesce(
  (
    select subscription.plan_key
    from public.organization_product_subscriptions as subscription
    where subscription.organization_id = workspace.organization_id
      and subscription.product_key = 'communications'
    limit 1
  ),
  'founding'
)
where workspace.plan_key is null;

update public.communications_workspaces as workspace
set
  included_sms_segments = plan.included_sms_segments,
  included_email_deliveries = plan.included_email_deliveries,
  sms_overage_cents = plan.sms_overage_cents,
  mms_unit_cents = plan.mms_unit_cents,
  email_overage_per_1000_cents = plan.email_overage_per_1000_cents
from public.communications_plan_catalog as plan
where plan.plan_key = workspace.plan_key;
