alter table public.website_projects
  add column completed_at timestamptz;

alter table public.website_projects
  drop constraint website_projects_status_check;

alter table public.website_projects
  add constraint website_projects_status_check
    check (
      status in (
        'pending',
        'active',
        'waiting_on_client',
        'on_hold',
        'ready_to_launch',
        'launched',
        'completed',
        'cancelled',
        'archived'
      )
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

  if new.status = 'completed' and old.status <> 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif old.status = 'completed' and new.status <> 'completed' then
    new.completed_at := null;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_project_identity() from public;

create or replace function public.complete_website_project(input_project_id uuid)
returns public.website_projects
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  completed_project public.website_projects%rowtype;
begin
  update public.website_project_milestones
  set
    status = 'complete',
    client_note = 'This stage is complete.'
  where project_id = input_project_id
    and status <> 'not_applicable';

  update public.website_projects
  set
    status = 'completed',
    current_stage = 'ongoing',
    progress_percent = 100,
    completed_at = now(),
    admin_next_step = 'This project is complete.'
  where id = input_project_id
  returning *
  into completed_project;

  if completed_project.id is null then
    raise exception 'Website project not found.';
  end if;

  return completed_project;
end;
$$;

revoke all on function public.complete_website_project(uuid) from public;
revoke all on function public.complete_website_project(uuid) from anon;
revoke all on function public.complete_website_project(uuid) from authenticated;
grant execute on function public.complete_website_project(uuid) to service_role;;
