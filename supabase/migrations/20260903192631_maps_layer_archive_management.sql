grant delete on public.map_layers to authenticated;
grant delete on public.map_features to authenticated;

drop policy if exists "map_layers_delete_archived" on public.map_layers;
create policy "map_layers_delete_archived"
on public.map_layers for delete to authenticated
using (
  archived_at is not null
  and (
    (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
    or (select public.is_platform_admin())
  )
);

drop policy if exists "map_features_delete_archived" on public.map_features;
create policy "map_features_delete_archived"
on public.map_features for delete to authenticated
using (
  archived_at is not null
  and (
    (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
    or (select public.is_platform_admin())
  )
);

create or replace function public.maps_archive_layer(
  input_organization_id uuid,
  input_layer_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  archived_timestamp timestamptz := clock_timestamp();
  archived_layer_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps edit access is required.' using errcode = '42501';
  end if;

  update public.map_layers
  set archived_at = archived_timestamp,
      updated_by_user_id = (select auth.uid())
  where id = input_layer_id
    and organization_id = input_organization_id
    and archived_at is null
  returning id into archived_layer_id;

  if archived_layer_id is null then
    raise exception 'Active map layer not found.' using errcode = 'P0002';
  end if;

  update public.map_features
  set archived_at = archived_timestamp,
      updated_by_user_id = (select auth.uid())
  where organization_id = input_organization_id
    and layer_id = input_layer_id
    and archived_at is null;

  return archived_layer_id;
end;
$$;

create or replace function public.maps_restore_layer(
  input_organization_id uuid,
  input_layer_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  archived_timestamp timestamptz;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps edit access is required.' using errcode = '42501';
  end if;

  select archived_at
  into archived_timestamp
  from public.map_layers
  where id = input_layer_id
    and organization_id = input_organization_id
    and archived_at is not null;

  if archived_timestamp is null then
    raise exception 'Archived map layer not found.' using errcode = 'P0002';
  end if;

  update public.map_layers
  set archived_at = null,
      updated_by_user_id = (select auth.uid())
  where id = input_layer_id
    and organization_id = input_organization_id;

  update public.map_features
  set archived_at = null,
      updated_by_user_id = (select auth.uid())
  where organization_id = input_organization_id
    and layer_id = input_layer_id
    and archived_at = archived_timestamp;

  return input_layer_id;
end;
$$;

revoke all on function public.maps_archive_layer(uuid, uuid) from public, anon;
revoke all on function public.maps_restore_layer(uuid, uuid) from public, anon;
grant execute on function public.maps_archive_layer(uuid, uuid) to authenticated;
grant execute on function public.maps_restore_layer(uuid, uuid) to authenticated;
