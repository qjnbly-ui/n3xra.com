alter table public.website_provisioning_runs
  drop constraint website_provisioning_runs_stage_check,
  drop constraint website_provisioning_runs_status_check,
  drop constraint website_provisioning_runs_completion_check;

alter table public.website_provisioning_runs
  add column vercel_project_id text,
  add column vercel_project_name text,
  add column vercel_project_url text,
  add column preview_deployment_id text,
  add column preview_url text,
  add column preview_state text,
  add column vercel_attempt_count integer not null default 0,
  add column vercel_last_attempt_at timestamptz,
  add column vercel_lease_token uuid,
  add column vercel_lease_expires_at timestamptz,
  add column vercel_completed_at timestamptz,
  add column vercel_last_error text,
  add constraint website_provisioning_runs_stage_check
    check (stage in ('github_repository', 'vercel_preview')),
  add constraint website_provisioning_runs_status_check
    check (status in (
      'pending', 'github_creating', 'github_ready', 'failed',
      'vercel_creating', 'vercel_ready', 'vercel_failed'
    )),
  add constraint website_provisioning_runs_vercel_project_name_check
    check (vercel_project_name is null or vercel_project_name ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  add constraint website_provisioning_runs_vercel_project_url_check
    check (vercel_project_url is null or vercel_project_url ~ '^https://vercel[.]com/[^[:space:]]+$'),
  add constraint website_provisioning_runs_preview_url_check
    check (preview_url is null or preview_url ~ '^https://[^/[:space:]]+[.]vercel[.]app/?$'),
  add constraint website_provisioning_runs_vercel_attempt_count_check
    check (vercel_attempt_count >= 0),
  add constraint website_provisioning_runs_completion_check check (
    (
      status in ('github_ready', 'vercel_creating', 'vercel_ready', 'vercel_failed')
      and completed_at is not null
      and repository_full_name is not null
      and repository_url is not null
      and repository_default_branch is not null
    )
    or (
      status in ('pending', 'github_creating', 'failed')
      and completed_at is null
    )
  ),
  add constraint website_provisioning_runs_vercel_completion_check check (
    (
      status = 'vercel_ready'
      and vercel_completed_at is not null
      and vercel_project_id is not null
      and vercel_project_name is not null
      and vercel_project_url is not null
      and preview_deployment_id is not null
      and preview_url is not null
    )
    or (
      status <> 'vercel_ready'
      and vercel_completed_at is null
    )
  );

create unique index website_provisioning_runs_vercel_project_id_unique
on public.website_provisioning_runs (vercel_project_id)
where vercel_project_id is not null;

create or replace function public.claim_website_vercel_provisioning(
  input_project_id uuid,
  input_actor_user_id uuid,
  input_target_project_name text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  project_record public.website_projects%rowtype;
  run_record public.website_provisioning_runs%rowtype;
  new_lease_token uuid := pg_catalog.gen_random_uuid();
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'This operation is restricted to trusted service-role code.';
  end if;
  if input_project_id is null or input_actor_user_id is null then
    raise exception 'A project and provisioning administrator are required.';
  end if;
  if coalesce(input_target_project_name, '') !~ '^[a-z0-9][a-z0-9._-]{0,99}$' then
    raise exception 'The generated Vercel project name is invalid.';
  end if;

  select project.* into project_record
  from public.website_projects as project
  where project.id = input_project_id
  for update;

  if project_record.id is null then raise exception 'Website project not found.'; end if;
  if project_record.status in ('cancelled', 'archived', 'completed') then
    raise exception 'This project is not active for website provisioning.';
  end if;

  select run.* into run_record
  from public.website_provisioning_runs as run
  where run.project_id = project_record.id
  for update;

  if run_record.id is null
    or run_record.status not in ('github_ready', 'vercel_creating', 'vercel_ready', 'vercel_failed')
    or run_record.repository_full_name is null
  then
    raise exception 'Create the private GitHub repository before provisioning Vercel.';
  end if;
  if run_record.status = 'vercel_ready' then
    return to_jsonb(run_record) || jsonb_build_object('acquired', false);
  end if;
  if run_record.status = 'vercel_creating' and run_record.vercel_lease_expires_at > now() then
    return to_jsonb(run_record) || jsonb_build_object('acquired', false);
  end if;
  if run_record.vercel_project_name is not null
    and run_record.vercel_project_name <> input_target_project_name
  then
    raise exception 'This website already records a different Vercel project name.';
  end if;

  update public.website_provisioning_runs
  set stage = 'vercel_preview',
      status = 'vercel_creating',
      requested_by_user_id = input_actor_user_id,
      vercel_project_name = input_target_project_name,
      vercel_attempt_count = vercel_attempt_count + 1,
      vercel_last_attempt_at = now(),
      vercel_lease_token = new_lease_token,
      vercel_lease_expires_at = now() + interval '10 minutes',
      vercel_completed_at = null,
      vercel_last_error = null,
      client_message = 'N3XRA is connecting your private repository to a preview workspace.'
  where id = run_record.id
  returning * into run_record;

  return to_jsonb(run_record) || jsonb_build_object('acquired', true);
end;
$$;

revoke all on function public.claim_website_vercel_provisioning(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.claim_website_vercel_provisioning(uuid, uuid, text)
to service_role;

create or replace function public.finish_website_vercel_provisioning(
  input_run_id uuid,
  input_lease_token uuid,
  input_succeeded boolean,
  input_vercel_project_id text default null,
  input_vercel_project_name text default null,
  input_vercel_project_url text default null,
  input_preview_deployment_id text default null,
  input_preview_url text default null,
  input_preview_state text default null,
  input_error text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  run_record public.website_provisioning_runs%rowtype;
  service_record public.website_services%rowtype;
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'This operation is restricted to trusted service-role code.';
  end if;

  select run.* into run_record
  from public.website_provisioning_runs as run
  where run.id = input_run_id
    and run.vercel_lease_token = input_lease_token
    and run.status = 'vercel_creating'
  for update;

  if run_record.id is null then raise exception 'The Vercel provisioning attempt is no longer active.'; end if;

  if input_succeeded then
    if char_length(coalesce(input_vercel_project_id, '')) not between 3 and 200
      or coalesce(input_vercel_project_name, '') !~ '^[a-z0-9][a-z0-9._-]{0,99}$'
      or coalesce(input_vercel_project_url, '') !~ '^https://vercel[.]com/[^[:space:]]+$'
      or char_length(coalesce(input_preview_deployment_id, '')) not between 3 and 200
      or coalesce(input_preview_url, '') !~ '^https://[^/[:space:]]+[.]vercel[.]app/?$'
    then
      raise exception 'Vercel returned invalid project or preview details.';
    end if;

    select service.* into service_record
    from public.website_services as service
    where service.website_id = run_record.website_id
      and service.service_type = 'hosting'
      and service.provider = 'vercel'
      and service.account_identifier = input_vercel_project_id
    limit 1
    for update;

    if service_record.id is null then
      insert into public.website_services (
        website_id, service_type, name, provider, status, ownership,
        account_identifier, public_url, client_summary, admin_notes,
        metadata, created_by_user_id
      ) values (
        run_record.website_id, 'hosting', 'Vercel preview hosting', 'vercel', 'active', 'n3xra_managed',
        input_vercel_project_id, input_preview_url,
        'Private preview hosting managed by N3XRA. Production publishing remains separately approved.',
        'Created by the website provisioning workflow without attaching a production domain.',
        jsonb_build_object(
          'vercel_project_name', input_vercel_project_name,
          'vercel_project_url', input_vercel_project_url,
          'preview_deployment_id', input_preview_deployment_id,
          'preview_state', input_preview_state,
          'provisioning_run_id', run_record.id
        ),
        run_record.requested_by_user_id
      );
    else
      update public.website_services
      set status = 'active',
          public_url = input_preview_url,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'vercel_project_name', input_vercel_project_name,
            'vercel_project_url', input_vercel_project_url,
            'preview_deployment_id', input_preview_deployment_id,
            'preview_state', input_preview_state,
            'provisioning_run_id', run_record.id
          ),
          updated_at = now()
      where id = service_record.id;
    end if;

    update public.website_provisioning_runs
    set status = 'vercel_ready',
        vercel_project_id = input_vercel_project_id,
        vercel_project_name = input_vercel_project_name,
        vercel_project_url = input_vercel_project_url,
        preview_deployment_id = input_preview_deployment_id,
        preview_url = input_preview_url,
        preview_state = input_preview_state,
        vercel_lease_token = null,
        vercel_lease_expires_at = null,
        vercel_completed_at = now(),
        vercel_last_error = null,
        client_message = 'Your private website preview is ready for review.'
    where id = run_record.id
    returning * into run_record;
  else
    update public.website_provisioning_runs
    set status = 'vercel_failed',
        vercel_lease_token = null,
        vercel_lease_expires_at = null,
        vercel_completed_at = null,
        vercel_last_error = left(coalesce(input_error, 'Vercel preview setup failed.'), 1000),
        client_message = 'Preview setup needs N3XRA attention. Your repository and project information remain safe.'
    where id = run_record.id
    returning * into run_record;
  end if;

  return to_jsonb(run_record);
end;
$$;

revoke all on function public.finish_website_vercel_provisioning(
  uuid, uuid, boolean, text, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.finish_website_vercel_provisioning(
  uuid, uuid, boolean, text, text, text, text, text, text, text
) to service_role;

comment on function public.claim_website_vercel_provisioning(uuid, uuid, text) is
'Atomically requires a completed GitHub repository and acquires a retry-safe lease for one Vercel preview setup attempt.';

comment on function public.finish_website_vercel_provisioning(uuid, uuid, boolean, text, text, text, text, text, text, text) is
'Completes or safely fails the leased Vercel preview setup without assigning a production domain.';
