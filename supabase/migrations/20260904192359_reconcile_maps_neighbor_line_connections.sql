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
  source_standard_key text;
  endpoint_record record;
  target_record record;
begin
  delete from public.map_network_connections connection
  where connection.organization_id = input_organization_id
    and connection.feature_id = input_feature_id;

  select feature.*
  into source_feature
  from public.map_features feature
  join public.map_layers layer
    on layer.organization_id = feature.organization_id
   and layer.id = feature.layer_id
  where feature.organization_id = input_organization_id
    and feature.id = input_feature_id
    and feature.geometry_type = 'line'
    and feature.archived_at is null
    and layer.archived_at is null;

  if not found then
    return;
  end if;

  select layer.system_type, layer.standard_key
  into source_system_type, source_standard_key
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
    select
      candidate.id,
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
      and extensions.st_dwithin(candidate.geometry::extensions.geography, endpoint_record.geometry::extensions.geography, 0.05)
    order by
      case
        when source_standard_key = 'water-service' and candidate_layer.standard_key = 'water-main' then 0
        when candidate_layer.standard_key = source_standard_key then 1
        else 2
      end,
      extensions.st_distance(candidate.geometry::extensions.geography, endpoint_record.geometry::extensions.geography),
      candidate.id
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

create or replace function private.refresh_map_network_connections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_feature_id uuid;
  affected_feature_ids uuid[];
  source_system_type text;
begin
  select layer.system_type into source_system_type
  from public.map_layers layer
  where layer.organization_id = new.organization_id
    and layer.id = new.layer_id;

  select coalesce(pg_catalog.array_agg(distinct affected.id), '{}'::uuid[])
  into affected_feature_ids
  from (
    select connection.feature_id as id
    from public.map_network_connections connection
    where connection.organization_id = new.organization_id
      and connection.connected_feature_id = new.id
    union
    select candidate.id
    from public.map_features candidate
    join public.map_layers candidate_layer
      on candidate_layer.organization_id = candidate.organization_id
     and candidate_layer.id = candidate.layer_id
    where candidate.organization_id = new.organization_id
      and candidate.id <> new.id
      and candidate.geometry_type = 'line'
      and candidate.archived_at is null
      and candidate_layer.archived_at is null
      and candidate_layer.system_type = source_system_type
      and (
        extensions.st_dwithin(extensions.st_startpoint(candidate.geometry)::extensions.geography, new.geometry::extensions.geography, 0.05)
        or extensions.st_dwithin(extensions.st_endpoint(candidate.geometry)::extensions.geography, new.geometry::extensions.geography, 0.05)
      )
  ) affected;

  delete from public.map_network_connections connection
  where connection.organization_id = new.organization_id
    and (connection.feature_id = new.id or connection.connected_feature_id = new.id);

  perform private.maps_rebuild_line_connections(new.organization_id, new.id);
  foreach affected_feature_id in array affected_feature_ids
  loop
    perform private.maps_rebuild_line_connections(new.organization_id, affected_feature_id);
  end loop;
  return new;
end;
$$;

do $$
declare
  feature_record record;
begin
  for feature_record in
    select feature.organization_id, feature.id
    from public.map_features feature
    where feature.geometry_type = 'line'
      and feature.archived_at is null
    order by feature.organization_id, feature.created_at, feature.id
  loop
    perform private.maps_rebuild_line_connections(feature_record.organization_id, feature_record.id);
  end loop;
end;
$$;

do $$
declare
  plan_record record;
  isolated_ids uuid[];
  meter_ids uuid[];
  customer_refs text[];
begin
  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'save', true);
  for plan_record in
    select plan.id, plan.organization_id, plan.isolated_feature_ids
    from public.map_incident_isolation_plans plan
    join public.map_incidents incident
      on incident.organization_id = plan.organization_id
     and incident.id = plan.incident_id
    where incident.status <> 'resolved'
  loop
    with recursive reached(feature_id) as (
      select seed.feature_id
      from pg_catalog.unnest(plan_record.isolated_feature_ids) seed(feature_id)
      union
      select case
        when connection.feature_id = reached.feature_id then connection.connected_feature_id
        else connection.feature_id
      end
      from reached
      join public.map_network_connections connection
        on connection.organization_id = plan_record.organization_id
       and (connection.feature_id = reached.feature_id or connection.connected_feature_id = reached.feature_id)
      where not exists (
        select 1
        from public.map_network_devices device
        where device.organization_id = plan_record.organization_id
          and (
            (device.line_a_feature_id = connection.feature_id and device.line_b_feature_id = connection.connected_feature_id)
            or (device.line_a_feature_id = connection.connected_feature_id and device.line_b_feature_id = connection.feature_id)
          )
      )
    )
    select coalesce(pg_catalog.array_agg(distinct reached.feature_id order by reached.feature_id), '{}'::uuid[])
    into isolated_ids
    from reached;

    select
      coalesce(pg_catalog.array_agg(distinct point.id order by point.id), '{}'::uuid[]),
      coalesce(pg_catalog.array_agg(distinct nullif(pg_catalog.btrim(point.customer_reference), '') order by nullif(pg_catalog.btrim(point.customer_reference), '')) filter (where nullif(pg_catalog.btrim(point.customer_reference), '') is not null), '{}'::text[])
    into meter_ids, customer_refs
    from public.map_point_line_connections connection
    join public.map_features point
      on point.organization_id = connection.organization_id
     and point.id = connection.point_feature_id
    join public.map_layers point_layer
      on point_layer.organization_id = point.organization_id
     and point_layer.id = point.layer_id
    where connection.organization_id = plan_record.organization_id
      and connection.line_feature_id = any(isolated_ids)
      and point.archived_at is null
      and (point_layer.standard_key = 'water-meter' or (point_layer.system_type = 'potable_water' and point_layer.icon_key = 'meter'));

    update public.map_incident_isolation_plans plan
    set isolated_feature_ids = isolated_ids,
        affected_meter_ids = meter_ids,
        customer_references = customer_refs,
        affected_meter_count = pg_catalog.cardinality(meter_ids),
        affected_customer_count = pg_catalog.cardinality(customer_refs)
    where plan.id = plan_record.id
      and plan.organization_id = plan_record.organization_id;
  end loop;
end;
$$;

revoke all on function private.maps_rebuild_line_connections(uuid, uuid) from public, anon, authenticated;
revoke all on function private.refresh_map_network_connections() from public, anon, authenticated;
