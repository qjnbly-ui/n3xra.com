-- Website onboarding is intake for the agreement, so it may begin from a
-- qualified request before a proposal or project record exists.
alter table public.website_onboardings
  drop constraint if exists website_onboardings_project_identity_check;

alter table public.website_onboardings
  add constraint website_onboardings_project_identity_check
    check (request_id is not null or proposal_id is not null or project_id is not null);

create or replace function private.protect_website_onboarding_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.request_id is distinct from old.request_id
    or new.client_user_id is distinct from old.client_user_id
    or new.unlocked_by_user_id is distinct from old.unlocked_by_user_id
  then
    raise exception 'Website onboarding ownership is read-only after creation.';
  end if;

  if new.proposal_id is distinct from old.proposal_id then
    if old.proposal_id is not null or new.proposal_id is null or not exists (
      select 1
      from public.website_proposals proposal
      where proposal.id = new.proposal_id
        and proposal.request_id = new.request_id
        and proposal.client_user_id = new.client_user_id
    ) then
      raise exception 'An onboarding may only be attached once to a matching proposal.';
    end if;
  end if;

  if new.project_id is distinct from old.project_id then
    if old.project_id is not null or new.project_id is null or not exists (
      select 1
      from public.website_projects project
      where project.id = new.project_id
        and project.client_user_id = new.client_user_id
        and (new.request_id is null or project.request_id = new.request_id)
        and (new.proposal_id is null or project.proposal_id = new.proposal_id)
    ) then
      raise exception 'An onboarding may only be attached once to a matching project.';
    end if;
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'not_started' and new.status in ('in_progress', 'submitted', 'archived'))
      or (old.status = 'in_progress' and new.status in ('submitted', 'archived'))
      or (old.status = 'submitted' and new.status in ('needs_changes', 'approved', 'archived'))
      or (old.status = 'needs_changes' and new.status in ('in_progress', 'submitted', 'archived'))
      or (old.status = 'approved' and new.status = 'archived')
    )
  then
    raise exception 'Invalid website onboarding status transition: % to %.', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_onboarding_lifecycle() from public;

drop policy if exists "website_onboardings_admin_insert" on public.website_onboardings;
create policy "website_onboardings_admin_insert"
on public.website_onboardings
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  and unlocked_by_user_id = (select auth.uid())
  and (
    exists (
      select 1
      from public.website_projects project
      where project.id = project_id
        and project.client_user_id = client_user_id
    )
    or exists (
      select 1
      from public.website_proposals proposal
      where proposal.id = proposal_id
        and proposal.request_id = request_id
        and proposal.client_user_id = client_user_id
    )
    or exists (
      select 1
      from public.website_service_requests request
      where request.id = request_id
        and request.user_id = client_user_id
        and request.status in (
          'qualified',
          'proposal_drafting',
          'proposal_sent',
          'proposal_changes_requested',
          'proposal_approved'
        )
    )
  )
);

create or replace function private.attach_website_onboarding_to_proposal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.website_onboardings
  set proposal_id = new.id
  where proposal_id is null
    and request_id = new.request_id
    and client_user_id = new.client_user_id;
  return new;
end;
$$;

revoke all on function private.attach_website_onboarding_to_proposal() from public;

drop trigger if exists website_proposals_attach_onboarding on public.website_proposals;
create trigger website_proposals_attach_onboarding
after insert on public.website_proposals
for each row execute function private.attach_website_onboarding_to_proposal();

-- When an approved proposal creates its project, connect the already-complete
-- intake record without requiring the browser to race the approval trigger.
create or replace function private.attach_website_onboarding_to_project()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.website_onboardings
  set project_id = new.id
  where project_id is null
    and client_user_id = new.client_user_id
    and (
      proposal_id = new.proposal_id
      or (proposal_id is null and request_id = new.request_id)
    );
  return new;
end;
$$;

revoke all on function private.attach_website_onboarding_to_project() from public;

drop trigger if exists website_projects_attach_onboarding on public.website_projects;
create trigger website_projects_attach_onboarding
after insert on public.website_projects
for each row execute function private.attach_website_onboarding_to_project();
;
