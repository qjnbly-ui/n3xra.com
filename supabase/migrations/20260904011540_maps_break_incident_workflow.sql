create table public.map_incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  incident_number integer not null,
  incident_type text not null default 'water_main_break',
  feature_id uuid not null,
  reported_geometry extensions.geometry(Point, 4326) not null,
  geometry extensions.geometry(Point, 4326) not null,
  snap_distance_m numeric(10, 3) not null default 0,
  status text not null default 'open',
  severity text not null default 'urgent',
  title text not null,
  initial_report text,
  cause text,
  customers_affected_estimate integer,
  repair_method text,
  pressure_lost boolean not null default false,
  disinfected boolean not null default false,
  sample_collected boolean not null default false,
  chlorine_residual text,
  sample_result text,
  customer_reference text,
  request_reference text,
  future_isolation_valve_ids uuid[] not null default '{}'::uuid[],
  future_affected_customer_account_ids uuid[] not null default '{}'::uuid[],
  future_notification_batch_id uuid,
  started_at timestamptz not null,
  resolved_at timestamptz,
  closed_event_id uuid,
  created_by_user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  resolved_by_user_id uuid references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_incidents_organization_id_id_unique unique (organization_id, id),
  constraint map_incidents_organization_number_unique unique (organization_id, incident_number),
  constraint map_incidents_feature_organization_fkey
    foreign key (organization_id, feature_id)
    references public.map_features (organization_id, id)
    on delete restrict,
  constraint map_incidents_closed_event_organization_fkey
    foreign key (organization_id, closed_event_id)
    references public.map_events (organization_id, id)
    on delete restrict,
  constraint map_incidents_number_check check (incident_number > 0),
  constraint map_incidents_type_check check (incident_type = 'water_main_break'),
  constraint map_incidents_status_check check (status in ('open', 'responding', 'repairing', 'monitoring', 'resolved')),
  constraint map_incidents_severity_check check (severity in ('attention', 'urgent', 'emergency')),
  constraint map_incidents_title_check check (char_length(btrim(title)) between 1 and 180),
  constraint map_incidents_initial_report_check check (initial_report is null or char_length(initial_report) <= 8000),
  constraint map_incidents_cause_check check (cause is null or char_length(cause) <= 1000),
  constraint map_incidents_customers_check check (customers_affected_estimate is null or customers_affected_estimate >= 0),
  constraint map_incidents_repair_method_check check (repair_method is null or char_length(repair_method) <= 2000),
  constraint map_incidents_customer_reference_check check (customer_reference is null or char_length(customer_reference) <= 160),
  constraint map_incidents_request_reference_check check (request_reference is null or char_length(request_reference) <= 160),
  constraint map_incidents_snap_distance_check check (snap_distance_m >= 0),
  constraint map_incidents_resolution_check check (
    (status = 'resolved' and resolved_at is not null and resolved_by_user_id is not null and closed_event_id is not null)
    or
    (status <> 'resolved' and resolved_at is null and resolved_by_user_id is null and closed_event_id is null)
  )
);

create table public.map_incident_updates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  incident_id uuid not null,
  update_type text not null default 'field_update',
  status_after text,
  note text not null,
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_by_user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  submitted_at timestamptz not null default now(),
  constraint map_incident_updates_incident_organization_fkey
    foreign key (organization_id, incident_id)
    references public.map_incidents (organization_id, id)
    on delete restrict,
  constraint map_incident_updates_type_check check (update_type in (
    'reported', 'crew_dispatched', 'isolation', 'repair_started', 'field_update',
    'pressure_restored', 'disinfection', 'sample_collected', 'sample_result',
    'customer_notice', 'monitoring', 'resolved'
  )),
  constraint map_incident_updates_status_check check (status_after is null or status_after in ('open', 'responding', 'repairing', 'monitoring', 'resolved')),
  constraint map_incident_updates_note_check check (char_length(btrim(note)) between 1 and 8000),
  constraint map_incident_updates_details_check check (jsonb_typeof(details) = 'object')
);

