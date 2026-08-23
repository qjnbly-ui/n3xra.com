create or replace function private.normalize_website_request_project_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'proposal_approved'
    and exists (
      select 1
      from public.website_projects project
      where project.request_id = new.id
    )
  then
    new.status := 'converted';
  end if;

  return new;
end;
$$;

revoke all on function private.normalize_website_request_project_status() from public, anon, authenticated;

drop trigger if exists website_service_requests_normalize_project_status on public.website_service_requests;
create trigger website_service_requests_normalize_project_status
before update of status on public.website_service_requests
for each row
execute function private.normalize_website_request_project_status();

create or replace function private.convert_website_request_for_project()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.website_service_requests
  set status = 'converted'
  where id = new.request_id
    and status not in ('declined', 'proposal_declined', 'archived');

  return new;
end;
$$;

revoke all on function private.convert_website_request_for_project() from public, anon, authenticated;

drop trigger if exists website_projects_convert_service_request on public.website_projects;
create trigger website_projects_convert_service_request
after insert on public.website_projects
for each row
execute function private.convert_website_request_for_project();

update public.website_service_requests request
set status = 'converted'
where request.status not in ('declined', 'proposal_declined', 'archived')
  and exists (
    select 1
    from public.website_projects project
    where project.request_id = request.id
  );
