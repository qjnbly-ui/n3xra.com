create or replace function private.capture_career_application_admin_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.admin_notifications (
    event_type,
    product,
    priority,
    title,
    summary,
    actor_name,
    actor_email,
    source_table,
    source_id,
    action_url,
    metadata
  ) values (
    'platform.careers_applications.submitted',
    'platform',
    'important',
    'New career application',
    left(concat_ws(
      ' · ',
      nullif(new.full_name, ''),
      nullif(new.email, ''),
      nullif(coalesce(new.proposed_title, new.role_interest), '')
    ), 2000),
    nullif(new.full_name, ''),
    nullif(new.email, ''),
    'careers_applications',
    new.id::text,
    '/account/admin/applications/',
    jsonb_build_object('operation', 'INSERT')
  );

  return new;
end;
$$;

revoke all on function private.capture_career_application_admin_notification()
from public, anon, authenticated;

drop trigger if exists capture_career_application_admin_notification
on public.careers_applications;

create trigger capture_career_application_admin_notification
after insert on public.careers_applications
for each row execute function private.capture_career_application_admin_notification();

-- Restore notifications for applications submitted before this trigger existed.
insert into public.admin_notifications (
  event_type,
  product,
  priority,
  title,
  summary,
  actor_name,
  actor_email,
  source_table,
  source_id,
  action_url,
  metadata,
  created_at
)
select
  'platform.careers_applications.submitted',
  'platform',
  'important',
  'New career application',
  left(concat_ws(
    ' · ',
    nullif(application.full_name, ''),
    nullif(application.email, ''),
    nullif(coalesce(application.proposed_title, application.role_interest), '')
  ), 2000),
  nullif(application.full_name, ''),
  nullif(application.email, ''),
  'careers_applications',
  application.id::text,
  '/account/admin/applications/',
  jsonb_build_object('operation', 'INSERT', 'backfilled', true),
  application.created_at
from public.careers_applications as application
where not exists (
  select 1
  from public.admin_notifications as notification
  where notification.source_table = 'careers_applications'
    and notification.source_id = application.id::text
);