create index map_incidents_active_idx
on public.map_incidents (organization_id, severity, started_at desc)
where status <> 'resolved';

create index map_incidents_feature_idx
on public.map_incidents (organization_id, feature_id, started_at desc);

create index map_incidents_geometry_gist_idx
on public.map_incidents using gist (geometry);

create index map_incident_updates_timeline_idx
on public.map_incident_updates (organization_id, incident_id, occurred_at, submitted_at);

create or replace function private.guard_map_incident_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
begin
  if tg_op = 'DELETE' then
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
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_incident_action', true), '');
begin
  if tg_op <> 'INSERT' then
    raise exception 'Incident updates are permanent and cannot be edited or deleted.' using errcode = '55000';
  end if;
  if action_name not in ('start', 'update', 'close') then
    raise exception 'Use the protected incident actions.' using errcode = '42501';
  end if;

  select incident.status into incident_status
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

create trigger map_incidents_guard_write
before insert or update or delete on public.map_incidents
for each row execute function private.guard_map_incident_write();

create trigger map_incidents_set_updated_at
before update on public.map_incidents
for each row execute function public.set_updated_at();

create trigger map_incident_updates_prepare
before insert or update or delete on public.map_incident_updates
for each row execute function private.prepare_map_incident_update();

create or replace function public.maps_start_break_incident(
  input_organization_id uuid,
  input_feature_id uuid,
  input_longitude double precision,
  input_latitude double precision,
  input_title text,
  input_initial_report text default null,
  input_severity text default 'urgent',
  input_started_at timestamptz default now(),
  input_customers_affected_estimate integer default null,
  input_customer_reference text default null,
  input_request_reference text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  feature_row public.map_features%rowtype;
  reported_point extensions.geometry(Point, 4326);
  snapped_point extensions.geometry(Point, 4326);
  snap_distance numeric;
  next_number integer;
  created_incident public.map_incidents%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_longitude < -180 or input_longitude > 180 or input_latitude < -90 or input_latitude > 90 then
    raise exception 'The incident location is invalid.' using errcode = '22023';
  end if;
  if input_severity not in ('attention', 'urgent', 'emergency') then
    raise exception 'The incident severity is invalid.' using errcode = '22023';
  end if;

  select feature.* into feature_row
  from public.map_features feature
  where feature.organization_id = input_organization_id
    and feature.id = input_feature_id
    and feature.archived_at is null
  for share;

  if feature_row.id is null or feature_row.geometry_type <> 'line' or extensions.geometrytype(feature_row.geometry) <> 'LINESTRING' then
    raise exception 'Select an active water-line feature before starting a break incident.' using errcode = '22023';
  end if;

  reported_point := extensions.st_setsrid(extensions.st_makepoint(input_longitude, input_latitude), 4326);
  snapped_point := extensions.st_closestpoint(feature_row.geometry, reported_point);
  snap_distance := extensions.st_distance(reported_point::extensions.geography, snapped_point::extensions.geography);

  if snap_distance > 100 then
    raise exception 'Place the incident within 328 feet of the selected line.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_organization_id::text || ':map-incidents', 0));
  select coalesce(max(incident.incident_number), 0) + 1 into next_number
  from public.map_incidents incident
  where incident.organization_id = input_organization_id;

  perform pg_catalog.set_config('n3xra.maps_incident_action', 'start', true);

  insert into public.map_incidents (
    organization_id, incident_number, feature_id, reported_geometry, geometry,
    snap_distance_m, severity, title, initial_report, customers_affected_estimate,
    customer_reference, request_reference, started_at
  ) values (
    input_organization_id, next_number, input_feature_id, reported_point, snapped_point,
    snap_distance, input_severity, btrim(input_title), nullif(btrim(input_initial_report), ''),
    input_customers_affected_estimate, nullif(btrim(input_customer_reference), ''),
    nullif(btrim(input_request_reference), ''), input_started_at
  ) returning * into created_incident;

  insert into public.map_incident_updates (
    organization_id, incident_id, update_type, status_after, note, details, occurred_at
  ) values (
    input_organization_id, created_incident.id, 'reported', 'open',
    coalesce(nullif(btrim(input_initial_report), ''), 'Water-main break reported.'),
    jsonb_build_object('severity', input_severity, 'snapDistanceMeters', snap_distance),
    input_started_at
  );

  return jsonb_build_object(
    'incidentId', created_incident.id,
    'incidentNumber', created_incident.incident_number,
    'longitude', extensions.st_x(snapped_point),
    'latitude', extensions.st_y(snapped_point),
    'snapDistanceMeters', snap_distance
  );
end;
$$;

create or replace function public.maps_add_incident_update(
  input_organization_id uuid,
  input_incident_id uuid,
  input_update_type text,
  input_status_after text,
  input_note text,
  input_occurred_at timestamptz default now(),
  input_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  incident_row public.map_incidents%rowtype;
  created_update_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if input_status_after not in ('open', 'responding', 'repairing', 'monitoring') then
    raise exception 'Choose an active incident status.' using errcode = '22023';
  end if;

  select * into incident_row
  from public.map_incidents
  where organization_id = input_organization_id
    and id = input_incident_id
  for update;

  if incident_row.id is null then
    raise exception 'Incident not found.' using errcode = 'P0002';
  end if;
  if incident_row.status = 'resolved' then
    raise exception 'This incident is already resolved.' using errcode = '55000';
  end if;

  perform pg_catalog.set_config('n3xra.maps_incident_action', 'update', true);

  insert into public.map_incident_updates (
    organization_id, incident_id, update_type, status_after, note, details, occurred_at
  ) values (
    input_organization_id, input_incident_id, input_update_type, input_status_after,
    btrim(input_note), coalesce(input_details, '{}'::jsonb), input_occurred_at
  ) returning id into created_update_id;

  update public.map_incidents
  set status = input_status_after
  where organization_id = input_organization_id
    and id = input_incident_id;

  return created_update_id;
end;
$$;

create or replace function public.maps_close_break_incident(
  input_organization_id uuid,
  input_incident_id uuid,
  input_resolved_at timestamptz,
  input_summary text,
  input_cause text default null,
  input_repair_method text default null,
  input_customers_affected_estimate integer default null,
  input_pressure_lost boolean default false,
  input_disinfected boolean default false,
  input_sample_collected boolean default false,
  input_chlorine_residual text default null,
  input_sample_result text default null
)
returns uuid
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  incident_row public.map_incidents%rowtype;
  created_event_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  select * into incident_row
  from public.map_incidents
  where organization_id = input_organization_id
    and id = input_incident_id
  for update;

  if incident_row.id is null then
    raise exception 'Incident not found.' using errcode = 'P0002';
  end if;
  if incident_row.status = 'resolved' then
    raise exception 'This incident is already resolved.' using errcode = '55000';
  end if;
  if input_resolved_at < incident_row.started_at then
    raise exception 'The resolution time cannot be before the incident started.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('n3xra.maps_incident_action', 'close', true);

  insert into public.map_incident_updates (
    organization_id, incident_id, update_type, status_after, note, details, occurred_at
  ) values (
    input_organization_id, input_incident_id, 'resolved', 'resolved', btrim(input_summary),
    jsonb_build_object(
      'cause', nullif(btrim(input_cause), ''),
      'repairMethod', nullif(btrim(input_repair_method), ''),
      'customersAffectedEstimate', input_customers_affected_estimate,
      'pressureLost', input_pressure_lost,
      'disinfected', input_disinfected,
      'sampleCollected', input_sample_collected,
      'chlorineResidual', nullif(btrim(input_chlorine_residual), ''),
      'sampleResult', nullif(btrim(input_sample_result), '')
    ),
    input_resolved_at
  );

  insert into public.map_events (
    organization_id, feature_id, sequence_number, event_type, title, summary,
    severity, compliance_basis, occurred_at, discovered_at, resolved_at, geometry,
    details, customer_reference, request_reference, record_hash
  ) values (
    input_organization_id, incident_row.feature_id, 1, 'water_main_break', incident_row.title,
    btrim(input_summary), incident_row.severity, 'rule', incident_row.started_at,
    incident_row.started_at, input_resolved_at, incident_row.geometry,
    jsonb_build_object(
      'incidentId', incident_row.id,
      'incidentNumber', incident_row.incident_number,
      'cause', nullif(btrim(input_cause), ''),
      'repairMethod', nullif(btrim(input_repair_method), ''),
      'customersAffectedEstimate', input_customers_affected_estimate,
      'pressureLost', input_pressure_lost,
      'disinfected', input_disinfected,
      'sampleCollected', input_sample_collected,
      'chlorineResidual', nullif(btrim(input_chlorine_residual), ''),
      'sampleResult', nullif(btrim(input_sample_result), ''),
      'reportedLongitude', extensions.st_x(incident_row.reported_geometry),
      'reportedLatitude', extensions.st_y(incident_row.reported_geometry),
      'snapDistanceMeters', incident_row.snap_distance_m
    ),
    incident_row.customer_reference, incident_row.request_reference, repeat('0', 64)
  ) returning id into created_event_id;

  update public.map_incidents
  set status = 'resolved',
      cause = nullif(btrim(input_cause), ''),
      repair_method = nullif(btrim(input_repair_method), ''),
      customers_affected_estimate = input_customers_affected_estimate,
      pressure_lost = input_pressure_lost,
      disinfected = input_disinfected,
      sample_collected = input_sample_collected,
      chlorine_residual = nullif(btrim(input_chlorine_residual), ''),
      sample_result = nullif(btrim(input_sample_result), ''),
      resolved_at = input_resolved_at,
      resolved_by_user_id = (select auth.uid()),
      closed_event_id = created_event_id
  where organization_id = input_organization_id
    and id = input_incident_id;

  return created_event_id;
end;
$$;

alter table public.map_incidents enable row level security;
alter table public.map_incident_updates enable row level security;

revoke all on public.map_incidents from public, anon, authenticated;
revoke all on public.map_incident_updates from public, anon, authenticated;
grant select, insert, update on public.map_incidents to authenticated;
grant select, insert on public.map_incident_updates to authenticated;
grant select, insert, update on public.map_incidents to service_role;
grant select, insert on public.map_incident_updates to service_role;

create policy "map_incidents_select"
on public.map_incidents for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_incidents_insert"
on public.map_incidents for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_incidents_update"
on public.map_incidents for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_incident_updates_select"
on public.map_incident_updates for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_incident_updates_insert"
on public.map_incident_updates for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

revoke all on function private.guard_map_incident_write() from public, anon, authenticated;
revoke all on function private.prepare_map_incident_update() from public, anon, authenticated;
revoke all on function public.maps_start_break_incident(uuid, uuid, double precision, double precision, text, text, text, timestamptz, integer, text, text) from public, anon;
revoke all on function public.maps_add_incident_update(uuid, uuid, text, text, text, timestamptz, jsonb) from public, anon;
revoke all on function public.maps_close_break_incident(uuid, uuid, timestamptz, text, text, text, integer, boolean, boolean, boolean, text, text) from public, anon;
grant execute on function public.maps_start_break_incident(uuid, uuid, double precision, double precision, text, text, text, timestamptz, integer, text, text) to authenticated;
grant execute on function public.maps_add_incident_update(uuid, uuid, text, text, text, timestamptz, jsonb) to authenticated;
grant execute on function public.maps_close_break_incident(uuid, uuid, timestamptz, text, text, text, integer, boolean, boolean, boolean, text, text) to authenticated;
