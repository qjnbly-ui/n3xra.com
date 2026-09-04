alter table public.map_features
  add column if not exists start_endpoint_type text not null default 'unknown',
  add column if not exists end_endpoint_type text not null default 'unknown';

alter table public.map_features
  drop constraint if exists map_features_endpoint_types_check,
  add constraint map_features_endpoint_types_check check (
    start_endpoint_type in ('unknown', 'source', 'reservoir', 'dead_end')
    and end_endpoint_type in ('unknown', 'source', 'reservoir', 'dead_end')
    and (
      geometry_type = 'line'
      or (start_endpoint_type = 'unknown' and end_endpoint_type = 'unknown')
    )
  );

create or replace function private.maps_prepare_split_line_endpoints()
returns trigger
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  source_feature_id uuid;
  inherited_end_type text;
begin
  if new.geometry_type <> 'line'
     or not (coalesce(new.properties, '{}'::jsonb) ? 'splitFromFeatureId') then
    return new;
  end if;

  begin
    source_feature_id := (new.properties ->> 'splitFromFeatureId')::uuid;
  exception when invalid_text_representation then
    raise exception 'The split source feature ID is invalid.' using errcode = '22023';
  end;

  select feature.end_endpoint_type into inherited_end_type
  from public.map_features feature
  where feature.organization_id = new.organization_id
    and feature.id = source_feature_id
    and feature.geometry_type = 'line'
  for update;

  if inherited_end_type is not null then
    new.start_endpoint_type := 'unknown';
    new.end_endpoint_type := inherited_end_type;

    update public.map_features
    set end_endpoint_type = 'unknown'
    where organization_id = new.organization_id
      and id = source_feature_id;
  end if;

  return new;
end;
$$;

drop trigger if exists maps_prepare_split_line_endpoints_trigger on public.map_features;
create trigger maps_prepare_split_line_endpoints_trigger
before insert on public.map_features
for each row execute function private.maps_prepare_split_line_endpoints();

create or replace function private.maps_set_incident_valve_status(
  input_organization_id uuid,
  input_incident_id uuid,
  input_valve_feature_id uuid,
  input_status text,
  input_note text default null,
  input_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  action_id uuid;
  incident_row public.map_incidents%rowtype;
  valve_title text;
  action_note text;
  occurred_at_value timestamptz := coalesce(input_occurred_at, now());
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_status not in ('recommended', 'en_route', 'found', 'closed', 'inaccessible', 'inoperable', 'reopened') then
    raise exception 'Choose a valid valve status.' using errcode = '22023';
  end if;

  select incident.* into incident_row
  from public.map_incidents incident
  where incident.organization_id = input_organization_id
    and incident.id = input_incident_id
  for update;
  if incident_row.id is null or incident_row.status = 'resolved' then
    raise exception 'Choose an active incident.' using errcode = '22023';
  end if;
  if not private.is_maps_isolation_valve(input_organization_id, input_valve_feature_id) then
    raise exception 'Choose a connected network valve.' using errcode = '22023';
  end if;
  if occurred_at_value < incident_row.started_at then
    raise exception 'The valve action cannot occur before the incident started.' using errcode = '22023';
  end if;

  select feature.title into valve_title
  from public.map_features feature
  where feature.organization_id = input_organization_id
    and feature.id = input_valve_feature_id
    and feature.archived_at is null;
  if valve_title is null then
    raise exception 'Valve not found.' using errcode = 'P0002';
  end if;

  action_note := coalesce(
    nullif(pg_catalog.btrim(input_note), ''),
    case input_status
      when 'recommended' then valve_title || ' added to the isolation plan.'
      when 'en_route' then 'Crew is traveling to ' || valve_title || '.'
      when 'found' then valve_title || ' was located in the field.'
      when 'closed' then valve_title || ' was closed.'
      when 'inaccessible' then valve_title || ' could not be accessed.'
      when 'inoperable' then valve_title || ' could not be operated.'
      when 'reopened' then valve_title || ' was reopened.'
    end
  );

  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'save', true);
  perform pg_catalog.set_config('n3xra.maps_incident_action', 'update', true);
  insert into public.map_incident_valve_actions (
    organization_id, incident_id, valve_feature_id, status, note, occurred_at
  ) values (
    input_organization_id, input_incident_id, input_valve_feature_id, input_status,
    nullif(pg_catalog.btrim(input_note), ''), occurred_at_value
  ) returning id into action_id;

  insert into public.map_incident_updates (
    organization_id, incident_id, update_type, status_after, note, details, occurred_at
  ) values (
    input_organization_id, input_incident_id, 'isolation', incident_row.status,
    action_note,
    pg_catalog.jsonb_build_object(
      'recordType', 'valve_action',
      'valveFeatureId', input_valve_feature_id,
      'valveTitle', valve_title,
      'valveStatus', input_status,
      'valveActionId', action_id
    ),
    occurred_at_value
  );
  return action_id;
