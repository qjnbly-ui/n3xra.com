-- Only explicitly confirmed crossings are removable here. Automatic endpoint
-- relationships need geometry editing; otherwise reconciliation recreates them.
create function private.maps_disconnect_crossing(input_organization_id uuid, input_connection_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  connection_row public.map_network_connections%rowtype;
  editable_count integer;
begin
  if auth.uid() is null or not (
    coalesce(public.organization_product_role(input_organization_id,'maps') in ('account_admin','editor'),false)
    or coalesce(public.is_platform_admin(),false)) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  select * into connection_row from public.map_network_connections
    where organization_id = input_organization_id and id = input_connection_id;
  if not found then return false; end if;
  -- Match connect/edit locking order: features first, connection second.
  perform 1 from public.map_features where organization_id = input_organization_id
    and id in (connection_row.feature_id,connection_row.connected_feature_id) order by id for update;
  select * into connection_row from public.map_network_connections
    where organization_id = input_organization_id and id = input_connection_id for update;
  if not found then return false; end if;
  if connection_row.endpoint not like 'junction:%' then
    raise exception 'This is an endpoint connection. Edit the line endpoint instead.' using errcode = '22023';
  end if;
  select count(*) into editable_count from public.map_features f
    join public.map_layers l on l.organization_id = f.organization_id and l.id = f.layer_id
    where f.organization_id = input_organization_id
      and f.id in (connection_row.feature_id,connection_row.connected_feature_id)
      and f.geometry_type = 'line' and f.archived_at is null and l.archived_at is null and l.is_editable;
  if editable_count <> 2 then
    raise exception 'Both connected lines must be active and editable.' using errcode = '42501';
  end if;
  delete from public.map_network_connections where organization_id = input_organization_id
    and id = input_connection_id and endpoint like 'junction:%';
  return found;
end;
$$;
revoke all on function private.maps_disconnect_crossing(uuid,uuid) from public,anon;
grant execute on function private.maps_disconnect_crossing(uuid,uuid) to authenticated;
create function public.maps_disconnect_crossing(input_organization_id uuid,input_connection_id uuid)
returns boolean language sql security invoker set search_path = '' as $$
  select private.maps_disconnect_crossing(input_organization_id,input_connection_id);
$$;
revoke all on function public.maps_disconnect_crossing(uuid,uuid) from public,anon;
grant execute on function public.maps_disconnect_crossing(uuid,uuid) to authenticated;
