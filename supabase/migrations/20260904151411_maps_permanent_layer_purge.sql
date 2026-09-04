alter table public.map_events
  drop constraint if exists map_events_amends_fkey,
  add constraint map_events_amends_fkey
    foreign key (amends_event_id)
    references public.map_events (id)
    on delete no action
    deferrable initially immediate;

create or replace function private.prevent_map_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  purge_layer_id uuid := nullif(pg_catalog.current_setting('n3xra.maps_purge_layer_id', true), '')::uuid;
begin
  if tg_op = 'DELETE'
     and purge_layer_id is not null
     and (
       public.organization_product_role(old.organization_id, 'maps') = 'account_admin'
       or (select public.is_platform_admin())
     )
     and exists (
       select 1
       from public.map_features feature
       where feature.organization_id = old.organization_id
         and feature.id = old.feature_id
         and feature.layer_id = purge_layer_id
     ) then
    return old;
  end if;

  raise exception 'Submitted map history is permanent. Add a correction or void record instead.' using errcode = '55000';
end;
$$;

create or replace function private.guard_map_incident_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
  purge_layer_id uuid := nullif(pg_catalog.current_setting('n3xra.maps_purge_layer_id', true), '')::uuid;
begin
  if tg_op = 'DELETE' then
    if purge_layer_id is not null
       and (
         public.organization_product_role(old.organization_id, 'maps') = 'account_admin'
         or (select public.is_platform_admin())
       )
       and exists (
         select 1
         from public.map_features feature
         where feature.organization_id = old.organization_id
           and feature.id = old.feature_id
           and feature.layer_id = purge_layer_id
       ) then
      return old;
    end if;
    raise exception 'Incidents cannot be deleted.' using errcode = '55000';
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
  incident_feature_id uuid;
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
  purge_layer_id uuid := nullif(pg_catalog.current_setting('n3xra.maps_purge_layer_id', true), '')::uuid;
begin
  if tg_op = 'DELETE' then
    if purge_layer_id is not null
       and (
         public.organization_product_role(old.organization_id, 'maps') = 'account_admin'
         or (select public.is_platform_admin())
       )
       and exists (
         select 1
         from public.map_incidents incident
         join public.map_features feature
           on feature.organization_id = incident.organization_id
          and feature.id = incident.feature_id
         where incident.organization_id = old.organization_id
           and incident.id = old.incident_id
           and feature.layer_id = purge_layer_id
       ) then
      return old;
    end if;
    raise exception 'Incident updates are permanent and cannot be edited or deleted.' using errcode = '55000';
  end if;

  if tg_op <> 'INSERT' then
    raise exception 'Incident updates are permanent and cannot be edited or deleted.' using errcode = '55000';
  end if;
  if action_name not in ('start', 'update', 'close') then
    raise exception 'Use the protected incident actions.' using errcode = '42501';
  end if;

  select incident.status, incident.feature_id
  into incident_status, incident_feature_id
  from public.map_incidents incident
  where incident.organization_id = new.organization_id
    and incident.id = new.incident_id;

  if incident_status is null then
    raise exception 'Incident not found.' using errcode = 'P0002';
  end if;
  if incident_status = 'resolved' then
    raise exception 'Resolved incidents cannot receive new updates.' using errcode = '55000';
  end if;

  new.created_by_user_id := (select auth.uid());
  new.submitted_at := now();
  return new;
end;
$$;

create or replace function public.maps_archived_layer_storage_manifest(
  input_organization_id uuid,
  input_layer_id uuid
)
returns table (bucket_id text, object_name text)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') is distinct from 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps account administrator access is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.map_layers layer
    where layer.organization_id = input_organization_id
      and layer.id = input_layer_id
      and layer.archived_at is not null
  ) then
    raise exception 'Archived map layer not found.' using errcode = 'P0002';
  end if;

  return query
  select 'maps-asset-photos'::text, photo.storage_path
  from public.map_feature_photos photo
  join public.map_features feature
    on feature.organization_id = photo.organization_id
   and feature.id = photo.feature_id
  where feature.organization_id = input_organization_id
    and feature.layer_id = input_layer_id;
end;
$$;

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
  set constraints map_events_amends_fkey deferred;

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

create or replace function public.maps_permanently_delete_archived_layer(
  input_organization_id uuid,
  input_layer_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.maps_permanently_delete_archived_layer(input_organization_id, input_layer_id);
$$;

revoke all on function public.maps_archived_layer_storage_manifest(uuid, uuid) from public, anon;
revoke all on function private.maps_permanently_delete_archived_layer(uuid, uuid) from public, anon;
revoke all on function public.maps_permanently_delete_archived_layer(uuid, uuid) from public, anon;
grant execute on function public.maps_archived_layer_storage_manifest(uuid, uuid) to authenticated;
grant execute on function private.maps_permanently_delete_archived_layer(uuid, uuid) to authenticated;
grant execute on function public.maps_permanently_delete_archived_layer(uuid, uuid) to authenticated;
