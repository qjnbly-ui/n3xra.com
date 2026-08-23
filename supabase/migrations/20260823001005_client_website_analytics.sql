alter table public.website_portal_features
drop constraint if exists website_portal_features_key_check;

alter table public.website_portal_features
add constraint website_portal_features_key_check check (feature_key in (
  'overview', 'progress', 'files_assets', 'services', 'billing', 'support', 'analytics'
));

create table public.website_analytics_connections (
  website_id uuid primary key references public.client_websites (id) on delete cascade,
  provider text not null default 'vercel',
  project_id text not null,
  project_name text,
  team_id text,
  status text not null default 'active',
  last_verified_at timestamptz not null default now(),
  archive_status text not null default 'pending',
  archive_started_on date,
  archive_last_synced_at timestamptz,
  archive_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_analytics_connections_provider_check check (provider in ('vercel')),
  constraint website_analytics_connections_project_id_check check (project_id ~ '^prj_[A-Za-z0-9]+$'),
  constraint website_analytics_connections_status_check check (status in ('active', 'attention', 'disconnected')),
  constraint website_analytics_connections_archive_status_check check (archive_status in ('pending', 'syncing', 'healthy', 'attention')),
  constraint website_analytics_connections_metadata_check check (jsonb_typeof(metadata) = 'object')
);

drop trigger if exists website_analytics_connections_set_updated_at on public.website_analytics_connections;
create trigger website_analytics_connections_set_updated_at
before update on public.website_analytics_connections
for each row execute function public.set_updated_at();

alter table public.website_analytics_connections enable row level security;

revoke all on public.website_analytics_connections from public, anon, authenticated;
grant all on public.website_analytics_connections to service_role;

create table public.website_analytics_daily (
  website_id uuid not null references public.client_websites (id) on delete cascade,
  metric_date date not null,
  pageviews bigint not null default 0,
  visitors bigint not null default 0,
  events bigint not null default 0,
  source text not null default 'vercel',
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (website_id, metric_date),
  constraint website_analytics_daily_pageviews_check check (pageviews >= 0),
  constraint website_analytics_daily_visitors_check check (visitors >= 0),
  constraint website_analytics_daily_events_check check (events >= 0),
  constraint website_analytics_daily_source_check check (source in ('vercel'))
);

drop trigger if exists website_analytics_daily_set_updated_at on public.website_analytics_daily;
create trigger website_analytics_daily_set_updated_at
before update on public.website_analytics_daily
for each row execute function public.set_updated_at();

create index website_analytics_daily_date_idx
on public.website_analytics_daily (metric_date desc, website_id);

alter table public.website_analytics_daily enable row level security;

revoke all on public.website_analytics_daily from public, anon, authenticated;
grant all on public.website_analytics_daily to service_role;

create table public.website_analytics_sync_runs (
  id uuid primary key default gen_random_uuid(),
  website_id uuid not null references public.client_websites (id) on delete cascade,
  status text not null default 'running',
  requested_days integer not null,
  stored_days integer not null default 0,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  constraint website_analytics_sync_runs_status_check check (status in ('running', 'succeeded', 'failed')),
  constraint website_analytics_sync_runs_requested_days_check check (requested_days between 1 and 730),
  constraint website_analytics_sync_runs_stored_days_check check (stored_days >= 0),
  constraint website_analytics_sync_runs_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index website_analytics_sync_runs_website_started_idx
on public.website_analytics_sync_runs (website_id, started_at desc);

alter table public.website_analytics_sync_runs enable row level security;

revoke all on public.website_analytics_sync_runs from public, anon, authenticated;
grant all on public.website_analytics_sync_runs to service_role;

create table public.website_public_traffic_counters (
  website_id uuid primary key references public.client_websites (id) on delete cascade,
  enabled boolean not null default false,
  metric text not null default 'all_time_pageviews',
  label text not null default 'Website visits',
  public_key uuid not null default gen_random_uuid() unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_public_traffic_counters_metric_check check (metric in ('all_time_pageviews', 'daily_visitors')),
  constraint website_public_traffic_counters_label_check check (char_length(label) between 1 and 80)
);

drop trigger if exists website_public_traffic_counters_set_updated_at on public.website_public_traffic_counters;
create trigger website_public_traffic_counters_set_updated_at
before update on public.website_public_traffic_counters
for each row execute function public.set_updated_at();

alter table public.website_public_traffic_counters enable row level security;

revoke all on public.website_public_traffic_counters from public, anon, authenticated;
grant select, insert, update, delete on public.website_public_traffic_counters to authenticated;
grant all on public.website_public_traffic_counters to service_role;

create policy "Platform admins can read public traffic counter settings"
on public.website_public_traffic_counters for select
to authenticated
using ((select public.is_platform_admin()));

create policy "Platform admins can create public traffic counter settings"
on public.website_public_traffic_counters for insert
to authenticated
with check ((select public.is_platform_admin()));

create policy "Platform admins can update public traffic counter settings"
on public.website_public_traffic_counters for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "Platform admins can delete public traffic counter settings"
on public.website_public_traffic_counters for delete
to authenticated
using ((select public.is_platform_admin()));

insert into public.website_portal_features (website_id, feature_key, enabled)
select website.id, 'analytics', false
from public.client_websites website
on conflict (website_id, feature_key) do nothing;
