alter table public.website_change_runs
  add column if not exists revision_count integer not null default 0,
  add column if not exists approval_submitted_at timestamptz,
  add column if not exists vercel_fallback_requested_at timestamptz,
  add column if not exists abandoned_at timestamptz,
  add column if not exists abandoned_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists storage_prefix text,
  add column if not exists pending_storage_prefix text,
  add column if not exists pending_source_manifest_path text;

update public.website_change_runs
set storage_prefix = 'runs/' || id::text
where preview_mode = 'n3xra_live' and storage_prefix is null;

alter table public.website_change_runs
  drop constraint if exists website_change_runs_state_check,
  add constraint website_change_runs_state_check
    check (state in ('queued','coding','preview_ready','client_ready','changes_requested','merge_queued','merged','failed','abandoned')),
  drop constraint if exists website_change_runs_revision_count_check,
  add constraint website_change_runs_revision_count_check
    check (revision_count >= 0 and revision_count <= 50),
  drop constraint if exists website_change_runs_storage_prefix_check,
  add constraint website_change_runs_storage_prefix_check
    check (storage_prefix is null or storage_prefix ~ '^runs/[0-9a-f-]{36}(/revisions/[0-9]+)?$'),
  drop constraint if exists website_change_runs_pending_storage_prefix_check,
  add constraint website_change_runs_pending_storage_prefix_check
    check (pending_storage_prefix is null or pending_storage_prefix ~ '^runs/[0-9a-f-]{36}/revisions/[0-9]+$'),
  drop constraint if exists website_change_runs_pending_manifest_check,
  add constraint website_change_runs_pending_manifest_check
    check (pending_source_manifest_path is null or pending_source_manifest_path ~ '^runs/[0-9a-f-]{36}/revisions/[0-9]+/source/manifest[.]json$');

alter table public.website_change_runs
  drop constraint if exists website_change_runs_source_manifest_path_check,
  add constraint website_change_runs_source_manifest_path_check
    check (source_manifest_path is null or source_manifest_path ~ '^runs/[0-9a-f-]{36}(/revisions/[0-9]+)?/source/manifest[.]json$');

alter table public.website_change_runs
  drop constraint if exists website_change_runs_progress_stage_check,
  add constraint website_change_runs_progress_stage_check
    check (progress_stage in (
      'queued','codex_running','validating','deploying','preview_ready','failed',
      'merged','production_deploying','published','production_failed','abandoned'
    ));

create table if not exists public.website_change_revisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.website_change_runs(id) on delete cascade,
  request_id uuid not null references public.platform_support_requests(id) on delete cascade,
  website_id uuid not null references public.client_websites(id) on delete cascade,
  sequence_number integer not null,
  instruction text not null,
  status text not null default 'active',
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  unique (run_id, sequence_number),
  constraint website_change_revisions_sequence_check check (sequence_number between 1 and 50),
  constraint website_change_revisions_instruction_check check (char_length(instruction) between 3 and 4000),
  constraint website_change_revisions_status_check check (status in ('active', 'undone', 'failed'))
);

create index if not exists website_change_revisions_run_sequence_idx
  on public.website_change_revisions (run_id, sequence_number);

alter table public.website_change_revisions enable row level security;
revoke all on public.website_change_revisions from public, anon, authenticated;
grant select (id,run_id,request_id,website_id,sequence_number,instruction,status,created_at,undone_at)
  on public.website_change_revisions to authenticated;
grant all on public.website_change_revisions to service_role;

drop policy if exists website_change_revisions_client_select on public.website_change_revisions;
create policy website_change_revisions_client_select
on public.website_change_revisions
for select
to authenticated
using (
  exists (
    select 1
    from public.platform_support_requests request
    where request.id = request_id
      and request.client_visible = true
      and (
        request.requester_user_id = (select auth.uid())
        or public.can_view_client_website(request.website_id)
      )
  )
);

grant select (
  id,request_id,website_id,attempt_number,state,branch_name,target_repository,
  progress_stage,progress_message,progress_updated_at,preview_url,preview_mode,
  preview_expires_at,production_deployment_url,production_ready_at,error_message,
  created_at,updated_at,preview_ready_at,merged_at,revision_count,
  approval_submitted_at,vercel_fallback_requested_at
) on public.website_change_runs to authenticated;

comment on table public.website_change_revisions is
'Client-requested refinements made within one reusable Fast Preview session. Undone revisions remain for audit history.';

comment on column public.website_change_runs.approval_submitted_at is
'Set when the client finishes refining a Fast Preview and submits the stable preview link to N3XRA for final approval.';
;
