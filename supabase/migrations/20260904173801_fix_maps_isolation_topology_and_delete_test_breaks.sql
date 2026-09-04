create or replace function private.maps_rebuild_line_connections(
  input_organization_id uuid,
  input_feature_id uuid
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  source_feature public.map_features%rowtype;
  source_system_type text;
  endpoint_record record;
  target_record record;
begin
  delete from public.map_network_connections connection
  where connection.organization_id = input_organization_id
    and connection.feature_id = input_feature_id;

  select feature.* into source_feature
  from public.map_features feature
  join public.map_layers layer
    on layer.organization_id = feature.organization_id and layer.id = feature.layer_id
  where feature.organization_id = input_organization_id
    and feature.id = input_feature_id
    and feature.geometry_type = 'line'
    and feature.archived_at is null
    and layer.archived_at is null;

  if not found then return; end if;

  select layer.system_type into source_system_type
  from public.map_layers layer
  where layer.organization_id = source_feature.organization_id
    and layer.id = source_feature.layer_id;

  if source_system_type not in ('potable_water', 'sanitary_sewer', 'stormwater', 'reclaimed_water') then
    return;
  end if;

  for endpoint_record in
    select endpoint.name, endpoint.geometry
    from (values
      ('start'::text, extensions.st_startpoint(source_feature.geometry)),
      ('end'::text, extensions.st_endpoint(source_feature.geometry))
    ) as endpoint(name, geometry)
  loop
    select candidate.id,
      extensions.st_closestpoint(candidate.geometry, endpoint_record.geometry) as geometry,
      extensions.st_linelocatepoint(candidate.geometry, endpoint_record.geometry) as fraction,
      extensions.st_distance(candidate.geometry::extensions.geography, endpoint_record.geometry::extensions.geography) as distance_m
    into target_record
    from public.map_features candidate
    join public.map_layers candidate_layer
      on candidate_layer.organization_id = candidate.organization_id
     and candidate_layer.id = candidate.layer_id
    where candidate.organization_id = input_organization_id
      and candidate.id <> input_feature_id
      and candidate.geometry_type = 'line'
      and candidate.archived_at is null
      and candidate_layer.system_type = source_system_type
      and candidate_layer.archived_at is null
      and extensions.st_dwithin(candidate.geometry::extensions.geography, endpoint_record.geometry::extensions.geography, 3)
    order by extensions.st_distance(candidate.geometry::extensions.geography, endpoint_record.geometry::extensions.geography), candidate.id
    limit 1;

    if target_record.id is not null then
      insert into public.map_network_connections (
        organization_id, feature_id, endpoint, connected_feature_id,
        geometry, connected_fraction, snap_distance_m, created_by_user_id
      ) values (
        input_organization_id, input_feature_id, endpoint_record.name, target_record.id,
        target_record.geometry, target_record.fraction, target_record.distance_m, (select auth.uid())
      );
    end if;
  end loop;
end;
$$;

do $$
declare feature_record record;
begin
  for feature_record in
    select feature.organization_id, feature.id
    from public.map_features feature
    where feature.geometry_type = 'line' and feature.archived_at is null
  loop
    perform private.maps_rebuild_line_connections(feature_record.organization_id, feature_record.id);
  end loop;
end;
$$;

create or replace function private.is_maps_isolation_valve(
  input_organization_id uuid,
  input_valve_feature_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.map_network_devices device
    where device.organization_id = input_organization_id
      and device.device_feature_id = input_valve_feature_id
  ) or exists (
    select 1
    from public.map_point_line_connections connection
    join public.map_features valve
      on valve.organization_id = connection.organization_id
     and valve.id = connection.point_feature_id
     and valve.archived_at is null
    join public.map_layers layer
      on layer.organization_id = valve.organization_id
     and layer.id = valve.layer_id
     and layer.archived_at is null
    where connection.organization_id = input_organization_id
      and connection.point_feature_id = input_valve_feature_id
      and (layer.standard_key = 'water-valve' or layer.icon_key = 'valve')
      and (connection.line_fraction <= 0.001 or connection.line_fraction >= 0.999)
  );
$$;

create or replace function private.maps_set_incident_valve_status(
  input_organization_id uuid,
  input_incident_id uuid,
  input_valve_feature_id uuid,
  input_status text,
  input_note text default null,
  input_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare action_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_status not in ('recommended', 'en_route', 'found', 'closed', 'inaccessible', 'inoperable', 'reopened') then
    raise exception 'Choose a valid valve status.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.map_incidents incident
    where incident.organization_id = input_organization_id
      and incident.id = input_incident_id
      and incident.status <> 'resolved'
  ) or not private.is_maps_isolation_valve(input_organization_id, input_valve_feature_id) then
    raise exception 'Choose an active incident and connected network valve.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'save', true);
  insert into public.map_incident_valve_actions (
    organization_id, incident_id, valve_feature_id, status, note, occurred_at
  ) values (
    input_organization_id, input_incident_id, input_valve_feature_id, input_status,
    nullif(pg_catalog.btrim(input_note), ''), coalesce(input_occurred_at, now())
  ) returning id into action_id;
  return action_id;
end;
$$;

create or replace function private.maps_save_incident_isolation_plan(
  input_organization_id uuid,
  input_incident_id uuid,
  input_recommended_valve_ids uuid[],
  input_isolated_feature_ids uuid[],
  input_affected_meter_ids uuid[],
  input_customer_references text[],
  input_topology_complete boolean,
  input_warnings text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  plan_id uuid;
  affected_customer_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.map_incidents incident
    where incident.organization_id = input_organization_id
      and incident.id = input_incident_id
      and incident.status <> 'resolved'
  ) then
    raise exception 'Choose an active incident.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(coalesce(input_recommended_valve_ids, '{}')) valve_id
    where not private.is_maps_isolation_valve(input_organization_id, valve_id)
  ) then
    raise exception 'The plan contains an invalid network valve.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(
      coalesce(input_isolated_feature_ids, '{}') || coalesce(input_affected_meter_ids, '{}')
    ) feature_id
    where not exists (
      select 1 from public.map_features feature
      where feature.organization_id = input_organization_id
        and feature.id = feature_id
        and feature.archived_at is null
    )
  ) then
    raise exception 'The plan contains an invalid mapped item.' using errcode = '22023';
  end if;

  select count(distinct reference_value)::integer into affected_customer_count
  from pg_catalog.unnest(coalesce(input_customer_references, '{}')) reference_value
  where nullif(pg_catalog.btrim(reference_value), '') is not null;

  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'save', true);
  insert into public.map_incident_isolation_plans (
    organization_id, incident_id, recommended_valve_ids, isolated_feature_ids,
    affected_meter_ids, customer_references, affected_meter_count,
    affected_customer_count, topology_complete, warnings
  ) values (
    input_organization_id, input_incident_id,
    coalesce(input_recommended_valve_ids, '{}'), coalesce(input_isolated_feature_ids, '{}'),
    coalesce(input_affected_meter_ids, '{}'), coalesce(input_customer_references, '{}'),
    pg_catalog.cardinality(coalesce(input_affected_meter_ids, '{}')), affected_customer_count,
    coalesce(input_topology_complete, false), coalesce(input_warnings, '{}')
  ) on conflict (organization_id, incident_id) do update set
    recommended_valve_ids = excluded.recommended_valve_ids,
    isolated_feature_ids = excluded.isolated_feature_ids,
    affected_meter_ids = excluded.affected_meter_ids,
    customer_references = excluded.customer_references,
    affected_meter_count = excluded.affected_meter_count,
    affected_customer_count = excluded.affected_customer_count,
    topology_complete = excluded.topology_complete,
    warnings = excluded.warnings
  returning id into plan_id;
  return plan_id;
