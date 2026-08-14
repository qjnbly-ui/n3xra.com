create table public.website_projects (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.website_service_requests (id) on delete cascade,
  proposal_id uuid not null unique references public.website_proposals (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  managed_website_id uuid unique references public.client_websites (id) on delete set null,
  name text not null,
  status text not null default 'pending',
  current_stage text not null default 'agreement',
  progress_percent integer not null default 0,
  target_start_date date,
  target_launch_date date,
  client_summary text,
  admin_next_step text,
  owner_admin_user_id uuid references auth.users (id) on delete set null,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_projects_name_check
    check (char_length(btrim(name)) between 1 and 180),
  constraint website_projects_status_check
    check (status in ('pending', 'active', 'waiting_on_client', 'on_hold', 'ready_to_launch', 'launched', 'cancelled', 'archived')),
  constraint website_projects_stage_check
    check (current_stage in ('agreement', 'billing', 'onboarding', 'production', 'client_review', 'launch', 'ongoing')),
  constraint website_projects_progress_check
    check (progress_percent between 0 and 100),
  constraint website_projects_dates_check
    check (
      target_start_date is null
      or target_launch_date is null
      or target_launch_date >= target_start_date
    )
);

create table public.website_project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.website_projects (id) on delete cascade,
  stage text not null,
  sequence_number integer not null,
  label text not null,
  status text not null default 'not_started',
  client_description text not null,
  client_note text,
  target_date date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_project_milestones_project_stage_unique unique (project_id, stage),
  constraint website_project_milestones_project_sequence_unique unique (project_id, sequence_number),
  constraint website_project_milestones_stage_check
    check (stage in ('agreement', 'billing', 'onboarding', 'production', 'client_review', 'launch', 'ongoing')),
  constraint website_project_milestones_sequence_check
    check (sequence_number between 1 and 7),
  constraint website_project_milestones_label_check
    check (char_length(btrim(label)) between 1 and 100),
  constraint website_project_milestones_status_check
    check (status in ('not_started', 'available', 'in_progress', 'blocked', 'complete', 'not_applicable')),
  constraint website_project_milestones_completion_check
    check (
      (status = 'complete' and completed_at is not null)
      or (status <> 'complete')
    )
);

create index website_projects_client_created_idx
on public.website_projects (client_user_id, created_at desc);

create index website_projects_status_updated_idx
on public.website_projects (status, updated_at desc);

create index website_projects_owner_admin_idx
on public.website_projects (owner_admin_user_id)
where owner_admin_user_id is not null;

create index website_projects_created_by_idx
on public.website_projects (created_by_user_id)
where created_by_user_id is not null;

create index website_project_milestones_status_idx
on public.website_project_milestones (status, updated_at desc);

drop trigger if exists website_projects_set_updated_at on public.website_projects;
create trigger website_projects_set_updated_at
before update on public.website_projects
for each row execute function public.set_updated_at();

drop trigger if exists website_project_milestones_set_updated_at on public.website_project_milestones;
create trigger website_project_milestones_set_updated_at
before update on public.website_project_milestones
for each row execute function public.set_updated_at();

create or replace function private.initialize_website_project_milestones()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.website_project_milestones (
    project_id,
    stage,
    sequence_number,
    label,
    status,
    client_description
  )
  values
    (new.id, 'agreement', 1, 'Agreement', 'available', 'Review and complete the project agreement.'),
    (new.id, 'billing', 2, 'Billing', 'not_started', 'Complete the deposit and project billing setup.'),
    (new.id, 'onboarding', 3, 'Onboarding', 'not_started', 'Provide the content, brand direction, access details, and files needed to begin.'),
    (new.id, 'production', 4, 'Website build', 'not_started', 'N3XRA designs and develops the approved website scope.'),
    (new.id, 'client_review', 5, 'Client review', 'not_started', 'Review the website and submit consolidated feedback.'),
    (new.id, 'launch', 6, 'Launch', 'not_started', 'Complete final approval, domain readiness, and launch checks.'),
    (new.id, 'ongoing', 7, 'Ongoing management', 'not_started', 'Move into website assets, renewals, billing, support, and continuing management.');
  return new;
end;
$$;

revoke all on function private.initialize_website_project_milestones() from public;

drop trigger if exists website_projects_initialize_milestones on public.website_projects;
create trigger website_projects_initialize_milestones
after insert on public.website_projects
for each row execute function private.initialize_website_project_milestones();

create or replace function private.recalculate_website_project_progress()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  completed_stage_count integer;
  next_stage text;
