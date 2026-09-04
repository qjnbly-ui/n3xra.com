create table public.map_network_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_id uuid not null,
  endpoint text not null,
  connected_feature_id uuid not null,
  geometry extensions.geometry(Point, 4326) not null,
  connected_fraction double precision not null,
  snap_distance_m numeric(10,3) not null default 0,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint map_network_connections_feature_fkey
    foreign key (organization_id, feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_network_connections_connected_feature_fkey
    foreign key (organization_id, connected_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_network_connections_endpoint_check check (endpoint in ('start', 'end')),
  constraint map_network_connections_not_self_check check (feature_id <> connected_feature_id),
  constraint map_network_connections_fraction_check check (connected_fraction between 0 and 1),
  constraint map_network_connections_distance_check check (snap_distance_m between 0 and 3.1),
  constraint map_network_connections_feature_endpoint_unique unique (organization_id, feature_id, endpoint)
);

create index map_network_connections_connected_feature_idx
  on public.map_network_connections (organization_id, connected_feature_id);
create index map_network_connections_geometry_gist_idx
  on public.map_network_connections using gist (geometry);

alter table public.map_network_connections enable row level security;
revoke all on public.map_network_connections from public, anon, authenticated;
grant select on public.map_network_connections to authenticated;
grant all on public.map_network_connections to service_role;

create policy "map_network_connections_select"
on public.map_network_connections for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create or replace function private.maps_snap_line_geometry(
  input_organization_id uuid,
  input_layer_id uuid,
  input_feature_id uuid,
  input_geometry extensions.geometry,
  input_tolerance_m double precision default 3
)
returns extensions.geometry
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  line_system_type text;
  snapped_geometry extensions.geometry := input_geometry;
  endpoint_index integer;
  endpoint_geometry extensions.geometry;
  snapped_endpoint extensions.geometry;
begin
  select layer.system_type
  into line_system_type
  from public.map_layers layer
  where layer.organization_id = input_organization_id
    and layer.id = input_layer_id
    and layer.geometry_type = 'line'
    and layer.archived_at is null;

  if line_system_type not in ('potable_water', 'sanitary_sewer', 'stormwater', 'reclaimed_water') then
    return snapped_geometry;
  end if;

  foreach endpoint_index in array array[0, extensions.st_npoints(snapped_geometry) - 1]
  loop
    endpoint_geometry := extensions.st_pointn(snapped_geometry, endpoint_index + 1);
    select extensions.st_closestpoint(candidate.geometry, endpoint_geometry)
    into snapped_endpoint
    from public.map_features candidate
    join public.map_layers candidate_layer
      on candidate_layer.organization_id = candidate.organization_id
     and candidate_layer.id = candidate.layer_id
    where candidate.organization_id = input_organization_id
      and candidate.id is distinct from input_feature_id
      and candidate.geometry_type = 'line'
      and candidate.archived_at is null
      and candidate_layer.system_type = line_system_type
      and candidate_layer.archived_at is null
      and extensions.st_dwithin(candidate.geometry::extensions.geography, endpoint_geometry::extensions.geography, input_tolerance_m)
    order by extensions.st_distance(candidate.geometry::extensions.geography, endpoint_geometry::extensions.geography), candidate.id
    limit 1;

    if snapped_endpoint is not null then
      snapped_geometry := extensions.st_setpoint(snapped_geometry, endpoint_index, snapped_endpoint);
    end if;
    snapped_endpoint := null;
  end loop;

  return snapped_geometry;
end;
$$;

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

  select layer.system_type
  into source_system_type
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
    order by extensions.st_distance(candidate.geometry::extensions.geography, endpoint_record.geometry::extensions.geography), candidate.id
    limit 1;

    if target_record.id is not null then
      insert into public.map_network_connections (
        organization_id, feature_id, endpoint, connected_feature_id,
        geometry, connected_fraction, snap_distance_m, created_by_user_id
      ) values (
        input_organization_id, input_feature_id, endpoint_record.name, target_record.id,
        target_record.geometry, target_record.fraction, target_record.distance_m, auth.uid()
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
begin
  select coalesce(array_agg(distinct connection.feature_id), '{}'::uuid[])
  into affected_feature_ids
  from public.map_network_connections connection
  where connection.organization_id = new.organization_id
    and connection.connected_feature_id = new.id;

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

drop trigger if exists map_features_refresh_network_connections on public.map_features;
create trigger map_features_refresh_network_connections
after insert or update of geometry, layer_id, archived_at on public.map_features
for each row
when (new.geometry_type = 'line')
execute function private.refresh_map_network_connections();

create or replace function public.create_map_shape(
  input_organization_id uuid,
  input_layer_id uuid,
  input_title text,
  input_reference_code text default null,
  input_description text default null,
  input_geometry jsonb default null
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  created_id uuid;
  layer_geometry_type text;
  expected_postgis_type text;
  parsed_geometry extensions.geometry;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if nullif(trim(input_title), '') is null then
    raise exception 'A title is required.' using errcode = '22023';
  end if;

  select layer.geometry_type
  into layer_geometry_type
  from public.map_layers layer
  where layer.id = input_layer_id
    and layer.organization_id = input_organization_id
    and layer.geometry_type in ('line', 'polygon')
    and layer.is_editable
    and layer.archived_at is null;

  if layer_geometry_type is null then
    raise exception 'Select an editable line or polygon layer.' using errcode = '22023';
  end if;
  if input_geometry is null or input_geometry->>'type' not in ('LineString', 'Polygon') then
    raise exception 'A valid line or polygon is required.' using errcode = '22023';
  end if;

  expected_postgis_type := case layer_geometry_type when 'line' then 'ST_LineString' else 'ST_Polygon' end;
  if input_geometry->>'type' <> (case layer_geometry_type when 'line' then 'LineString' else 'Polygon' end) then
    raise exception 'The drawn geometry must match the selected layer.' using errcode = '22023';
  end if;

  begin
    parsed_geometry := extensions.st_setsrid(extensions.st_geomfromgeojson(input_geometry::text), 4326);
  exception when others then
    raise exception 'The drawn geometry is not valid GeoJSON.' using errcode = '22023';
  end;

  if parsed_geometry is null
     or extensions.st_isempty(parsed_geometry)
     or extensions.st_geometrytype(parsed_geometry) <> expected_postgis_type
     or not extensions.st_isvalid(parsed_geometry) then
    raise exception 'The drawn geometry is invalid.' using errcode = '22023';
  end if;
  if extensions.st_npoints(parsed_geometry) > 5001 then
    raise exception 'A drawn shape cannot contain more than 5,000 points.' using errcode = '22023';
  end if;
  if (layer_geometry_type = 'line' and extensions.st_npoints(parsed_geometry) < 2)
     or (layer_geometry_type = 'polygon' and extensions.st_npoints(parsed_geometry) < 4) then
    raise exception 'Add more points before saving the shape.' using errcode = '22023';
  end if;

  if layer_geometry_type = 'line' then
    parsed_geometry := private.maps_snap_line_geometry(input_organization_id, input_layer_id, null, parsed_geometry, 3);
  end if;

  insert into public.map_features (
    organization_id, layer_id, title, reference_code, description,
    geometry_type, geometry, placement_method,
    created_by_user_id, updated_by_user_id
  ) values (
    input_organization_id,
    input_layer_id,
    trim(input_title),
    nullif(trim(input_reference_code), ''),
    nullif(trim(input_description), ''),
    layer_geometry_type,
    parsed_geometry,
    'manual',
    auth.uid(),
    auth.uid()
  )
  returning id into created_id;

  return created_id;
end;
$$;

create or replace function public.update_map_shape(
  input_organization_id uuid,
  input_feature_id uuid,
  input_geometry jsonb
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  feature_geometry_type text;
  feature_layer_id uuid;
  expected_postgis_type text;
  parsed_geometry extensions.geometry;
  updated_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  select feature.geometry_type, feature.layer_id
  into feature_geometry_type, feature_layer_id
  from public.map_features feature
  join public.map_layers layer
    on layer.id = feature.layer_id
   and layer.organization_id = feature.organization_id
  where feature.id = input_feature_id
    and feature.organization_id = input_organization_id
    and feature.geometry_type in ('line', 'polygon')
    and feature.archived_at is null
    and layer.geometry_type = feature.geometry_type
    and layer.is_editable
    and layer.archived_at is null;

  if feature_geometry_type is null then
    raise exception 'Select an editable line or polygon.' using errcode = '22023';
  end if;
  if input_geometry is null
     or input_geometry->>'type' <> (case feature_geometry_type when 'line' then 'LineString' else 'Polygon' end) then
    raise exception 'The updated geometry must match the saved shape.' using errcode = '22023';
  end if;

  expected_postgis_type := case feature_geometry_type when 'line' then 'ST_LineString' else 'ST_Polygon' end;
  begin
    parsed_geometry := extensions.st_setsrid(extensions.st_geomfromgeojson(input_geometry::text), 4326);
  exception when others then
    raise exception 'The updated geometry is not valid GeoJSON.' using errcode = '22023';
  end;

  if parsed_geometry is null
     or extensions.st_isempty(parsed_geometry)
     or extensions.st_geometrytype(parsed_geometry) <> expected_postgis_type
     or not extensions.st_isvalid(parsed_geometry) then
    raise exception 'The updated geometry is invalid.' using errcode = '22023';
  end if;
  if extensions.st_npoints(parsed_geometry) > 5001 then
    raise exception 'A shape cannot contain more than 5,000 points.' using errcode = '22023';
  end if;
  if (feature_geometry_type = 'line' and extensions.st_npoints(parsed_geometry) < 2)
     or (feature_geometry_type = 'polygon' and extensions.st_npoints(parsed_geometry) < 4) then
    raise exception 'The shape does not have enough points.' using errcode = '22023';
  end if;

  if feature_geometry_type = 'line' then
    parsed_geometry := private.maps_snap_line_geometry(input_organization_id, feature_layer_id, input_feature_id, parsed_geometry, 3);
  end if;

  update public.map_features feature
  set geometry = parsed_geometry,
      updated_by_user_id = auth.uid()
  where feature.id = input_feature_id
    and feature.organization_id = input_organization_id
    and feature.archived_at is null
  returning feature.id into updated_id;

  if updated_id is null then
    raise exception 'The shape could not be updated.' using errcode = 'P0002';
  end if;
  return updated_id;
end;
$$;

revoke all on function private.maps_snap_line_geometry(uuid, uuid, uuid, extensions.geometry, double precision) from public, anon;
revoke all on function private.maps_rebuild_line_connections(uuid, uuid) from public, anon, authenticated;
revoke all on function private.refresh_map_network_connections() from public, anon, authenticated;
revoke all on function public.create_map_shape(uuid, uuid, text, text, text, jsonb) from public, anon;
revoke all on function public.update_map_shape(uuid, uuid, jsonb) from public, anon;
grant execute on function public.create_map_shape(uuid, uuid, text, text, text, jsonb) to authenticated;
grant execute on function public.update_map_shape(uuid, uuid, jsonb) to authenticated;
grant execute on function private.maps_snap_line_geometry(uuid, uuid, uuid, extensions.geometry, double precision) to authenticated;

do $$
declare
  feature_record record;
begin
  for feature_record in
    select feature.organization_id, feature.id
    from public.map_features feature
    where feature.geometry_type = 'line'
      and feature.archived_at is null
  loop
    perform private.maps_rebuild_line_connections(feature_record.organization_id, feature_record.id);
  end loop;
end;
$$;
