create or replace function private.hide_completed_project_progress()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.managed_website_id is not null then
    insert into public.website_portal_features (website_id, feature_key, enabled)
    values (new.managed_website_id, 'progress', false)
    on conflict (website_id, feature_key)
    do update set enabled = false;
  end if;

  return new;
end;
$$;

revoke all on function private.hide_completed_project_progress() from public, anon, authenticated;

drop trigger if exists website_projects_hide_completed_progress on public.website_projects;
create trigger website_projects_hide_completed_progress
after update of status on public.website_projects
for each row
when (new.status = 'completed' and old.status is distinct from 'completed')
execute function private.hide_completed_project_progress();

insert into public.website_portal_features (website_id, feature_key, enabled)
select managed_website_id, 'progress', false
from public.website_projects
where status = 'completed'
  and managed_website_id is not null
on conflict (website_id, feature_key)
do update set enabled = false;