begin
  select count(*)
  into completed_stage_count
  from public.website_project_milestones
  where project_id = new.project_id
    and sequence_number <= 6
    and status in ('complete', 'not_applicable');

  select stage
  into next_stage
  from public.website_project_milestones
  where project_id = new.project_id
    and sequence_number <= 6
    and status not in ('complete', 'not_applicable')
  order by sequence_number
  limit 1;

  update public.website_projects
  set
    progress_percent = round((completed_stage_count::numeric / 6) * 100)::integer,
    current_stage = coalesce(next_stage, 'ongoing')
  where id = new.project_id;

  return new;
end;
$$;

revoke all on function private.recalculate_website_project_progress() from public;

drop trigger if exists website_project_milestones_recalculate_project on public.website_project_milestones;
create trigger website_project_milestones_recalculate_project
after update of status on public.website_project_milestones
for each row execute function private.recalculate_website_project_progress();

create or replace function private.ensure_website_project_for_approved_proposal()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  request_row public.website_service_requests%rowtype;
begin
  if new.status <> 'approved' then
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

drop trigger if exists website_proposals_ensure_project on public.website_proposals;
create trigger website_proposals_ensure_project
after insert or update of status on public.website_proposals
for each row
when (new.status = 'approved')
execute function private.ensure_website_project_for_approved_proposal();

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
  select id
  into project_row_id
  from public.website_projects
  where proposal_id = new.proposal_id;

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

drop trigger if exists website_onboardings_sync_project_milestone on public.website_onboardings;
create trigger website_onboardings_sync_project_milestone
after insert or update of status on public.website_onboardings
for each row execute function private.sync_website_project_onboarding_milestone();

create or replace function private.protect_website_project_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.request_id is distinct from old.request_id
    or new.proposal_id is distinct from old.proposal_id
    or new.client_user_id is distinct from old.client_user_id
    or new.created_by_user_id is distinct from old.created_by_user_id
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

drop trigger if exists website_projects_protect_identity on public.website_projects;
create trigger website_projects_protect_identity
before update on public.website_projects
for each row execute function private.protect_website_project_identity();

create or replace function private.protect_website_project_milestone_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.project_id is distinct from old.project_id
    or new.stage is distinct from old.stage
    or new.sequence_number is distinct from old.sequence_number
  then
    raise exception 'Website project milestone identity is read-only.';
  end if;

  if new.status = 'complete' and old.status <> 'complete' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'complete' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_project_milestone_identity() from public;

drop trigger if exists website_project_milestones_protect_identity on public.website_project_milestones;
create trigger website_project_milestones_protect_identity
before update on public.website_project_milestones
for each row execute function private.protect_website_project_milestone_identity();

alter table public.website_projects enable row level security;
alter table public.website_project_milestones enable row level security;

revoke all on public.website_projects from anon;
revoke all on public.website_project_milestones from anon;

grant select, update on public.website_projects to authenticated;
grant select, update on public.website_project_milestones to authenticated;

grant all on public.website_projects to service_role;
grant all on public.website_project_milestones to service_role;

create policy "website_projects_select"
on public.website_projects
for select
to authenticated
using (
  client_user_id = (select auth.uid())
  or (select public.is_platform_admin())
);

create policy "website_projects_admin_update"
on public.website_projects
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "website_project_milestones_select"
on public.website_project_milestones
for select
to authenticated
using (
  exists (
    select 1
    from public.website_projects project
    where project.id = project_id
      and (
        project.client_user_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  )
);

create policy "website_project_milestones_admin_update"
on public.website_project_milestones
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

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
select
  proposal.request_id,
  proposal.id,
  proposal.client_user_id,
  request.business_name,
  'pending',
  'agreement',
  0,
  request.target_launch_date,
  'Your proposal is approved. Project setup is ready to begin.',
  proposal.created_by_user_id
from public.website_proposals proposal
join public.website_service_requests request
  on request.id = proposal.request_id
where proposal.status = 'approved'
on conflict (proposal_id) do nothing;

update public.website_project_milestones milestone
set
  status = case onboarding.status
    when 'not_started' then 'available'
    when 'in_progress' then 'in_progress'
    when 'submitted' then 'in_progress'
    when 'needs_changes' then 'in_progress'
    when 'approved' then 'complete'
    else 'not_applicable'
  end,
  client_note = case
    when onboarding.status = 'submitted' then 'Submitted to N3XRA for review.'
    when onboarding.status = 'needs_changes' then coalesce(onboarding.admin_notes, 'Updates were requested.')
    when onboarding.status = 'approved' then 'Onboarding has been approved.'
    else milestone.client_note
  end,
  completed_at = case when onboarding.status = 'approved' then coalesce(onboarding.reviewed_at, now()) else null end
from public.website_projects project
join public.website_onboardings onboarding
  on onboarding.proposal_id = project.proposal_id
where milestone.project_id = project.id
  and milestone.stage = 'onboarding';
