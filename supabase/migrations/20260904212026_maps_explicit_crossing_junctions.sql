-- Explicit interior junctions use the existing network graph, not a second graph.
-- Timestamp aligned with the applied Supabase migration.
alter table public.map_network_connections drop constraint map_network_connections_endpoint_check;
alter table public.map_network_connections add constraint map_network_connections_endpoint_check
  check (endpoint in ('start', 'end') or endpoint ~ '^junction:[0-9a-f]{32}$');

-- Automatic endpoint reconciliation must not erase confirmed interior junctions.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('private.maps_rebuild_line_connections(uuid,uuid)'::regprocedure);
  if position('and connection.feature_id = input_feature_id;' in definition) = 0 then
    raise exception 'Unexpected endpoint rebuild definition';
  end if;
  definition := replace(definition, 'and connection.feature_id = input_feature_id;',
    'and connection.feature_id = input_feature_id and connection.endpoint in (''start'', ''end'');');
  execute definition;
  definition := pg_get_functiondef('private.refresh_map_network_connections()'::regprocedure);
  if position('and (connection.feature_id = new.id or connection.connected_feature_id = new.id);' in definition) = 0 then
    raise exception 'Unexpected network refresh definition';
  end if;
  definition := replace(definition,
    'and (connection.feature_id = new.id or connection.connected_feature_id = new.id);',
    'and (connection.feature_id = new.id or connection.connected_feature_id = new.id) and connection.endpoint in (''start'', ''end'');');
  execute definition;
end;
$$;

create function private.maps_connect_crossing(input_organization_id uuid, input_feature_id uuid,
  input_other_feature_id uuid, input_longitude double precision, input_latitude double precision)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a public.map_features%rowtype;
  b public.map_features%rowtype;
  a_system text;
  b_system text;
  p extensions.geometry;
  requested extensions.geometry;
  result uuid;
begin
  if auth.uid() is null or not (coalesce(public.organization_product_role(input_organization_id, 'maps') in ('account_admin','editor'), false)
    or coalesce(public.is_platform_admin(), false)) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_feature_id = input_other_feature_id or input_longitude is null or input_latitude is null
    or not (input_longitude between -180 and 180 and input_latitude between -85 and 85) then
    raise exception 'Choose a valid crossing of two different lines.';
  end if;
  -- Deterministic locking prevents opposite-order concurrent junction requests.
  perform 1 from public.map_features where organization_id = input_organization_id
    and id in (input_feature_id, input_other_feature_id) order by id for update;
  select * into a from public.map_features where organization_id = input_organization_id and id = least(input_feature_id,input_other_feature_id)
    and geometry_type = 'line' and archived_at is null;
  select * into b from public.map_features where organization_id = input_organization_id and id = greatest(input_feature_id,input_other_feature_id)
    and geometry_type = 'line' and archived_at is null;
  select system_type into a_system from public.map_layers where id = a.layer_id and organization_id = input_organization_id and is_editable and archived_at is null;
  select system_type into b_system from public.map_layers where id = b.layer_id and organization_id = input_organization_id and is_editable and archived_at is null;
  if a.id is null or b.id is null or a_system is null or b_system is distinct from a_system
    or a_system not in ('potable_water','sanitary_sewer','stormwater','reclaimed_water') then
    raise exception 'Both lines must be editable and belong to the same utility system.';
  end if;
  requested := extensions.st_setsrid(extensions.st_makepoint(input_longitude,input_latitude),4326);
  select extensions.st_transform(d.geom,4326) into p
    from extensions.st_dump(extensions.st_collectionextract(extensions.st_intersection(
      extensions.st_transform(a.geometry,3857),extensions.st_transform(b.geometry,3857)),1)) d
    order by extensions.st_distance(d.geom,extensions.st_transform(requested,3857)) limit 1;
  if p is null or not extensions.st_dwithin(p::extensions.geography,requested::extensions.geography,3.1) then
    raise exception 'The lines no longer cross here. Refresh the map and select the crossing again.';
  end if;
  insert into public.map_network_connections(organization_id,feature_id,endpoint,connected_feature_id,geometry,connected_fraction,snap_distance_m)
    values(input_organization_id,a.id,'junction:' || md5(b.id::text || extensions.st_astext(extensions.st_snaptogrid(p,0.00000001))),b.id,p,
      extensions.st_linelocatepoint(b.geometry,p),0)
    on conflict (organization_id,feature_id,endpoint) do update set geometry = excluded.geometry, connected_fraction = excluded.connected_fraction
    returning id into result;
  return result;
end;
$$;
revoke all on function private.maps_connect_crossing(uuid,uuid,uuid,double precision,double precision) from public,anon;
grant execute on function private.maps_connect_crossing(uuid,uuid,uuid,double precision,double precision) to authenticated;
create function public.maps_connect_crossing(input_organization_id uuid, input_feature_id uuid,
  input_other_feature_id uuid, input_longitude double precision, input_latitude double precision)
returns uuid language sql security invoker set search_path = '' as $$
  select private.maps_connect_crossing(input_organization_id,input_feature_id,input_other_feature_id,input_longitude,input_latitude);
$$;
revoke all on function public.maps_connect_crossing(uuid,uuid,uuid,double precision,double precision) from public,anon;
grant execute on function public.maps_connect_crossing(uuid,uuid,uuid,double precision,double precision) to authenticated;

-- Never retain a phantom connection after a line is moved or archived.
create function private.maps_validate_crossing_junctions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.map_network_connections c where c.organization_id = new.organization_id
    and c.endpoint like 'junction:%' and (c.feature_id = new.id or c.connected_feature_id = new.id)
    and (new.archived_at is not null or new.geometry_type <> 'line'
      or not extensions.st_dwithin(new.geometry::extensions.geography,c.geometry::extensions.geography,0.05));
  update public.map_network_connections c set connected_fraction = extensions.st_linelocatepoint(new.geometry,c.geometry)
    where c.organization_id = new.organization_id and c.connected_feature_id = new.id and c.endpoint like 'junction:%' and new.geometry_type = 'line';
  return new;
end;
$$;
revoke all on function private.maps_validate_crossing_junctions() from public,anon,authenticated;
create trigger maps_validate_crossing_junctions after update of geometry, archived_at on public.map_features
  for each row execute function private.maps_validate_crossing_junctions();
