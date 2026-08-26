-- Allow a platform administrator to start a website build before a client
-- account, proposal, or onboarding exists. Client-facing work can be attached
-- to the same project later without replacing the website or repository.
alter table public.website_projects
alter column client_user_id drop not null;

alter table public.website_provisioning_runs
alter column organization_id drop not null;

comment on column public.website_projects.client_user_id is
'Optional while a platform administrator is starting a direct website build. Required before client-facing proposal or onboarding delivery.';

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
  if project_record.status in ('cancelled', 'archived', 'completed') then
    raise exception 'This project is not active for website provisioning.';
  end if;
  if project_record.managed_website_id is null then
    raise exception 'Connect a managed website to this project before provisioning.';
  end if;

  if project_record.source = 'proposal' then
    if project_record.proposal_id is null or not exists (
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
  elsif project_record.source <> 'existing_website' then
    raise exception 'This website project cannot be provisioned.';
  end if;

  select website.* into website_record
  from public.client_websites as website
  where website.id = project_record.managed_website_id
  for update;

  if website_record.id is null then
    raise exception 'The managed website was not found.';
  end if;
  if website_record.organization_id is null and project_record.source = 'proposal' then
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
