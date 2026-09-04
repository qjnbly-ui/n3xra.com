-- Disposable/local database only. Supply n3xra.test_org, n3xra.test_layer
-- (editable water line), n3xra.test_valve_layer, and n3xra.test_editor.
-- This checks both sides of a junction and rolls back all fixtures and DDL.
\set ON_ERROR_STOP on
begin;
\ir ../../supabase/migrations/20260904214226_maps_valve_preserve_crossings.sql
do $$
declare
  org uuid := current_setting('n3xra.test_org')::uuid;
  layer uuid := current_setting('n3xra.test_layer')::uuid;
  valve_layer uuid := current_setting('n3xra.test_valve_layer')::uuid;
  a uuid; b uuid; j uuid; result jsonb; suffix uuid; expected uuid; offset_x double precision;
begin
  perform set_config('request.jwt.claim.sub',current_setting('n3xra.test_editor'),true);
  foreach offset_x in array array[-0.0005,0.0005] loop
    insert into public.map_features(organization_id,layer_id,title,geometry_type,geometry)
      values(org,layer,'Valve branch fixture A','line',extensions.st_geomfromtext('LINESTRING(-.001 0,.001 0)',4326)) returning id into a;
    insert into public.map_features(organization_id,layer_id,title,geometry_type,geometry)
      values(org,layer,'Valve branch fixture B','line',extensions.st_geomfromtext('LINESTRING(0 -.001,0 .001)',4326)) returning id into b;
    j := public.maps_connect_crossing(org,a,b,0,0);
    begin
      perform public.maps_insert_valve_on_line(org,a,valve_layer,0,0,'Ambiguous fixture');
      raise exception 'Valve incorrectly inserted at junction';
    exception when invalid_parameter_value then null; end;
    result := public.maps_insert_valve_on_line(org,a,valve_layer,offset_x,0,'Branch valve fixture');
    suffix := (result->>'lineBFeatureId')::uuid;
    expected := case when offset_x < 0 then suffix else a end;
    if not exists(select 1 from public.map_network_connections where id=j
      and ((feature_id=expected and connected_feature_id=b) or (feature_id=b and connected_feature_id=expected))) then
      raise exception 'Junction did not follow its correct pipe segment';
    end if;
    if not exists(select 1 from public.map_features where id=b and extensions.st_equals(geometry,extensions.st_geomfromtext('LINESTRING(0 -.001,0 .001)',4326))) then
      raise exception 'Other branch geometry changed';
    end if;
    -- Remove only disposable fixture lines inside this rollback transaction,
    -- preventing automatic endpoint matches with the next case.
    update public.map_features set archived_at=now() where id in(a,b,suffix);
  end loop;
end;
$$;
rollback;
