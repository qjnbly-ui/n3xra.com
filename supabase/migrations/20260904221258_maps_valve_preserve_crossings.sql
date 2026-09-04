-- Keep the existing atomic valve insertion, permissions and shape workflow.
-- Preserve explicit junctions when their section becomes the new continuation.
do $migration$
declare definition text;
begin
  definition := pg_get_functiondef('private.maps_insert_valve_on_line(uuid,uuid,uuid,double precision,double precision,text,text,text)'::regprocedure);
  if position('  next_reference text;' in definition)=0 or position('  line_a_geometry :=' in definition)=0
    or position('  ) returning id into line_b_id;' in definition)=0 then
    raise exception 'Unexpected valve insertion definition; review before applying';
  end if;
  definition := replace(definition,'  next_reference text;', '  next_reference text;
  saved_crossings public.map_network_connections[];
  crossing public.map_network_connections;
  replacement_id uuid;
  left_id uuid;
  right_id uuid;
  target_geometry extensions.geometry;');
  -- NULL roles must fail closed, matching the newer junction RPCs.
  definition := replace(definition,
    'public.organization_product_role(input_organization_id, ''maps'') not in (''account_admin'', ''editor'')',
    'not coalesce(public.organization_product_role(input_organization_id, ''maps'') in (''account_admin'', ''editor''), false)');
  definition := replace(definition,'  line_a_geometry :=', $guard$
  if exists (
    select 1 from public.map_network_connections c where c.organization_id=input_organization_id
      and (c.feature_id=line_row.id or c.connected_feature_id=line_row.id)
      and extensions.st_dwithin(c.geometry::extensions.geography,split_point::extensions.geography,0.15)
  ) then
    raise exception 'Choose the pipe branch and place the valve at its actual position, at least 6 inches away from the junction.' using errcode='22023';
  end if;
  select array_agg(c) into saved_crossings from public.map_network_connections c
    where c.organization_id=input_organization_id and c.endpoint like 'junction:%'
      and (c.feature_id=line_row.id or c.connected_feature_id=line_row.id);
  delete from public.map_network_connections c where c.organization_id=input_organization_id
    and c.endpoint like 'junction:%' and (c.feature_id=line_row.id or c.connected_feature_id=line_row.id);

  line_a_geometry :=$guard$);
  definition := replace(definition,'  ) returning id into line_b_id;', $restore$
  ) returning id into line_b_id;

  foreach crossing in array coalesce(saved_crossings,'{}'::public.map_network_connections[]) loop
    replacement_id := case when extensions.st_linelocatepoint(line_row.geometry,crossing.geometry)>split_fraction
      then line_b_id else line_row.id end;
    left_id := case when crossing.feature_id=line_row.id then replacement_id else crossing.feature_id end;
    right_id := case when crossing.connected_feature_id=line_row.id then replacement_id else crossing.connected_feature_id end;
    crossing.feature_id := least(left_id,right_id);
    crossing.connected_feature_id := greatest(left_id,right_id);
    select geometry into target_geometry from public.map_features
      where organization_id=input_organization_id and id=crossing.connected_feature_id;
    insert into public.map_network_connections(id,organization_id,feature_id,endpoint,connected_feature_id,
      geometry,connected_fraction,snap_distance_m,created_by_user_id,created_at)
    values(crossing.id,input_organization_id,crossing.feature_id,
      'junction:' || md5(crossing.connected_feature_id::text || extensions.st_astext(extensions.st_snaptogrid(crossing.geometry,0.00000001))),
      crossing.connected_feature_id,crossing.geometry,extensions.st_linelocatepoint(target_geometry,crossing.geometry),
      crossing.snap_distance_m,crossing.created_by_user_id,crossing.created_at);
  end loop;
$restore$);
  execute definition;
end;
$migration$;
