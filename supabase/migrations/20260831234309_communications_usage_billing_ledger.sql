create table public.communications_usage_invoices (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete restrict,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  stripe_subscription_id text not null,
  stripe_invoice_id text not null unique,
  plan_key text references public.communications_plan_catalog (plan_key) on delete restrict,
  period_start timestamptz not null,
  period_end timestamptz not null,
  sms_segments integer not null default 0,
  included_sms_segments integer not null default 0,
  sms_overage_segments integer not null default 0,
  sms_overage_cents integer not null default 0,
  outbound_mms_units integer not null default 0,
  mms_unit_cents integer not null default 0,
  email_deliveries integer not null default 0,
  included_email_deliveries integer not null default 0,
  email_overage_thousands integer not null default 0,
  email_overage_per_1000_cents integer not null default 0,
  total_overage_cents integer not null default 0,
  stripe_invoice_item_ids jsonb not null default '{}'::jsonb,
  status text not null default 'prepared',
  error_message text,
  invoiced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_usage_invoices_period_check check (period_end >= period_start),
  constraint communications_usage_invoices_counts_check check (
    sms_segments >= 0
    and included_sms_segments >= 0
    and sms_overage_segments >= 0
    and sms_overage_cents >= 0
    and outbound_mms_units >= 0
    and mms_unit_cents >= 0
    and email_deliveries >= 0
    and included_email_deliveries >= 0
    and email_overage_thousands >= 0
    and email_overage_per_1000_cents >= 0
    and total_overage_cents >= 0
  ),
  constraint communications_usage_invoices_status_check
    check (status in ('prepared', 'invoiced', 'skipped', 'failed')),
  constraint communications_usage_invoices_items_check
    check (jsonb_typeof(stripe_invoice_item_ids) = 'object')
);

create index communications_usage_invoices_organization_period_idx
  on public.communications_usage_invoices (organization_id, period_end desc);

create index communications_usage_invoices_status_idx
  on public.communications_usage_invoices (status, period_end desc);

create trigger communications_usage_invoices_set_updated_at
before update on public.communications_usage_invoices
for each row execute function public.set_updated_at();

alter table public.communications_usage_invoices enable row level security;
revoke all on public.communications_usage_invoices from public, anon, authenticated;
grant all on public.communications_usage_invoices to service_role;

comment on table public.communications_usage_invoices is
  'Service-only, idempotent ledger of Communications usage attached to Stripe subscription invoices.';

create or replace function public.communications_usage_for_period(
  input_workspace_id uuid,
  input_period_start timestamptz,
  input_period_end timestamptz
)
returns table (
  sms_segments bigint,
  outbound_mms_units bigint,
  email_deliveries bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    coalesce(sum(message.sms_segment_count) filter (
      where message.direction = 'outbound' and message.channel = 'sms'
    ), 0)::bigint as sms_segments,
    coalesce(sum(greatest(message.billable_units, 1)) filter (
      where message.direction = 'outbound' and message.channel = 'mms'
    ), 0)::bigint as outbound_mms_units,
    coalesce(sum(greatest(message.billable_units, 1)) filter (
      where message.direction = 'outbound' and message.channel = 'email'
    ), 0)::bigint as email_deliveries
  from public.communications_message_events as message
  where message.workspace_id = input_workspace_id
    and message.occurred_at >= input_period_start
    and message.occurred_at < input_period_end
    and message.status <> 'failed';
$$;

revoke all on function public.communications_usage_for_period(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.communications_usage_for_period(uuid, timestamptz, timestamptz)
  to service_role;

drop view if exists public.communications_workspace_metrics;
create view public.communications_workspace_metrics
with (security_invoker = true)
as
select
  workspace.id as workspace_id,
  (select count(*) from public.communications_subscribers subscriber
    where subscriber.workspace_id = workspace.id)::bigint as total_subscribers,
  (select count(*) from public.communications_subscribers subscriber
    where subscriber.workspace_id = workspace.id and subscriber.sms_status = 'subscribed')::bigint as sms_subscribers,
  (select count(*) from public.communications_subscribers subscriber
    where subscriber.workspace_id = workspace.id and subscriber.email_status = 'subscribed')::bigint as email_subscribers,
  (select count(*) from public.communications_topics topic
    where topic.workspace_id = workspace.id and topic.active)::bigint as active_topics,
  (select count(*) from public.communications_consent_events consent
    where consent.workspace_id = workspace.id)::bigint as consent_events,
  (select count(*) from public.communications_message_events message
    where message.workspace_id = workspace.id)::bigint as message_events,
  (select coalesce(sum(message.sms_segment_count), 0)
    from public.communications_message_events message
    where message.workspace_id = workspace.id
      and message.direction = 'outbound'
      and message.channel = 'sms'
      and message.status <> 'failed'
      and message.occurred_at >= date_trunc('month', now()))::bigint as sms_segments_current_month,
  (select coalesce(sum(greatest(message.billable_units, 1)), 0)
    from public.communications_message_events message
    where message.workspace_id = workspace.id
      and message.direction = 'outbound'
      and message.channel = 'email'
      and message.status <> 'failed'
      and message.occurred_at >= date_trunc('month', now()))::bigint as email_deliveries_current_month,
  (select coalesce(sum(greatest(message.billable_units, 1)), 0)
    from public.communications_message_events message
    where message.workspace_id = workspace.id
      and message.direction = 'outbound'
      and message.channel = 'mms'
      and message.status <> 'failed'
      and message.occurred_at >= date_trunc('month', now()))::bigint as outbound_mms_current_month
from public.communications_workspaces workspace;

revoke all on public.communications_workspace_metrics from public, anon, authenticated;
grant select on public.communications_workspace_metrics to authenticated, service_role;
