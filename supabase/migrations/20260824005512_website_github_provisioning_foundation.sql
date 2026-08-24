create table public.website_provisioning_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects (id) on delete cascade,
  website_id uuid not null references public.client_websites (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  requested_by_user_id uuid not null references auth.users (id) on delete restrict,
  provider text not null default 'github',
  stage text not null default 'github_repository',
  status text not null default 'pending',
  target_repository_name text not null,
  repository_provider_id bigint,
  repository_full_name text,
  repository_url text,
  repository_default_branch text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  client_message text not null default 'Your private website workspace is waiting to be prepared.',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_provisioning_runs_project_unique unique (project_id),
  constraint website_provisioning_runs_website_unique unique (website_id),
  constraint website_provisioning_runs_provider_check check (provider = 'github'),
  constraint website_provisioning_runs_stage_check check (stage = 'github_repository'),
  constraint website_provisioning_runs_status_check
    check (status in ('pending', 'github_creating', 'github_ready', 'failed')),
  constraint website_provisioning_runs_target_repository_name_check
    check (target_repository_name ~ '^[A-Za-z0-9._-]{1,100}$'),
  constraint website_provisioning_runs_repository_full_name_check
    check (repository_full_name is null or repository_full_name ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  constraint website_provisioning_runs_repository_url_check
    check (repository_url is null or repository_url ~ '^https://github[.]com/[^/[:space:]]+/[^/[:space:]]+$'),
  constraint website_provisioning_runs_repository_default_branch_check
    check (repository_default_branch is null or char_length(repository_default_branch) between 1 and 255),
  constraint website_provisioning_runs_attempt_count_check check (attempt_count >= 0),
  constraint website_provisioning_runs_completion_check check (
    (status = 'github_ready' and completed_at is not null and repository_full_name is not null and repository_url is not null and repository_default_branch is not null)
    or (status <> 'github_ready' and completed_at is null)
  )
);

create index website_provisioning_runs_status_updated_idx
on public.website_provisioning_runs (status, updated_at desc);

create index website_provisioning_runs_requested_by_idx
on public.website_provisioning_runs (requested_by_user_id, created_at desc);

drop trigger if exists website_provisioning_runs_set_updated_at on public.website_provisioning_runs;
create trigger website_provisioning_runs_set_updated_at
before update on public.website_provisioning_runs
for each row execute function public.set_updated_at();

alter table public.website_provisioning_runs enable row level security;

revoke all on public.website_provisioning_runs from public, anon, authenticated;
grant select on public.website_provisioning_runs to authenticated;
grant all on public.website_provisioning_runs to service_role;

create policy "website_provisioning_runs_select"
on public.website_provisioning_runs
for select
to authenticated
using ((select public.can_view_client_website(website_id)));

comment on table public.website_provisioning_runs is
'One durable, retry-safe GitHub repository provisioning state per managed website. Browser roles may read authorized status only; service-role code performs every mutation.';

create or replace function public.claim_website_github_provisioning(
  input_project_id uuid,
  input_actor_user_id uuid,
  input_target_repository_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  project_record public.website_projects%rowtype;
  website_record public.client_websites%rowtype;
  run_record public.website_provisioning_runs%rowtype;
  new_lease_token uuid := pg_catalog.gen_random_uuid();
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  if input_project_id is null or input_actor_user_id is null then
    raise exception 'A project and provisioning administrator are required.';
  end if;
  if coalesce(input_target_repository_name, '') !~ '^[A-Za-z0-9._-]{1,100}$' then
    raise exception 'The generated GitHub repository name is invalid.';
  end if;

  select project.* into project_record
  from public.website_projects as project
  where project.id = input_project_id
  for update;

  if project_record.id is null then
    raise exception 'Website project not found.';
  end if;
  if project_record.source <> 'proposal' or project_record.proposal_id is null then
    raise exception 'GitHub provisioning is only available for approved new-website projects.';
  end if;
  if project_record.status in ('cancelled', 'archived', 'completed') then
    raise exception 'This project is not active for website provisioning.';
  end if;
  if project_record.managed_website_id is null then
    raise exception 'Connect a managed website to this project before provisioning.';
  end if;
  if not exists (
    select 1
    from public.website_proposals as proposal
    where proposal.id = project_record.proposal_id
      and proposal.status = 'approved'
  ) then
    raise exception 'The Proposal & Agreement must be approved before provisioning.';
  end if;
  if not exists (
    select 1
    from public.website_onboardings as onboarding
    where onboarding.status = 'approved'
      and (
        onboarding.project_id = project_record.id
        or onboarding.proposal_id = project_record.proposal_id
      )
  ) then
    raise exception 'Website onboarding must be approved before provisioning.';
  end if;

  select website.* into website_record
  from public.client_websites as website
  where website.id = project_record.managed_website_id
  for update;

  if website_record.id is null then
    raise exception 'The managed website was not found.';
  end if;
  if website_record.organization_id is null then
    raise exception 'Connect the website to its client organization before provisioning.';
  end if;

  select run.* into run_record
  from public.website_provisioning_runs as run
  where run.project_id = project_record.id
  for update;

  if run_record.id is not null and run_record.status = 'github_ready' then
    return to_jsonb(run_record) || jsonb_build_object('acquired', false);
  end if;
  if run_record.id is not null
    and run_record.status = 'github_creating'
    and run_record.lease_expires_at > now()
  then
    return to_jsonb(run_record) || jsonb_build_object('acquired', false);
  end if;

  if run_record.id is null then
    insert into public.website_provisioning_runs (
      project_id,
      website_id,
      organization_id,
      requested_by_user_id,
      status,
      target_repository_name,
      attempt_count,
      last_attempt_at,
      lease_token,
      lease_expires_at,
      client_message
    ) values (
      project_record.id,
      website_record.id,
      website_record.organization_id,
      input_actor_user_id,
      'github_creating',
      input_target_repository_name,
      1,
      now(),
      new_lease_token,
      now() + interval '5 minutes',
      'N3XRA is creating your private website repository.'
    )
    returning * into run_record;
  else
    update public.website_provisioning_runs
    set status = 'github_creating',
        requested_by_user_id = input_actor_user_id,
        attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        lease_token = new_lease_token,
        lease_expires_at = now() + interval '5 minutes',
        completed_at = null,
        client_message = 'N3XRA is creating your private website repository.'
    where id = run_record.id
    returning * into run_record;
  end if;

  return to_jsonb(run_record) || jsonb_build_object('acquired', true);
end;
$$;

revoke all on function public.claim_website_github_provisioning(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_website_github_provisioning(uuid, uuid, text)
to service_role;

create or replace function public.finish_website_github_provisioning(
  input_run_id uuid,
  input_lease_token uuid,
  input_succeeded boolean,
  input_repository_provider_id bigint default null,
  input_repository_full_name text default null,
  input_repository_url text default null,
  input_repository_default_branch text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  run_record public.website_provisioning_runs%rowtype;
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  select run.* into run_record
  from public.website_provisioning_runs as run
  where run.id = input_run_id
    and run.lease_token = input_lease_token
  for update;

  if run_record.id is null then
    raise exception 'The provisioning attempt is no longer active.';
  end if;

  if input_succeeded then
    if coalesce(input_repository_full_name, '') !~ '^[^/[:space:]]+/[^/[:space:]]+$'
      or coalesce(input_repository_url, '') !~ '^https://github[.]com/[^/[:space:]]+/[^/[:space:]]+$'
      or char_length(coalesce(input_repository_default_branch, '')) not between 1 and 255
    then
      raise exception 'GitHub returned invalid repository details.';
    end if;

    insert into public.website_repositories (
      website_id,
      provider,
      full_name,
      html_url,
      default_branch,
      visibility,
      ownership,
      access_status,
      last_synced_at,
      client_summary,
      admin_notes,
      metadata,
      created_by_user_id
    ) values (
      run_record.website_id,
      'github',
      input_repository_full_name,
      input_repository_url,
      input_repository_default_branch,
      'private',
      'n3xra_managed',
      'available_on_request',
      now(),
      'Private source repository managed by N3XRA for this website.',
      'Created from the standard N3XRA website template.',
      jsonb_build_object(
        'github_repository_id', input_repository_provider_id,
        'provisioning_run_id', run_record.id
      ),
      run_record.requested_by_user_id
    )
    on conflict (website_id, provider, full_name) do update
    set html_url = excluded.html_url,
        default_branch = excluded.default_branch,
        visibility = 'private',
        ownership = 'n3xra_managed',
        last_synced_at = now(),
        metadata = coalesce(public.website_repositories.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();

    update public.client_websites
    set repository_full_name = input_repository_full_name,
        updated_at = now()
    where id = run_record.website_id;

    update public.website_provisioning_runs
    set status = 'github_ready',
        repository_provider_id = input_repository_provider_id,
        repository_full_name = input_repository_full_name,
        repository_url = input_repository_url,
        repository_default_branch = input_repository_default_branch,
        lease_token = null,
        lease_expires_at = null,
        completed_at = now(),
        client_message = 'Your private website repository is ready for the build.'
    where id = run_record.id
    returning * into run_record;
  else
    update public.website_provisioning_runs
    set status = 'failed',
        lease_token = null,
        lease_expires_at = null,
        completed_at = null,
        client_message = 'Repository setup needs N3XRA attention. Your project and submitted information remain safe.'
    where id = run_record.id
    returning * into run_record;
  end if;

  return to_jsonb(run_record);
end;
$$;

revoke all on function public.finish_website_github_provisioning(uuid, uuid, boolean, bigint, text, text, text)
from public, anon, authenticated;
grant execute on function public.finish_website_github_provisioning(uuid, uuid, boolean, bigint, text, text, text)
to service_role;

comment on function public.claim_website_github_provisioning(uuid, uuid, text) is
'Atomically validates the approved project lifecycle and acquires a short service-role-only lease for one GitHub provisioning attempt.';

comment on function public.finish_website_github_provisioning(uuid, uuid, boolean, bigint, text, text, text) is
'Atomically completes or safely fails the leased GitHub provisioning attempt and records successful repository ownership metadata.';
