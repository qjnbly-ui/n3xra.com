create table public.map_point_line_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  point_feature_id uuid not null,
  line_feature_id uuid not null,
  connection_type text not null default 'asset_connection',
  geometry extensions.geometry(Point, 4326) not null,
  line_fraction double precision not null,
  distance_m numeric(10,3) not null,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_point_line_connections_point_fkey
    foreign key (organization_id, point_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_point_line_connections_line_fkey
    foreign key (organization_id, line_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_point_line_connections_point_unique unique (organization_id, point_feature_id),
  constraint map_point_line_connections_distinct_features check (point_feature_id <> line_feature_id),
  constraint map_point_line_connections_type_check check (connection_type in (
    'service_endpoint', 'service_to_main', 'hydrant_lateral', 'access_structure',
    'drainage_inlet', 'network_device', 'asset_connection'
  )),
  constraint map_point_line_connections_fraction_check check (line_fraction between 0 and 1),
  constraint map_point_line_connections_distance_check check (distance_m between 0 and 100)
);

create index map_point_line_connections_line_idx
  on public.map_point_line_connections (organization_id, line_feature_id);
create index map_point_line_connections_geometry_gist_idx
  on public.map_point_line_connections using gist (geometry);

drop trigger if exists map_point_line_connections_set_updated_at on public.map_point_line_connections;
create trigger map_point_line_connections_set_updated_at
before update on public.map_point_line_connections
for each row execute function public.set_updated_at();

alter table public.map_point_line_connections enable row level security;
revoke all on public.map_point_line_connections from public, anon, authenticated;
grant select on public.map_point_line_connections to authenticated;
grant all on public.map_point_line_connections to service_role;

create policy "map_point_line_connections_select"
on public.map_point_line_connections for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create or replace function private.maps_connect_point_to_line(
  input_organization_id uuid,
  input_point_feature_id uuid,
  input_line_feature_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  point_row public.map_features%rowtype;
  line_row public.map_features%rowtype;
  point_layer public.map_layers%rowtype;
  line_layer public.map_layers%rowtype;
  connected_geometry extensions.geometry;
  connected_fraction double precision;
  connection_distance double precision;
  resolved_type text;
  connection_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  select feature.*
  into point_row
  from public.map_features feature
  join public.map_layers layer
    on layer.organization_id = feature.organization_id and layer.id = feature.layer_id
  where feature.organization_id = input_organization_id
    and feature.id = input_point_feature_id
    and feature.geometry_type = 'point'
    and feature.archived_at is null
    and layer.geometry_type = 'point'
    and layer.is_editable
    and layer.archived_at is null;

  if point_row.id is null then
    raise exception 'Select an active editable point asset.' using errcode = '22023';
  end if;

  select layer.*
  into point_layer
  from public.map_layers layer
  where layer.organization_id = input_organization_id
    and layer.id = point_row.layer_id;

  select feature.*
  into line_row
  from public.map_features feature
  join public.map_layers layer
    on layer.organization_id = feature.organization_id and layer.id = feature.layer_id
  where feature.organization_id = input_organization_id
    and feature.id = input_line_feature_id
    and feature.geometry_type = 'line'
    and feature.archived_at is null
    and layer.geometry_type = 'line'
    and layer.is_editable
    and layer.archived_at is null;

  if line_row.id is null then
    raise exception 'Select an active editable utility line.' using errcode = '22023';
  end if;

  select layer.*
  into line_layer
  from public.map_layers layer
  where layer.organization_id = input_organization_id
    and layer.id = line_row.layer_id;
  if point_layer.system_type not in ('potable_water', 'sanitary_sewer', 'stormwater', 'reclaimed_water')
     or point_layer.system_type <> line_layer.system_type then
    raise exception 'The point and line must belong to the same utility system.' using errcode = '22023';
  end if;

  connected_geometry := extensions.st_closestpoint(line_row.geometry, point_row.geometry);
  connected_fraction := extensions.st_linelocatepoint(line_row.geometry, connected_geometry);
  connection_distance := extensions.st_distance(point_row.geometry::extensions.geography, connected_geometry::extensions.geography);
  if connection_distance > 100 then
    raise exception 'The selected utility line is more than 328 feet from this asset.' using errcode = '22023';
  end if;

  resolved_type := case
    when point_layer.standard_key = 'water-meter' and line_layer.standard_key = 'water-service' then 'service_endpoint'
    when point_layer.standard_key = 'water-meter' and line_layer.standard_key = 'water-main' then 'service_to_main'
    when point_layer.standard_key = 'fire-hydrant' then 'hydrant_lateral'
    when point_layer.standard_key in ('sewer-manhole', 'cleanout') then 'access_structure'
    when point_layer.standard_key = 'storm-inlet' then 'drainage_inlet'
    when point_layer.icon_key in ('valve', 'pump', 'lift-station', 'well', 'tank', 'backflow') then 'network_device'
    else 'asset_connection'
  end;

  insert into public.map_point_line_connections (
    organization_id, point_feature_id, line_feature_id, connection_type,
    geometry, line_fraction, distance_m, created_by_user_id
  ) values (
    input_organization_id, point_row.id, line_row.id, resolved_type,
    connected_geometry, connected_fraction, connection_distance, (select auth.uid())
  )
  on conflict (organization_id, point_feature_id) do update
  set line_feature_id = excluded.line_feature_id,
      connection_type = excluded.connection_type,
      geometry = excluded.geometry,
      line_fraction = excluded.line_fraction,
      distance_m = excluded.distance_m
  returning id into connection_id;

  return pg_catalog.jsonb_build_object(
    'connectionId', connection_id,
    'pointFeatureId', point_row.id,
    'lineFeatureId', line_row.id,
    'connectionType', resolved_type,
    'distanceMeters', connection_distance,
    'longitude', extensions.st_x(connected_geometry),
    'latitude', extensions.st_y(connected_geometry)
  );
end;
$$;

create or replace function public.maps_connect_point_to_line(
  input_organization_id uuid,
  input_point_feature_id uuid,
  input_line_feature_id uuid
)
returns jsonb
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maps_connect_point_to_line(
    input_organization_id, input_point_feature_id, input_line_feature_id
  );
$$;

create or replace function private.maps_disconnect_point_from_line(
  input_organization_id uuid,
  input_point_feature_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  delete from public.map_point_line_connections connection
  where connection.organization_id = input_organization_id
    and connection.point_feature_id = input_point_feature_id;
  return found;
end;
$$;

create or replace function public.maps_disconnect_point_from_line(
  input_organization_id uuid,
  input_point_feature_id uuid
)
returns boolean
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maps_disconnect_point_from_line(input_organization_id, input_point_feature_id);
$$;

revoke all on function private.maps_connect_point_to_line(uuid, uuid, uuid) from public, anon;
revoke all on function public.maps_connect_point_to_line(uuid, uuid, uuid) from public, anon;
revoke all on function private.maps_disconnect_point_from_line(uuid, uuid) from public, anon;
revoke all on function public.maps_disconnect_point_from_line(uuid, uuid) from public, anon;
grant execute on function private.maps_connect_point_to_line(uuid, uuid, uuid) to authenticated;
grant execute on function public.maps_connect_point_to_line(uuid, uuid, uuid) to authenticated;
grant execute on function private.maps_disconnect_point_from_line(uuid, uuid) to authenticated;
grant execute on function public.maps_disconnect_point_from_line(uuid, uuid) to authenticated;
