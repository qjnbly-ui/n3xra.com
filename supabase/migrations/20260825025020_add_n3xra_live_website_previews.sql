alter table public.client_websites
  add column if not exists live_preview_enabled boolean not null default false;

comment on column public.client_websites.live_preview_enabled is
  'Feature flag for the N3XRA-hosted preview path. Vercel preview remains available regardless of this value.';

alter table public.website_change_runs
  add column if not exists preview_mode text not null default 'vercel',
  add column if not exists preview_token_hash text,
  add column if not exists preview_expires_at timestamptz,
  add column if not exists base_sha text,
  add column if not exists source_manifest_path text;

alter table public.website_change_runs
  drop constraint if exists website_change_runs_preview_mode_check,
  add constraint website_change_runs_preview_mode_check
    check (preview_mode in ('vercel', 'n3xra_live')),
  drop constraint if exists website_change_runs_preview_token_hash_check,
  add constraint website_change_runs_preview_token_hash_check
    check (preview_token_hash is null or preview_token_hash ~ '^[0-9a-f]{64}$'),
  drop constraint if exists website_change_runs_base_sha_check,
  add constraint website_change_runs_base_sha_check
    check (base_sha is null or base_sha ~ '^[0-9a-f]{40}$'),
  drop constraint if exists website_change_runs_source_manifest_path_check,
  add constraint website_change_runs_source_manifest_path_check
    check (source_manifest_path is null or source_manifest_path ~ '^runs/[0-9a-f-]{36}/source/manifest[.]json$');

alter table public.website_change_runs
  drop constraint if exists website_change_runs_preview_url_check,
  add constraint website_change_runs_preview_url_check
    check (
      preview_url is null
      or preview_url ~ '^https://[^/[:space:]]+[.]vercel[.]app/?$'
      or preview_url ~ '^https://(www[.])?n3xra[.]com/website-preview/[0-9a-f-]{36}/[A-Za-z0-9_-]{32,200}/?$'
    );

grant select (
  preview_mode,
  preview_expires_at
) on public.website_change_runs to authenticated;

insert into storage.buckets (id, name, public, file_size_limit)
values ('website-change-previews', 'website-change-previews', false, 4194304)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

comment on column public.website_change_runs.preview_mode is
  'vercel preserves the existing branch deployment; n3xra_live stores a temporary static build and defers the GitHub commit until approval.';

comment on column public.website_change_runs.preview_token_hash is
  'Hash of the expiring bearer token embedded in a shareable N3XRA preview link.';

comment on column public.website_change_runs.source_manifest_path is
  'Service-only Storage manifest containing the reviewed source changes that may be committed after approval.';
