alter table public.website_change_runs
  add column if not exists merge_sha text,
  add column if not exists production_deployment_url text,
  add column if not exists production_ready_at timestamptz,
  add column if not exists building_email_sent_at timestamptz;

alter table public.website_change_runs
  drop constraint if exists website_change_runs_merge_sha_check,
  add constraint website_change_runs_merge_sha_check
    check (merge_sha is null or merge_sha ~ '^[0-9a-f]{40}$'),
  drop constraint if exists website_change_runs_production_deployment_url_check,
  add constraint website_change_runs_production_deployment_url_check
    check (production_deployment_url is null or production_deployment_url ~ '^https://[^/[:space:]]+[.]vercel[.]app/?$');

alter table public.website_change_runs
  drop constraint if exists website_change_runs_progress_stage_check,
  add constraint website_change_runs_progress_stage_check
    check (progress_stage in (
      'queued',
      'codex_running',
      'validating',
      'deploying',
      'preview_ready',
      'failed',
      'merged',
      'production_deploying',
      'published',
      'production_failed'
    ));

grant select (
  merge_sha,
  production_deployment_url,
  production_ready_at,
  building_email_sent_at
) on public.website_change_runs to authenticated;

comment on column public.website_change_runs.merge_sha is
  'Exact main-branch commit whose Vercel production deployment must succeed before the change is announced as live.';

comment on column public.website_change_runs.production_ready_at is
  'When Vercel reported that the approved main-branch commit was ready in production.';

comment on column public.website_change_runs.building_email_sent_at is
  'When the requester was told that the approved production deployment was building.';;
