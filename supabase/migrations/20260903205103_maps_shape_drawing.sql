alter table public.map_features
  drop constraint if exists map_features_geometry_matches_type_check,
  add constraint map_features_geometry_matches_type_check check (
    (geometry_type = 'point' and extensions.st_geometrytype(geometry) = 'ST_Point')
    or (geometry_type = 'line' and extensions.st_geometrytype(geometry) = 'ST_LineString')
    or (geometry_type = 'polygon' and extensions.st_geometrytype(geometry) = 'ST_Polygon')
  );

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

revoke all on function public.create_map_shape(uuid, uuid, text, text, text, jsonb) from public, anon;
grant execute on function public.create_map_shape(uuid, uuid, text, text, text, jsonb) to authenticated;
