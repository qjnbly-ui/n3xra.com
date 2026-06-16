create extension if not exists pgcrypto;

create table if not exists public.virals_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_type text not null,
  analysis_id uuid,
  video_id uuid,
  input_count integer not null default 1,
  model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  constraint virals_usage_events_event_type_check
    check (event_type in ('single_analysis', 'compare_analysis', 'transcript_fetch', 'script_save')),
  constraint virals_usage_events_input_count_check
    check (input_count >= 0),
  constraint virals_usage_events_token_check
    check (prompt_tokens >= 0 and completion_tokens >= 0 and total_tokens >= 0)
);

create table if not exists public.virals_videos (
  id uuid primary key default gen_random_uuid(),
  master_user_id uuid not null,
  organization_id uuid,
  source_url text not null,
  platform text,
  external_video_id text,
  title text,
  description text,
  creator_name text,
  creator_handle text,
  thumbnail_url text,
  duration_seconds integer,
  published_at timestamptz,
  metrics jsonb not null default '{}'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.virals_videos
  add column if not exists first_analyzed_at timestamptz not null default now(),
  add column if not exists last_analyzed_at timestamptz not null default now(),
  add column if not exists latest_metrics_captured_at timestamptz,
  add column if not exists metrics_source text;

create table if not exists public.virals_transcripts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.virals_videos(id) on delete cascade,
  transcript_text text,
  transcript_segments jsonb not null default '[]'::jsonb,
  language text,
  source text,
  created_at timestamptz not null default now()
);

