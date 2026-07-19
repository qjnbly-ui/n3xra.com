alter table public.website_projects
  alter column request_id drop not null,
  alter column proposal_id drop not null,
  add column source text not null default 'proposal';

alter table public.website_projects
  add constraint website_projects_source_check
    check (source in ('proposal', 'existing_website')),
  add constraint website_projects_source_identity_check
    check (
      (
        source = 'proposal'
        and request_id is not null
        and proposal_id is not null
      )
      or (
        source = 'existing_website'
        and managed_website_id is not null
        and request_id is null
        and proposal_id is null
      )
    );

alter table public.website_proposals
  add column project_id uuid
    references public.website_projects (id) on delete set null;

create index website_proposals_project_created_idx
on public.website_proposals (project_id, created_at desc)
where project_id is not null;

create or replace function private.validate_website_proposal_project()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'UPDATE'
    and old.project_id is not null
    and new.project_id is distinct from old.project_id
  then
    raise exception 'A proposal project link is read-only after creation.';
  end if;

  if new.project_id is not null
    and not exists (
      select 1
      from public.website_projects project
      where project.id = new.project_id
        and project.client_user_id = new.client_user_id
    )
  then
    raise exception 'The proposal and project must belong to the same client account.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_website_proposal_project() from public;

drop trigger if exists website_proposals_validate_project on public.website_proposals;
create trigger website_proposals_validate_project
before insert or update of project_id, client_user_id on public.website_proposals
for each row execute function private.validate_website_proposal_project();

alter table public.website_onboardings
  add column project_id uuid unique
    references public.website_projects (id) on delete cascade,
  alter column request_id drop not null,
  alter column proposal_id drop not null;

update public.website_onboardings onboarding
set project_id = project.id
from public.website_projects project
where project.proposal_id = onboarding.proposal_id
  and onboarding.project_id is null;

alter table public.website_onboardings
  add constraint website_onboardings_project_identity_check
    check (
      project_id is not null
      or (request_id is not null and proposal_id is not null)
    );

create or replace function private.protect_website_project_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.client_user_id is distinct from old.client_user_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.source is distinct from old.source
    or new.request_id is distinct from old.request_id
    or new.proposal_id is distinct from old.proposal_id
  then
    raise exception 'Website project ownership is read-only after creation.';
  end if;

  if new.status = 'launched' and old.status <> 'launched' and new.launched_at is null then
    new.launched_at := now();
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_project_identity() from public;

create or replace function private.ensure_website_project_for_approved_proposal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.website_service_requests%rowtype;
begin
  if new.status <> 'approved' or new.project_id is not null then
    return new;
  end if;

  select *
  into request_row
  from public.website_service_requests
  where id = new.request_id;

  insert into public.website_projects (
    request_id,
    proposal_id,
    client_user_id,
    name,
    status,
    current_stage,
    progress_percent,
    target_launch_date,
    client_summary,
    created_by_user_id
  )
  values (
    new.request_id,
    new.id,
    new.client_user_id,
    request_row.business_name,
    'pending',
    'agreement',
    0,
    request_row.target_launch_date,
    'Your proposal is approved. Project setup is ready to begin.',
    (select auth.uid())
  )
  on conflict (proposal_id) do nothing;

  return new;
end;
$$;

revoke all on function private.ensure_website_project_for_approved_proposal() from public;

create or replace function private.protect_website_onboarding_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.project_id is distinct from old.project_id
    or new.request_id is distinct from old.request_id
    or new.proposal_id is distinct from old.proposal_id
    or new.client_user_id is distinct from old.client_user_id
    or new.unlocked_by_user_id is distinct from old.unlocked_by_user_id
  then
    raise exception 'Website onboarding project ownership is read-only after creation.';
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

create or replace function private.sync_website_project_onboarding_milestone()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  project_row_id uuid;
  milestone_status text;
begin
  project_row_id := new.project_id;

  if project_row_id is null then
    select id
    into project_row_id
    from public.website_projects
    where proposal_id = new.proposal_id;
  end if;

  if project_row_id is null then
    return new;
  end if;

  milestone_status := case new.status
    when 'not_started' then 'available'
    when 'in_progress' then 'in_progress'
    when 'submitted' then 'in_progress'
    when 'needs_changes' then 'in_progress'
    when 'approved' then 'complete'
    else 'not_applicable'
  end;

  update public.website_project_milestones
  set
    status = milestone_status,
    client_note = case
      when new.status = 'submitted' then 'Submitted to N3XRA for review.'
      when new.status = 'needs_changes' then coalesce(new.admin_notes, 'Updates were requested.')
      when new.status = 'approved' then 'Onboarding has been approved.'
      else client_note
    end,
    completed_at = case when new.status = 'approved' then coalesce(new.reviewed_at, now()) else null end
  where project_id = project_row_id
    and stage = 'onboarding';

  return new;
end;
$$;

revoke all on function private.sync_website_project_onboarding_milestone() from public;

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
        and proposal.status = 'approved'
    )
  )
);
