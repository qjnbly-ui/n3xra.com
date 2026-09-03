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
  expected_postgis_type text;
  parsed_geometry extensions.geometry;
  updated_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  select feature.geometry_type
  into feature_geometry_type
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

revoke all on function public.update_map_shape(uuid, uuid, jsonb) from public, anon;
grant execute on function public.update_map_shape(uuid, uuid, jsonb) to authenticated;