create table if not exists public.virals_ai_analyses (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.virals_videos(id) on delete cascade,
  master_user_id uuid not null,
  organization_id uuid,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  summary text,
  hook text,
  hook_breakdown jsonb not null default '{}'::jsonb,
  structure_breakdown jsonb not null default '{}'::jsonb,
  retention_notes jsonb not null default '{}'::jsonb,
  emotional_triggers jsonb not null default '[]'::jsonb,
  engagement_drivers jsonb not null default '[]'::jsonb,
  audience_targeting jsonb not null default '{}'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  weaknesses jsonb not null default '[]'::jsonb,
  why_it_works text,
  improvement_notes text,
  model text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virals_generated_hooks (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.virals_ai_analyses(id) on delete cascade,
  hook_type text not null,
  hook_text text not null,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.virals_generated_scripts (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid references public.virals_ai_analyses(id) on delete set null,
  master_user_id uuid not null,
  organization_id uuid,
  script_type text not null,
  title text,
  script_text text not null,
  platform text,
  status text not null default 'draft' check (status in ('draft', 'saved', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virals_generated_captions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.virals_ai_analyses(id) on delete cascade,
  caption_text text not null,
  cta_text text,
  platform text,
  created_at timestamptz not null default now()
);

create table if not exists public.virals_creators (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  handle text not null,
  display_name text,
  profile_url text,
  avatar_url text,
  follower_count integer,
  metrics jsonb not null default '{}'::jsonb,
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, handle)
);

create table if not exists public.virals_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  platform text,
  shop_product_id text,
  product_url text,
  image_url text,
  category text,
  niche text,
  offer text,
  confidence text,
  data_source text,
  claims jsonb not null default '[]'::jsonb,
  objections jsonb not null default '[]'::jsonb,
  proof_points jsonb not null default '[]'::jsonb,
  cta_path text,
  api_readiness text,
  metrics jsonb not null default '{}'::jsonb,
  opportunity_score numeric(5, 2),
  raw_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virals_video_products (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.virals_videos(id) on delete cascade,
  product_id uuid not null references public.virals_products(id) on delete cascade,
  relationship_source text not null default 'resolver',
  confidence text,
  created_at timestamptz not null default now(),
  unique (video_id, product_id)
);

create table if not exists public.virals_trends (
  id uuid primary key default gen_random_uuid(),
  platform text,
  trend_type text not null,
  name text not null,
  category text,
  niche text,
  velocity_score numeric(5, 2),
  viral_score numeric(5, 2),
  metrics jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virals_video_search_stats (
  id uuid primary key default gen_random_uuid(),
  normalized_url text not null unique,
  platform text not null default 'tiktok',
  external_video_id text,
  title text,
  creator_handle text,
  thumbnail_url text,
  search_count integer not null default 1,
  analysis_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  latest_video_id uuid references public.virals_videos(id) on delete set null,
  latest_analysis_id uuid references public.virals_ai_analyses(id) on delete set null,
  latest_metrics jsonb not null default '{}'::jsonb,
  latest_framework jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.virals_daily_video_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  platform text not null default 'tiktok',
  video_id uuid references public.virals_videos(id) on delete set null,
  external_video_id text,
  source_url text,
  title text,
  creator_handle text,
  thumbnail_url text,
  rank integer,
  viral_score numeric(6, 2),
  velocity_score numeric(6, 2),
  metrics jsonb not null default '{}'::jsonb,
  framework_summary jsonb not null default '{}'::jsonb,
  source text not null default 'n3xra_analysis_snapshot',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (snapshot_date, platform, external_video_id, source)
);

create table if not exists public.virals_daily_creator_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  platform text not null default 'tiktok',
  creator_id uuid references public.virals_creators(id) on delete set null,
  handle text not null,
  display_name text,
  rank integer,
  viral_score numeric(6, 2),
  velocity_score numeric(6, 2),
  analyzed_video_count integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  source text not null default 'n3xra_analysis_snapshot',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (snapshot_date, platform, handle, source)
);

create table if not exists public.virals_daily_product_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_date date not null default current_date,
  platform text not null default 'tiktok',
  product_id uuid references public.virals_products(id) on delete set null,
  product_name text not null,
  shop_product_id text,
  rank integer,
  opportunity_score numeric(6, 2),
  viral_score numeric(6, 2),
  analyzed_video_count integer not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  framework_summary jsonb not null default '{}'::jsonb,
  source text not null default 'n3xra_analysis_snapshot',
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (snapshot_date, platform, product_name, source)
);

create table if not exists public.virals_saved_scripts (
  id uuid primary key default gen_random_uuid(),
  master_user_id uuid not null,
  organization_id uuid,
  source_analysis_id uuid references public.virals_ai_analyses(id) on delete set null,
  title text not null,
  script_text text not null,
  notes text,
  source_url text,
  product text,
  niche text,
  goal text,
  hook_type text,
  context jsonb not null default '{}'::jsonb,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.virals_saved_scripts
  add column if not exists source_url text,
  add column if not exists product text,
  add column if not exists niche text,
  add column if not exists goal text,
  add column if not exists hook_type text,
  add column if not exists context jsonb not null default '{}'::jsonb;

create index if not exists virals_videos_owner_idx on public.virals_videos(master_user_id, organization_id);
create index if not exists virals_videos_last_analyzed_idx on public.virals_videos(last_analyzed_at desc);
create index if not exists virals_usage_events_user_created_idx on public.virals_usage_events(user_id, created_at desc);
create index if not exists virals_videos_source_url_idx on public.virals_videos(source_url);
create index if not exists virals_analyses_video_idx on public.virals_ai_analyses(video_id);
create index if not exists virals_analyses_owner_idx on public.virals_ai_analyses(master_user_id, organization_id);
create index if not exists virals_generated_hooks_analysis_idx on public.virals_generated_hooks(analysis_id);
create index if not exists virals_generated_scripts_owner_idx on public.virals_generated_scripts(master_user_id, organization_id);
create index if not exists virals_creators_platform_handle_idx on public.virals_creators(platform, handle);
create index if not exists virals_products_shop_product_id_idx on public.virals_products(platform, shop_product_id);
create index if not exists virals_products_name_category_idx on public.virals_products(name, category);
create index if not exists virals_video_products_product_idx on public.virals_video_products(product_id);
create index if not exists virals_video_products_video_idx on public.virals_video_products(video_id);
create index if not exists virals_trends_type_platform_idx on public.virals_trends(trend_type, platform);
create index if not exists virals_video_search_stats_count_idx on public.virals_video_search_stats(search_count desc, last_seen_at desc);
create index if not exists virals_daily_video_snapshots_date_rank_idx on public.virals_daily_video_snapshots(snapshot_date desc, rank);
create index if not exists virals_daily_creator_snapshots_date_rank_idx on public.virals_daily_creator_snapshots(snapshot_date desc, rank);
create index if not exists virals_daily_product_snapshots_date_rank_idx on public.virals_daily_product_snapshots(snapshot_date desc, rank);
create index if not exists virals_saved_scripts_owner_idx on public.virals_saved_scripts(master_user_id, organization_id);

alter table public.virals_usage_events enable row level security;
alter table public.virals_videos enable row level security;
alter table public.virals_transcripts enable row level security;
alter table public.virals_ai_analyses enable row level security;
alter table public.virals_generated_hooks enable row level security;
alter table public.virals_generated_scripts enable row level security;
alter table public.virals_generated_captions enable row level security;
alter table public.virals_creators enable row level security;
alter table public.virals_products enable row level security;
alter table public.virals_video_products enable row level security;
alter table public.virals_trends enable row level security;
alter table public.virals_video_search_stats enable row level security;
alter table public.virals_daily_video_snapshots enable row level security;
alter table public.virals_daily_creator_snapshots enable row level security;
alter table public.virals_daily_product_snapshots enable row level security;
alter table public.virals_saved_scripts enable row level security;

create or replace function public.set_virals_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_virals_videos_updated_at on public.virals_videos;
create trigger set_virals_videos_updated_at
before update on public.virals_videos
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_ai_analyses_updated_at on public.virals_ai_analyses;
create trigger set_virals_ai_analyses_updated_at
before update on public.virals_ai_analyses
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_generated_scripts_updated_at on public.virals_generated_scripts;
create trigger set_virals_generated_scripts_updated_at
before update on public.virals_generated_scripts
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_creators_updated_at on public.virals_creators;
create trigger set_virals_creators_updated_at
before update on public.virals_creators
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_products_updated_at on public.virals_products;
create trigger set_virals_products_updated_at
before update on public.virals_products
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_trends_updated_at on public.virals_trends;
create trigger set_virals_trends_updated_at
before update on public.virals_trends
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_video_search_stats_updated_at on public.virals_video_search_stats;
create trigger set_virals_video_search_stats_updated_at
before update on public.virals_video_search_stats
for each row execute function public.set_virals_updated_at();

drop trigger if exists set_virals_saved_scripts_updated_at on public.virals_saved_scripts;
create trigger set_virals_saved_scripts_updated_at
before update on public.virals_saved_scripts
for each row execute function public.set_virals_updated_at();
