create or replace function private.maps_delete_break_incident(
  input_organization_id uuid,
  input_incident_id uuid
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare deleted_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') <> 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps administrator access is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.map_incidents incident
    where incident.organization_id = input_organization_id
      and incident.id = input_incident_id
      and incident.status <> 'resolved'
  ) then
    raise exception 'Choose an active break incident.' using errcode = 'P0002';
  end if;

  perform pg_catalog.set_config('n3xra.maps_incident_action', 'delete', true);
  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'delete', true);
  delete from public.map_incident_updates incident_update
  where incident_update.organization_id = input_organization_id
    and incident_update.incident_id = input_incident_id;
  delete from public.map_incidents incident
  where incident.organization_id = input_organization_id
    and incident.id = input_incident_id
    and incident.status <> 'resolved'
  returning incident.id into deleted_id;
  return deleted_id;
end;
$$;

revoke all on function private.maps_delete_break_incident(uuid, uuid) from public, anon;
grant execute on function private.maps_delete_break_incident(uuid, uuid) to authenticated;
