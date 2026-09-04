-- Run in a disposable/local database with all preceding migrations applied.
-- Supply session settings n3xra.test_org, n3xra.test_layer (editable water-main),
-- n3xra.test_editor, and n3xra.test_outsider. Nothing is committed.
\set ON_ERROR_STOP on
begin;
\ir ../../supabase/migrations/20260904213637_maps_disconnect_crossing.sql
do $$
declare
  org uuid := current_setting('n3xra.test_org')::uuid;
  layer uuid := current_setting('n3xra.test_layer')::uuid;
  editor text := current_setting('n3xra.test_editor');
  outsider text := current_setting('n3xra.test_outsider');
  a uuid; b uuid; c uuid; junction uuid; remaining uuid;
begin
  perform set_config('request.jwt.claim.sub',editor,true);
  insert into public.map_features(organization_id,layer_id,title,geometry_type,geometry)
    values(org,layer,'Disconnect fixture A','line',extensions.st_geomfromtext('LINESTRING(-1 0,1 0)',4326)) returning id into a;
  insert into public.map_features(organization_id,layer_id,title,geometry_type,geometry)
    values(org,layer,'Disconnect fixture B','line',extensions.st_geomfromtext('LINESTRING(0 -1,0 1)',4326)) returning id into b;
  insert into public.map_features(organization_id,layer_id,title,geometry_type,geometry)
    values(org,layer,'Disconnect fixture C','line',extensions.st_geomfromtext('LINESTRING(-1 -1,1 1)',4326)) returning id into c;
  junction := public.maps_connect_crossing(org,a,b,0,0);
  remaining := public.maps_connect_crossing(org,a,c,0,0);
  perform set_config('request.jwt.claim.sub',outsider,true);
  begin
    perform public.maps_disconnect_crossing(org,junction);
    raise exception 'Nonmember was allowed to disconnect';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',editor,true);
  if not public.maps_disconnect_crossing(org,junction) then raise exception 'Disconnect did not succeed'; end if;
  if public.maps_disconnect_crossing(org,junction) then raise exception 'Repeated disconnect was not idempotent'; end if;
  perform private.maps_rebuild_line_connections(org,a);
  if exists(select 1 from public.map_network_connections where id=junction) then raise exception 'Removed crossing returned'; end if;
  if not exists(select 1 from public.map_network_connections where id=remaining) then raise exception 'Unrelated pair was removed'; end if;
  if (select count(*) from public.map_features where id in (a,b,c)) <> 3 then raise exception 'An asset was deleted'; end if;
  if not exists(select 1 from public.map_features where id=a and extensions.st_equals(geometry,extensions.st_geomfromtext('LINESTRING(-1 0,1 0)',4326))) then raise exception 'Line geometry changed'; end if;
  perform public.maps_connect_crossing(org,a,b,0,0);
end;
$$;
rollback;
