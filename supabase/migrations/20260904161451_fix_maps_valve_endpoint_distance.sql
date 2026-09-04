
create or replace function private.maps_insert_valve_on_line(
  input_organization_id uuid,
  input_line_feature_id uuid,
  input_valve_layer_id uuid,
  input_longitude double precision,
  input_latitude double precision,
  input_title text,
  input_reference_code text default null,
  input_description text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  line_row public.map_features%rowtype;
  valve_layer public.map_layers%rowtype;
  requested_point extensions.geometry;
  split_point extensions.geometry;
  line_a_geometry extensions.geometry;
  line_b_geometry extensions.geometry;
  split_fraction double precision;
  snap_distance double precision;
  endpoint_distance double precision;
  line_b_id uuid;
  valve_id uuid;
  next_reference text;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_longitude < -180 or input_longitude > 180 or input_latitude < -90 or input_latitude > 90 then
    raise exception 'The valve location is invalid.' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(input_title), '') is null then
    raise exception 'A valve title is required.' using errcode = '22023';
  end if;

  select feature.* into line_row
  from public.map_features feature
  join public.map_layers layer
    on layer.organization_id = feature.organization_id
   and layer.id = feature.layer_id
  where feature.organization_id = input_organization_id
    and feature.id = input_line_feature_id
    and feature.geometry_type = 'line'
    and feature.archived_at is null
    and layer.system_type = 'potable_water'
    and layer.is_editable
    and layer.archived_at is null
  for update of feature;

  if line_row.id is null or extensions.geometrytype(line_row.geometry) <> 'LINESTRING' then
    raise exception 'Select an active editable water line.' using errcode = '22023';
  end if;

  select layer.* into valve_layer
  from public.map_layers layer
  where layer.organization_id = input_organization_id
    and layer.id = input_valve_layer_id
    and layer.geometry_type = 'point'
    and layer.system_type = 'potable_water'
    and (layer.icon_key = 'valve' or layer.standard_key = 'water-valve')
    and layer.is_editable
    and layer.archived_at is null;

  if valve_layer.id is null then
    raise exception 'Choose an active Water valves point layer.' using errcode = '22023';
  end if;

  requested_point := extensions.st_setsrid(extensions.st_makepoint(input_longitude, input_latitude), 4326);
  split_point := extensions.st_closestpoint(line_row.geometry, requested_point);
  snap_distance := extensions.st_distance(requested_point::extensions.geography, split_point::extensions.geography);
  split_fraction := extensions.st_linelocatepoint(line_row.geometry, split_point);
  endpoint_distance := least(
    extensions.st_distance(extensions.st_startpoint(line_row.geometry)::extensions.geography, split_point::extensions.geography),
    extensions.st_distance(extensions.st_endpoint(line_row.geometry)::extensions.geography, split_point::extensions.geography)
  );

  if snap_distance > 30 then
    raise exception 'Place the valve within 98 feet of the selected water line.' using errcode = '22023';
  end if;
  if split_fraction <= 0 or split_fraction >= 1 or endpoint_distance < 0.15 then
    raise exception 'Place the valve at least 6 inches from either end of the line.' using errcode = '22023';
  end if;

  line_a_geometry := extensions.st_linesubstring(line_row.geometry, 0, split_fraction);
  line_b_geometry := extensions.st_linesubstring(line_row.geometry, split_fraction, 1);
  if extensions.st_npoints(line_a_geometry) < 2 or extensions.st_npoints(line_b_geometry) < 2 then
    raise exception 'The selected location cannot create two valid line segments.' using errcode = '22023';
  end if;

  update public.map_features
  set geometry = line_a_geometry,
      updated_by_user_id = (select auth.uid())
  where organization_id = input_organization_id
    and id = line_row.id;

  next_reference := case
    when line_row.reference_code is null then null
    else pg_catalog.left(line_row.reference_code, 96) || '-02'
  end;

  insert into public.map_features (
    organization_id, layer_id, title, reference_code, address, customer_reference,
    description, status, geometry_type, geometry, location_accuracy_m, placement_method,
    properties, future_customer_account_id, future_work_order_id, flow_direction,
    created_by_user_id, updated_by_user_id
  ) values (
    input_organization_id, line_row.layer_id, line_row.title || ' — segment 2', next_reference,
    line_row.address, line_row.customer_reference, line_row.description, line_row.status,
    'line', line_b_geometry, line_row.location_accuracy_m, line_row.placement_method,
    line_row.properties || pg_catalog.jsonb_build_object('splitFromFeatureId', line_row.id),
    line_row.future_customer_account_id, line_row.future_work_order_id, line_row.flow_direction,
    (select auth.uid()), (select auth.uid())
  ) returning id into line_b_id;

  insert into public.map_features (
    organization_id, layer_id, title, reference_code, description,
    status, geometry_type, geometry, placement_method, properties,
    created_by_user_id, updated_by_user_id
  ) values (
    input_organization_id, valve_layer.id, pg_catalog.btrim(input_title),
    nullif(pg_catalog.btrim(input_reference_code), ''), nullif(pg_catalog.btrim(input_description), ''),
    'active', 'point', split_point, 'manual',
    pg_catalog.jsonb_build_object(
      'networkRole', 'isolation_valve',
      'insertedOnLineId', line_row.id,
      'connectedLineIds', pg_catalog.jsonb_build_array(line_row.id, line_b_id)
    ),
    (select auth.uid()), (select auth.uid())
  ) returning id into valve_id;

  insert into public.map_network_devices (
    organization_id, device_feature_id, line_a_feature_id, line_b_feature_id,
    device_type, geometry, created_by_user_id
  ) values (
    input_organization_id, valve_id, line_row.id, line_b_id,
    'valve', split_point, (select auth.uid())
  );

  return pg_catalog.jsonb_build_object(
    'lineAFeatureId', line_row.id,
    'lineBFeatureId', line_b_id,
    'valveFeatureId', valve_id,
    'longitude', extensions.st_x(split_point),
    'latitude', extensions.st_y(split_point),
    'snapDistanceMeters', snap_distance
  );
end;
$$;
