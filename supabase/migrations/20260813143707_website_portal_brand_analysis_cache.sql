create table if not exists public.website_portal_brand_analysis_cache (
  website_id uuid primary key references public.client_websites (id) on delete cascade,
  source_fingerprint text not null,
  analysis jsonb not null default '{}'::jsonb,
  provider text not null,
  model text not null,
  analyzed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  updated_at timestamptz not null default now(),
  constraint website_portal_brand_analysis_cache_fingerprint_check
    check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint website_portal_brand_analysis_cache_provider_check
    check (char_length(trim(provider)) between 1 and 40),
  constraint website_portal_brand_analysis_cache_model_check
    check (char_length(trim(model)) between 1 and 120),
  constraint website_portal_brand_analysis_cache_expiry_check
    check (expires_at > analyzed_at)
);

drop trigger if exists website_portal_brand_analysis_cache_set_updated_at
on public.website_portal_brand_analysis_cache;

create trigger website_portal_brand_analysis_cache_set_updated_at
before update on public.website_portal_brand_analysis_cache
for each row execute function public.set_updated_at();

alter table public.website_portal_brand_analysis_cache enable row level security;

revoke all on public.website_portal_brand_analysis_cache from anon, authenticated;
grant select, insert, update, delete on public.website_portal_brand_analysis_cache to service_role;

comment on table public.website_portal_brand_analysis_cache is
  'Backend-only cache for guarded AI branding recommendations created from an explicit admin refresh.';
