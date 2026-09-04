create or replace function private.maps_permanently_delete_archived_layer(
  input_organization_id uuid,
  input_layer_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  layer_name text;
  deleted_features integer := 0;
  deleted_events integer := 0;
  deleted_tasks integer := 0;
  deleted_incidents integer := 0;
  deleted_incident_updates integer := 0;
  deleted_photos integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') is distinct from 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps account administrator access is required.' using errcode = '42501';
  end if;

  select layer.name into layer_name
  from public.map_layers layer
  where layer.organization_id = input_organization_id
    and layer.id = input_layer_id
    and layer.archived_at is not null
  for update;

  if layer_name is null then
    raise exception 'Archived map layer not found.' using errcode = 'P0002';
  end if;
  if exists (
    select 1 from public.map_features feature
    where feature.organization_id = input_organization_id
      and feature.layer_id = input_layer_id
      and feature.archived_at is null
  ) then
    raise exception 'Every item in the layer must be archived before permanent deletion.' using errcode = '55000';
  end if;

  perform pg_catalog.set_config('n3xra.maps_purge_layer_id', input_layer_id::text, true);
  set constraints all deferred;

  delete from public.map_incident_updates update_row
  using public.map_incidents incident, public.map_features feature
  where update_row.organization_id = input_organization_id
    and incident.organization_id = update_row.organization_id
    and incident.id = update_row.incident_id
    and feature.organization_id = incident.organization_id
    and feature.id = incident.feature_id
    and feature.layer_id = input_layer_id;
  get diagnostics deleted_incident_updates = row_count;

  delete from public.map_incidents incident
  using public.map_features feature
  where incident.organization_id = input_organization_id
    and feature.organization_id = incident.organization_id
    and feature.id = incident.feature_id
    and feature.layer_id = input_layer_id;
  get diagnostics deleted_incidents = row_count;

  delete from public.map_tasks task
  using public.map_features feature
  where task.organization_id = input_organization_id
    and feature.organization_id = task.organization_id
    and feature.id = task.feature_id
    and feature.layer_id = input_layer_id;
  get diagnostics deleted_tasks = row_count;

  delete from public.map_events event
  using public.map_features feature
  where event.organization_id = input_organization_id
    and feature.organization_id = event.organization_id
    and feature.id = event.feature_id
    and feature.layer_id = input_layer_id;
  get diagnostics deleted_events = row_count;

  delete from public.map_feature_photos photo
  using public.map_features feature
  where photo.organization_id = input_organization_id
    and feature.organization_id = photo.organization_id
    and feature.id = photo.feature_id
    and feature.layer_id = input_layer_id;
  get diagnostics deleted_photos = row_count;

  delete from public.organization_file_folders folder
  using public.map_features feature
  where folder.organization_id = input_organization_id
    and folder.source_product = 'maps'
    and folder.source_entity_id = feature.id
    and feature.organization_id = input_organization_id
    and feature.layer_id = input_layer_id;

  delete from public.map_features feature
  where feature.organization_id = input_organization_id
    and feature.layer_id = input_layer_id;
  get diagnostics deleted_features = row_count;

  delete from public.map_layers layer
  where layer.organization_id = input_organization_id
    and layer.id = input_layer_id
    and layer.archived_at is not null;

  if not found then
    raise exception 'Archived map layer could not be deleted.' using errcode = '55000';
  end if;

  return jsonb_build_object(
    'layerId', input_layer_id,
    'layerName', layer_name,
    'deletedFeatures', deleted_features,
    'deletedEvents', deleted_events,
    'deletedTasks', deleted_tasks,
    'deletedIncidents', deleted_incidents,
    'deletedIncidentUpdates', deleted_incident_updates,
    'deletedPhotos', deleted_photos
  );
end;
$$;

revoke all on function private.maps_permanently_delete_archived_layer(uuid, uuid) from public, anon;
grant execute on function private.maps_permanently_delete_archived_layer(uuid, uuid) to authenticated;
