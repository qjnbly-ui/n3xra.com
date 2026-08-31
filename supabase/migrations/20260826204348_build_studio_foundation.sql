create table public.website_build_sessions (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.client_websites (id) on delete cascade,
  organization_id uuid references public.organizations (id) on delete set null,
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  worker_session_id text,
  codex_thread_id text,
  repository_full_name text not null,
  base_branch text not null default 'main',
  working_branch text not null,
  state text not null default 'preparing',
  preview_state text not null default 'offline',
  preview_url text,
  changed_file_count integer not null default 0,
  last_summary text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint website_build_sessions_state_check check (state in ('preparing', 'ready', 'working', 'awaiting_approval', 'failed', 'stopped', 'archived')),
  constraint website_build_sessions_preview_state_check check (preview_state in ('offline', 'starting', 'ready', 'failed')),
  constraint website_build_sessions_repository_check check (repository_full_name ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  constraint website_build_sessions_branch_check check (length(trim(working_branch)) between 1 and 240),
  constraint website_build_sessions_changed_files_check check (changed_file_count >= 0)
);

create table public.website_build_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.website_build_sessions (id) on delete cascade,
  website_id uuid not null references public.client_websites (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint website_build_events_type_check check (event_type in ('session', 'user_message', 'agent_message', 'status', 'preview', 'checkpoint', 'push', 'error')),
  constraint website_build_events_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create unique index website_build_sessions_active_user_website_idx
on public.website_build_sessions (website_id, created_by_user_id)
where archived_at is null;

create index website_build_sessions_website_activity_idx
on public.website_build_sessions (website_id, last_activity_at desc);

create index website_build_events_session_created_idx
on public.website_build_events (session_id, created_at, id);

create trigger website_build_sessions_set_updated_at
before update on public.website_build_sessions
for each row execute function public.set_updated_at();

alter table public.website_build_sessions enable row level security;
alter table public.website_build_events enable row level security;

revoke all on table public.website_build_sessions from public, anon, authenticated;
revoke all on table public.website_build_events from public, anon, authenticated;
grant select on table public.website_build_sessions to authenticated;
grant select on table public.website_build_events to authenticated;
grant select, insert, update, delete on table public.website_build_sessions to service_role;
grant select, insert, update, delete on table public.website_build_events to service_role;
grant usage, select on sequence public.website_build_events_id_seq to service_role;

create policy "website_build_sessions_admin_select"
on public.website_build_sessions
for select
to authenticated
using ((select public.is_platform_admin()));

create policy "website_build_events_admin_select"
on public.website_build_events
for select
to authenticated
using ((select public.is_platform_admin()));

comment on table public.website_build_sessions is
  'Server-managed N3XRA Build Studio sessions. ChatGPT credentials remain on the private worker and are never stored here.';

comment on table public.website_build_events is
  'Append-only audit and conversation events emitted by the private Build Studio worker.';
;
