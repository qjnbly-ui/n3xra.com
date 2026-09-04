create or replace function private.guard_map_incident_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
begin
  if tg_op = 'DELETE' then
    raise exception 'Incidents cannot be deleted.' using errcode = '55000';
  end if;

  if action_name not in ('start', 'update', 'close') then
    raise exception 'Use the protected incident actions.' using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' then
    if old.status = 'resolved' then
      raise exception 'Resolved incidents are permanent.' using errcode = '55000';
    end if;
    if new.organization_id is distinct from old.organization_id
       or new.incident_number is distinct from old.incident_number
       or new.incident_type is distinct from old.incident_type
       or new.feature_id is distinct from old.feature_id
       or not extensions.st_equals(new.reported_geometry, old.reported_geometry)
       or not extensions.st_equals(new.geometry, old.geometry)
       or new.snap_distance_m is distinct from old.snap_distance_m
       or new.created_by_user_id is distinct from old.created_by_user_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Incident identity and mapped location cannot be changed.' using errcode = '55000';
    end if;
    if new.status = 'resolved' and action_name <> 'close' then
      raise exception 'Use the protected close action to resolve an incident.' using errcode = '55000';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_map_incident_write() from public, anon, authenticated;
