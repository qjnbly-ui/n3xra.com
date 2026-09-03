create or replace function public.move_map_point(
  input_organization_id uuid,
  input_feature_id uuid,
  input_longitude double precision,
  input_latitude double precision,
  input_accuracy_m double precision default null,
  input_placement_method text default 'manual'
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  moved_feature_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps edit access is required.' using errcode = '42501';
  end if;

  if input_longitude < -180 or input_longitude > 180
     or input_latitude < -90 or input_latitude > 90 then
    raise exception 'The new map coordinates are invalid.' using errcode = '22023';
  end if;

  if input_accuracy_m is not null and (input_accuracy_m < 0 or input_accuracy_m > 100000) then
    raise exception 'The location accuracy is invalid.' using errcode = '22023';
  end if;

  if input_placement_method not in ('manual', 'device_gps') then
    raise exception 'The placement method is invalid.' using errcode = '22023';
  end if;

  update public.map_features feature
  set geometry = extensions.st_setsrid(
        extensions.st_makepoint(input_longitude, input_latitude),
        4326
      ),
      location_accuracy_m = input_accuracy_m,
      placement_method = input_placement_method,
      updated_by_user_id = (select auth.uid())
  where feature.id = input_feature_id
    and feature.organization_id = input_organization_id
    and feature.geometry_type = 'point'
    and feature.archived_at is null
    and exists (
      select 1
      from public.map_layers layer
      where layer.id = feature.layer_id
        and layer.organization_id = input_organization_id
        and layer.geometry_type = 'point'
        and layer.is_editable
        and layer.archived_at is null
    )
  returning feature.id into moved_feature_id;

  if moved_feature_id is null then
    raise exception 'Active editable map point not found.' using errcode = 'P0002';
  end if;

  return moved_feature_id;
end;
$$;

revoke all on function public.move_map_point(uuid, uuid, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.move_map_point(uuid, uuid, double precision, double precision, double precision, text) to authenticated;