end;
$$;

create or replace function public.maps_confirm_incident_isolation(
  input_organization_id uuid,
  input_incident_id uuid,
  input_water_stopped boolean,
  input_pressure_reading numeric,
  input_pressure_unit text,
  input_longitude double precision,
  input_latitude double precision,
  input_accuracy_m double precision,
  input_note text,
  input_occurred_at timestamptz default now()
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  incident_row public.map_incidents%rowtype;
  plan_row public.map_incident_isolation_plans%rowtype;
  confirmation_id uuid;
  occurred_at_value timestamptz := coalesce(input_occurred_at, now());
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if not coalesce(input_water_stopped, false) then
    raise exception 'Confirm that water has stopped before recording isolation.' using errcode = '22023';
  end if;
  if nullif(pg_catalog.btrim(input_note), '') is null then
    raise exception 'Field confirmation notes are required.' using errcode = '22023';
  end if;
  if input_pressure_reading is not null and input_pressure_reading < 0 then
    raise exception 'Pressure cannot be negative.' using errcode = '22023';
  end if;
  if input_pressure_reading is not null and input_pressure_unit not in ('psi', 'kpa', 'bar') then
    raise exception 'Choose a pressure unit.' using errcode = '22023';
  end if;
  if input_pressure_reading is null and input_pressure_unit is not null then
    raise exception 'Enter a pressure reading before choosing a unit.' using errcode = '22023';
  end if;
  if (input_longitude is null) <> (input_latitude is null) then
    raise exception 'Provide both longitude and latitude.' using errcode = '22023';
  end if;
  if input_longitude is not null and (input_longitude not between -180 and 180 or input_latitude not between -90 and 90) then
    raise exception 'The field location is invalid.' using errcode = '22023';
  end if;
  if input_accuracy_m is not null and input_accuracy_m < 0 then
    raise exception 'Location accuracy cannot be negative.' using errcode = '22023';
  end if;

  select incident.* into incident_row
  from public.map_incidents incident
  where incident.organization_id = input_organization_id
    and incident.id = input_incident_id
  for update;
  if incident_row.id is null or incident_row.status = 'resolved' then
    raise exception 'Choose an active incident.' using errcode = '22023';
  end if;
  if occurred_at_value < incident_row.started_at then
    raise exception 'The confirmation cannot occur before the incident started.' using errcode = '22023';
  end if;

  select plan.* into plan_row
  from public.map_incident_isolation_plans plan
  where plan.organization_id = input_organization_id
    and plan.incident_id = input_incident_id;
  if plan_row.id is null or not plan_row.topology_complete or pg_catalog.cardinality(plan_row.recommended_valve_ids) = 0 then
    raise exception 'Complete the mapped isolation boundary before confirming isolation.' using errcode = '22023';
  end if;
  if exists (
    select 1
    from pg_catalog.unnest(plan_row.recommended_valve_ids) valve_id
    left join lateral (
      select action.status
      from public.map_incident_valve_actions action
      where action.organization_id = input_organization_id
        and action.incident_id = input_incident_id
        and action.valve_feature_id = valve_id
      order by action.occurred_at desc, action.submitted_at desc
      limit 1
    ) latest on true
    where latest.status is distinct from 'closed'
  ) then
    raise exception 'Every required valve must be closed before confirming isolation.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('n3xra.maps_incident_action', 'update', true);
  insert into public.map_incident_updates (
    organization_id, incident_id, update_type, status_after, note, details, occurred_at
  ) values (
    input_organization_id, input_incident_id, 'isolation', incident_row.status,
    pg_catalog.btrim(input_note),
    pg_catalog.jsonb_build_object(
      'recordType', 'isolation_confirmation',
      'isolationConfirmed', true,
      'waterStopped', true,
      'pressureReading', input_pressure_reading,
      'pressureUnit', input_pressure_unit,
      'longitude', input_longitude,
      'latitude', input_latitude,
      'accuracyMeters', input_accuracy_m,
      'planCalculatedAt', plan_row.calculated_at,
      'requiredValveIds', plan_row.recommended_valve_ids,
      'affectedMeterCount', plan_row.affected_meter_count,
      'affectedCustomerCount', plan_row.affected_customer_count
    ),
    occurred_at_value
  ) returning id into confirmation_id;
  return confirmation_id;
end;
$$;

revoke all on function private.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function public.maps_confirm_incident_isolation(uuid, uuid, boolean, numeric, text, double precision, double precision, double precision, text, timestamptz) from public, anon;
grant execute on function private.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.maps_confirm_incident_isolation(uuid, uuid, boolean, numeric, text, double precision, double precision, double precision, text, timestamptz) to authenticated;
