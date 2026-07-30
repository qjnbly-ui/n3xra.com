-- Infrastructure for Phone Meetings retention automation and monthly usage
-- reporting. Cleanup is intentionally disabled for every library by default.

alter table public.organization_phone_meeting_settings
  add column if not exists retention_cleanup_enabled boolean not null default false,
  add column if not exists usage_reporting_enabled boolean not null default true,
  add column if not exists last_retention_run_at timestamptz,
  add column if not exists last_usage_rollup_at timestamptz;

create table if not exists public.phone_meeting_retention_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_meeting_session_id uuid not null references public.phone_meeting_sessions (id) on delete cascade,
  meeting_recording_id uuid references public.meeting_recordings (id) on delete set null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_meeting_retention_jobs_session_key unique (phone_meeting_session_id),
  constraint phone_meeting_retention_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'skipped', 'failed', 'canceled')),
  constraint phone_meeting_retention_jobs_attempts_check check (attempts >= 0),
  constraint phone_meeting_retention_jobs_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists phone_meeting_retention_jobs_organization_scheduled_idx
  on public.phone_meeting_retention_jobs (organization_id, scheduled_for desc);

create index if not exists phone_meeting_retention_jobs_due_idx
  on public.phone_meeting_retention_jobs (scheduled_for, id)
  where status in ('pending', 'failed');

drop trigger if exists phone_meeting_retention_jobs_set_updated_at on public.phone_meeting_retention_jobs;
create trigger phone_meeting_retention_jobs_set_updated_at
before update on public.phone_meeting_retention_jobs
for each row execute procedure public.set_updated_at();

create or replace function public.queue_phone_meeting_retention_job()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.retention_until is null or new.status in ('canceled', 'void') then
    update public.phone_meeting_retention_jobs
       set status = 'canceled',
           locked_at = null,
           last_error = null
     where phone_meeting_session_id = new.id
       and status in ('pending', 'processing', 'failed');
    return new;
  end if;

  insert into public.phone_meeting_retention_jobs (
    organization_id,
    phone_meeting_session_id,
    meeting_recording_id,
    scheduled_for,
    status
  )
  values (
    new.organization_id,
    new.id,
    new.meeting_recording_id,
    new.retention_until,
    'pending'
  )
  on conflict (phone_meeting_session_id) do update
    set organization_id = excluded.organization_id,
        meeting_recording_id = excluded.meeting_recording_id,
        scheduled_for = excluded.scheduled_for,
        status = case
          when public.phone_meeting_retention_jobs.status = 'completed' then 'completed'
          else 'pending'
        end,
        locked_at = null,
        last_error = null;

  return new;
end;
$$;

drop trigger if exists phone_meeting_sessions_queue_retention_job on public.phone_meeting_sessions;
create trigger phone_meeting_sessions_queue_retention_job
after insert or update of retention_until, meeting_recording_id, status
on public.phone_meeting_sessions
for each row execute function public.queue_phone_meeting_retention_job();

insert into public.phone_meeting_retention_jobs (
  organization_id,
  phone_meeting_session_id,
  meeting_recording_id,
  scheduled_for,
  status
)
select
  organization_id,
  id,
  meeting_recording_id,
  retention_until,
  case when status in ('canceled', 'void') then 'canceled' else 'pending' end
from public.phone_meeting_sessions
where retention_until is not null
on conflict (phone_meeting_session_id) do nothing;

create or replace view public.phone_meeting_monthly_usage
with (security_invoker = true)
as
select
  organization_id,
  date_trunc('month', occurred_at)::date as usage_month,
  coalesce(sum(quantity) filter (where event_type = 'call_minute'), 0)::numeric(12, 2) as call_minutes,
  coalesce(sum(quantity) filter (where event_type = 'recording_minute'), 0)::numeric(12, 2) as recording_minutes,
  coalesce(sum(quantity) filter (where event_type = 'transcription_minute'), 0)::numeric(12, 2) as transcription_minutes,
  coalesce(sum(quantity) filter (where event_type = 'phone_number'), 0)::numeric(12, 2) as phone_numbers,
  coalesce(sum(quantity) filter (where event_type = 'activation'), 0)::numeric(12, 2) as activations,
  coalesce(sum(quantity) filter (where event_type = 'adjustment'), 0)::numeric(12, 2) as adjustments,
  coalesce(sum(quantity) filter (where event_type = 'credit'), 0)::numeric(12, 2) as credits,
  count(*)::integer as event_count,
  max(occurred_at) as last_event_at
from public.phone_meeting_usage_events
group by organization_id, date_trunc('month', occurred_at)::date;

grant select on public.phone_meeting_retention_jobs to authenticated;
grant select on public.phone_meeting_monthly_usage to authenticated;
grant all on public.phone_meeting_retention_jobs to service_role;
grant select on public.phone_meeting_monthly_usage to service_role;

alter table public.phone_meeting_retention_jobs enable row level security;

drop policy if exists "phone_meeting_retention_jobs_select_policy" on public.phone_meeting_retention_jobs;
create policy "phone_meeting_retention_jobs_select_policy"
on public.phone_meeting_retention_jobs
for select to authenticated
using ((select public.can_view_organization(organization_id)));
