-- Internal foundation only for the future N3XRA Records Phone Meetings add-on.
-- This migration does not provision a Twilio number, enable calling, or expose
-- customer-facing activation. Phone credentials stay in server-side secrets.

-- Phone number assignment and activation remain platform-admin only during the
-- internal test. Organization administrators can see their status, but cannot
-- turn on a paid or recording-capable phone feature for themselves.

create table if not exists public.organization_phone_meeting_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  feature_enabled boolean not null default false,
  activation_status text not null default 'not_configured',
  primary_phone_number text,
  twilio_subaccount_sid text,
  twilio_phone_number_sid text,
  recording_notice_enabled boolean not null default true,
  recording_notice_text text not null default 'This call may be recorded for meeting notes.',
  default_retention_days integer not null default 30,
  monthly_minutes_limit integer,
  usage_billing_status text not null default 'not_configured',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_phone_meeting_settings_activation_status_check
    check (activation_status in ('not_configured', 'pending_compliance', 'ready_for_internal_test', 'active', 'suspended', 'disabled')),
  constraint organization_phone_meeting_settings_phone_format_check
    check (primary_phone_number is null or primary_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint organization_phone_meeting_settings_retention_check
    check (default_retention_days between 1 and 3650),
  constraint organization_phone_meeting_settings_minutes_limit_check
    check (monthly_minutes_limit is null or monthly_minutes_limit >= 0),
  constraint organization_phone_meeting_settings_billing_status_check
    check (usage_billing_status in ('not_configured', 'internal_only', 'stripe_ready', 'active', 'past_due', 'suspended'))
);

create unique index if not exists organization_phone_meeting_settings_twilio_phone_number_sid_key
  on public.organization_phone_meeting_settings (twilio_phone_number_sid)
  where twilio_phone_number_sid is not null;

create unique index if not exists organization_phone_meeting_settings_primary_phone_number_key
  on public.organization_phone_meeting_settings (primary_phone_number)
  where primary_phone_number is not null;

create table if not exists public.phone_meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_recording_id uuid unique references public.meeting_recordings (id) on delete set null,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  connection_method text not null,
  status text not null default 'draft',
  twilio_call_sid text,
  twilio_conference_sid text,
  twilio_recording_sid text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  billed_minutes numeric(12, 2) not null default 0,
  retention_until timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_meeting_sessions_connection_method_check
    check (connection_method in ('merge_line', 'dial_in', 'scheduled')),
  constraint phone_meeting_sessions_status_check
    check (status in ('draft', 'scheduled', 'connecting', 'in_progress', 'recording_ready', 'copying_to_storage', 'transcribing', 'ready', 'failed', 'canceled', 'void')),
  constraint phone_meeting_sessions_duration_check
    check (duration_seconds is null or duration_seconds >= 0),
  constraint phone_meeting_sessions_billed_minutes_check
    check (billed_minutes >= 0),
  constraint phone_meeting_sessions_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create unique index if not exists phone_meeting_sessions_twilio_call_sid_key
  on public.phone_meeting_sessions (twilio_call_sid)
  where twilio_call_sid is not null;

create unique index if not exists phone_meeting_sessions_twilio_recording_sid_key
  on public.phone_meeting_sessions (twilio_recording_sid)
  where twilio_recording_sid is not null;

create index if not exists phone_meeting_sessions_organization_created_idx
  on public.phone_meeting_sessions (organization_id, created_at desc);

create index if not exists phone_meeting_sessions_status_idx
  on public.phone_meeting_sessions (status, created_at desc);

create table if not exists public.phone_meeting_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_meeting_session_id uuid references public.phone_meeting_sessions (id) on delete set null,
  event_type text not null,
  quantity numeric(12, 2) not null,
  unit text not null default 'minute',
  source text not null default 'internal',
  stripe_usage_record_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint phone_meeting_usage_events_type_check
    check (event_type in ('activation', 'phone_number', 'call_minute', 'recording_minute', 'transcription_minute', 'credit', 'adjustment')),
  constraint phone_meeting_usage_events_quantity_check
    check (quantity >= 0),
  constraint phone_meeting_usage_events_unit_check
    check (unit in ('minute', 'number', 'activation', 'credit')),
  constraint phone_meeting_usage_events_source_check
    check (source in ('internal', 'stripe', 'twilio', 'admin_adjustment')),
  constraint phone_meeting_usage_events_metadata_object_check
    check (jsonb_typeof(metadata) = 'object')
);

create index if not exists phone_meeting_usage_events_organization_occurred_idx
  on public.phone_meeting_usage_events (organization_id, occurred_at desc);

create index if not exists phone_meeting_usage_events_session_idx
  on public.phone_meeting_usage_events (phone_meeting_session_id, occurred_at desc);

drop trigger if exists organization_phone_meeting_settings_set_updated_at on public.organization_phone_meeting_settings;
create trigger organization_phone_meeting_settings_set_updated_at
before update on public.organization_phone_meeting_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists phone_meeting_sessions_set_updated_at on public.phone_meeting_sessions;
create trigger phone_meeting_sessions_set_updated_at
before update on public.phone_meeting_sessions
for each row execute procedure public.set_updated_at();

grant select, insert, update on public.organization_phone_meeting_settings to authenticated;
grant select on public.phone_meeting_sessions to authenticated;
grant select on public.phone_meeting_usage_events to authenticated;
grant all on public.organization_phone_meeting_settings, public.phone_meeting_sessions, public.phone_meeting_usage_events to service_role;

alter table public.organization_phone_meeting_settings enable row level security;
alter table public.phone_meeting_sessions enable row level security;
alter table public.phone_meeting_usage_events enable row level security;

drop policy if exists "organization_phone_meeting_settings_select_policy" on public.organization_phone_meeting_settings;
create policy "organization_phone_meeting_settings_select_policy"
on public.organization_phone_meeting_settings
for select to authenticated
using (public.can_view_organization(organization_id));

drop policy if exists "organization_phone_meeting_settings_insert_policy" on public.organization_phone_meeting_settings;
create policy "organization_phone_meeting_settings_insert_policy"
on public.organization_phone_meeting_settings
for insert to authenticated
with check (public.is_platform_admin());

drop policy if exists "organization_phone_meeting_settings_update_policy" on public.organization_phone_meeting_settings;
create policy "organization_phone_meeting_settings_update_policy"
on public.organization_phone_meeting_settings
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "phone_meeting_sessions_select_policy" on public.phone_meeting_sessions;
create policy "phone_meeting_sessions_select_policy"
on public.phone_meeting_sessions
for select to authenticated
using (public.can_view_organization(organization_id));

drop policy if exists "phone_meeting_usage_events_select_policy" on public.phone_meeting_usage_events;
create policy "phone_meeting_usage_events_select_policy"
on public.phone_meeting_usage_events
for select to authenticated
using (public.can_view_organization(organization_id));
