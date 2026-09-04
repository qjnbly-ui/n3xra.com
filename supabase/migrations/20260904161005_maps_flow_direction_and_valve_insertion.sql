alter table public.map_features
  add column if not exists flow_direction text not null default 'unknown';

alter table public.map_features
  drop constraint if exists map_features_flow_direction_check,
  add constraint map_features_flow_direction_check check (
    flow_direction in ('unknown', 'start_to_end', 'end_to_start')
    and (geometry_type = 'line' or flow_direction = 'unknown')
  );

create table public.map_network_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  device_feature_id uuid not null,
  line_a_feature_id uuid not null,
  line_b_feature_id uuid not null,
  device_type text not null default 'valve',
  geometry extensions.geometry(Point, 4326) not null,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint map_network_devices_device_fkey
    foreign key (organization_id, device_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_network_devices_line_a_fkey
    foreign key (organization_id, line_a_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_network_devices_line_b_fkey
    foreign key (organization_id, line_b_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_network_devices_device_unique unique (organization_id, device_feature_id),
  constraint map_network_devices_distinct_lines_check check (line_a_feature_id <> line_b_feature_id),
  constraint map_network_devices_type_check check (device_type = 'valve')
);

create index map_network_devices_line_a_idx
  on public.map_network_devices (organization_id, line_a_feature_id);
create index map_network_devices_line_b_idx
  on public.map_network_devices (organization_id, line_b_feature_id);
create index map_network_devices_geometry_gist_idx
  on public.map_network_devices using gist (geometry);

alter table public.map_network_devices enable row level security;
revoke all on public.map_network_devices from public, anon, authenticated;
grant select on public.map_network_devices to authenticated;
grant all on public.map_network_devices to service_role;

create policy "map_network_devices_select"
on public.map_network_devices for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create or replace function public.set_map_line_flow_direction(
  input_organization_id uuid,
  input_feature_id uuid,
  input_flow_direction text
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  updated_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_flow_direction not in ('unknown', 'start_to_end', 'end_to_start') then
    raise exception 'Choose a valid flow direction.' using errcode = '22023';
  end if;

  update public.map_features feature
  set flow_direction = input_flow_direction,
      updated_by_user_id = (select auth.uid())
  from public.map_layers layer
  where feature.organization_id = input_organization_id
    and feature.id = input_feature_id
    and feature.geometry_type = 'line'
    and feature.archived_at is null
    and layer.organization_id = feature.organization_id
    and layer.id = feature.layer_id
    and layer.is_editable
    and layer.archived_at is null
  returning feature.id into updated_id;

  if updated_id is null then
    raise exception 'Select an active editable line.' using errcode = 'P0002';
  end if;
  return updated_id;
end;
$$;

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

create or replace function public.maps_insert_valve_on_line(
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
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maps_insert_valve_on_line(
    input_organization_id, input_line_feature_id, input_valve_layer_id,
    input_longitude, input_latitude, input_title, input_reference_code, input_description
  );
$$;

create or replace function private.remove_archived_map_network_devices()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null then
    delete from public.map_network_devices device
    where device.organization_id = new.organization_id
      and new.id in (device.device_feature_id, device.line_a_feature_id, device.line_b_feature_id);
  end if;
  return new;
end;
$$;

drop trigger if exists map_features_remove_archived_network_devices on public.map_features;
create trigger map_features_remove_archived_network_devices
after update of archived_at on public.map_features
for each row execute function private.remove_archived_map_network_devices();

revoke all on function public.set_map_line_flow_direction(uuid, uuid, text) from public, anon;
revoke all on function private.maps_insert_valve_on_line(uuid, uuid, uuid, double precision, double precision, text, text, text) from public, anon;
revoke all on function public.maps_insert_valve_on_line(uuid, uuid, uuid, double precision, double precision, text, text, text) from public, anon;
revoke all on function private.remove_archived_map_network_devices() from public, anon, authenticated;
grant execute on function public.set_map_line_flow_direction(uuid, uuid, text) to authenticated;
grant execute on function private.maps_insert_valve_on_line(uuid, uuid, uuid, double precision, double precision, text, text, text) to authenticated;
grant execute on function public.maps_insert_valve_on_line(uuid, uuid, uuid, double precision, double precision, text, text, text) to authenticated;