end;
$$;

create or replace function private.guard_map_incident_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
begin
  if tg_op = 'DELETE' then
    if action_name <> 'delete' then
      raise exception 'Use the protected delete action.' using errcode = '42501';
    end if;
    if old.status = 'resolved' then
      raise exception 'Resolved incidents are permanent.' using errcode = '55000';
    end if;
    return old;
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
       or new.reported_geometry is distinct from old.reported_geometry
       or new.geometry is distinct from old.geometry
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

create or replace function private.prepare_map_incident_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  incident_status text;
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
begin
  if tg_op = 'DELETE' then
    if action_name = 'delete' then return old; end if;
    raise exception 'Incident updates are permanent and cannot be edited or deleted.' using errcode = '55000';
  end if;
  if tg_op <> 'INSERT' then
    raise exception 'Incident updates are permanent and cannot be edited.' using errcode = '55000';
  end if;
  if action_name not in ('start', 'update', 'close') then
    raise exception 'Use the protected incident actions.' using errcode = '42501';
  end if;
  select incident.status into incident_status
  from public.map_incidents incident
  where incident.organization_id = new.organization_id and incident.id = new.incident_id;
  if incident_status is null then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if incident_status = 'resolved' then
    raise exception 'Resolved incidents cannot receive new updates.' using errcode = '55000';
  end if;
  new.created_by_user_id := (select auth.uid());
  new.submitted_at := now();
  return new;
end;
$$;

create or replace function private.guard_map_incident_isolation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_isolation_action', true), '');
  incident_status text;
begin
  if tg_op = 'DELETE' then
    if action_name = 'delete' then return old; end if;
    raise exception 'Isolation records are part of the incident history.' using errcode = '55000';
  end if;
  if action_name <> 'save' then
    raise exception 'Use the protected isolation actions.' using errcode = '42501';
  end if;
  select incident.status into incident_status
  from public.map_incidents incident
  where incident.organization_id = new.organization_id and incident.id = new.incident_id;
  if incident_status is null then raise exception 'Incident not found.' using errcode = 'P0002'; end if;
  if incident_status = 'resolved' then
    raise exception 'Resolved incident isolation records are permanent.' using errcode = '55000';
  end if;
  if tg_table_name = 'map_incident_valve_actions' then
    if tg_op <> 'INSERT' then raise exception 'Valve actions are permanent and cannot be edited.' using errcode = '55000'; end if;
    new.created_by_user_id := (select auth.uid());
    new.submitted_at := now();
  else
    new.calculated_by_user_id := (select auth.uid());
    new.calculated_at := now();
  end if;
  return new;
end;
$$;

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
  if deleted_id is null then
    raise exception 'Choose an active break incident.' using errcode = 'P0002';
  end if;
  return deleted_id;
end;
$$;

create or replace function public.maps_delete_break_incident(
  input_organization_id uuid,
  input_incident_id uuid
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maps_delete_break_incident(input_organization_id, input_incident_id);
$$;

revoke all on function private.maps_rebuild_line_connections(uuid, uuid) from public, anon, authenticated;
revoke all on function private.is_maps_isolation_valve(uuid, uuid) from public, anon, authenticated;
revoke all on function private.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function private.maps_save_incident_isolation_plan(uuid, uuid, uuid[], uuid[], uuid[], text[], boolean, text[]) from public, anon;
revoke all on function private.maps_delete_break_incident(uuid, uuid) from public, anon;
revoke all on function public.maps_delete_break_incident(uuid, uuid) from public, anon;
grant execute on function private.maps_delete_break_incident(uuid, uuid) to authenticated;
grant execute on function public.maps_delete_break_incident(uuid, uuid) to authenticated;
