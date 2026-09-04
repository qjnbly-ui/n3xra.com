create table public.map_incident_valve_actions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid not null,
  valve_feature_id uuid not null,
  status text not null,
  note text,
  occurred_at timestamptz not null default now(),
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  submitted_at timestamptz not null default now(),
  constraint map_incident_valve_actions_incident_fkey
    foreign key (organization_id, incident_id)
    references public.map_incidents (organization_id, id)
    on delete cascade,
  constraint map_incident_valve_actions_valve_fkey
    foreign key (organization_id, valve_feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_incident_valve_actions_status_check check (status in (
    'recommended', 'en_route', 'found', 'closed', 'inaccessible', 'inoperable', 'reopened'
  )),
  constraint map_incident_valve_actions_note_check check (note is null or char_length(note) <= 2000)
);

create index map_incident_valve_actions_incident_idx
  on public.map_incident_valve_actions (organization_id, incident_id, occurred_at desc, submitted_at desc);
create index map_incident_valve_actions_valve_idx
  on public.map_incident_valve_actions (organization_id, valve_feature_id, occurred_at desc);
create index map_incident_valve_actions_created_by_idx
  on public.map_incident_valve_actions (created_by_user_id);

create table public.map_incident_isolation_plans (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  incident_id uuid not null,
  recommended_valve_ids uuid[] not null default '{}',
  isolated_feature_ids uuid[] not null default '{}',
  affected_meter_ids uuid[] not null default '{}',
  customer_references text[] not null default '{}',
  affected_meter_count integer not null default 0,
  affected_customer_count integer not null default 0,
  topology_complete boolean not null default false,
  warnings text[] not null default '{}',
  calculated_at timestamptz not null default now(),
  calculated_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_incident_isolation_plans_incident_fkey
    foreign key (organization_id, incident_id)
    references public.map_incidents (organization_id, id)
    on delete cascade,
  constraint map_incident_isolation_plans_incident_unique unique (organization_id, incident_id),
  constraint map_incident_isolation_plans_counts_check check (
    affected_meter_count >= 0 and affected_customer_count >= 0
  )
);

create index map_incident_isolation_plans_calculated_by_idx
  on public.map_incident_isolation_plans (calculated_by_user_id);

alter table public.map_incident_valve_actions enable row level security;
alter table public.map_incident_isolation_plans enable row level security;

revoke all on public.map_incident_valve_actions from public, anon, authenticated;
revoke all on public.map_incident_isolation_plans from public, anon, authenticated;
grant select on public.map_incident_valve_actions to authenticated;
grant select on public.map_incident_isolation_plans to authenticated;
grant all on public.map_incident_valve_actions to service_role;
grant all on public.map_incident_isolation_plans to service_role;

create policy "map_incident_valve_actions_select"
on public.map_incident_valve_actions for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_incident_isolation_plans_select"
on public.map_incident_isolation_plans for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create or replace function private.guard_map_incident_isolation_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  action_name text := coalesce(pg_catalog.current_setting('n3xra.maps_isolation_action', true), '');
  incident_status text;
begin
  if action_name <> 'save' then
    raise exception 'Use the protected isolation actions.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Isolation records are part of the incident history.' using errcode = '55000';
  end if;

  select incident.status into incident_status
  from public.map_incidents incident
  where incident.organization_id = new.organization_id
    and incident.id = new.incident_id;

  if incident_status is null then
    raise exception 'Incident not found.' using errcode = 'P0002';
  end if;
  if incident_status = 'resolved' then
    raise exception 'Resolved incident isolation records are permanent.' using errcode = '55000';
  end if;

  if tg_table_name = 'map_incident_valve_actions' then
    if tg_op <> 'INSERT' then
      raise exception 'Valve actions are permanent and cannot be edited.' using errcode = '55000';
    end if;
    new.created_by_user_id := (select auth.uid());
    new.submitted_at := now();
  else
    new.calculated_by_user_id := (select auth.uid());
    new.calculated_at := now();
  end if;
  return new;
end;
$$;

create trigger map_incident_valve_actions_guard_write
before insert or update or delete on public.map_incident_valve_actions
for each row execute function private.guard_map_incident_isolation_write();

create trigger map_incident_isolation_plans_guard_write
before insert or update or delete on public.map_incident_isolation_plans
for each row execute function private.guard_map_incident_isolation_write();

create trigger map_incident_isolation_plans_set_updated_at
before update on public.map_incident_isolation_plans
for each row execute function public.set_updated_at();

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
  if not exists (
    select 1
    from public.map_incidents incident
    join public.map_network_devices device
      on device.organization_id = incident.organization_id
     and device.device_feature_id = input_valve_feature_id
    where incident.organization_id = input_organization_id
      and incident.id = input_incident_id
      and incident.status <> 'resolved'
  ) then
    raise exception 'Choose an active incident and connected network valve.' using errcode = '22023';
  end if;

  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'save', true);
  insert into public.map_incident_valve_actions (
    organization_id, incident_id, valve_feature_id, status, note, occurred_at
  ) values (
    input_organization_id, input_incident_id, input_valve_feature_id, input_status,
    nullif(pg_catalog.btrim(input_note), ''), coalesce(input_occurred_at, now())
  ) returning id into action_id;
  return action_id;
end;
$$;

create or replace function public.maps_set_incident_valve_status(
  input_organization_id uuid,
  input_incident_id uuid,
  input_valve_feature_id uuid,
  input_status text,
  input_note text default null,
  input_occurred_at timestamptz default now()
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maps_set_incident_valve_status(
    input_organization_id, input_incident_id, input_valve_feature_id,
    input_status, input_note, input_occurred_at
  );
$$;

create or replace function private.maps_save_incident_isolation_plan(
  input_organization_id uuid,
  input_incident_id uuid,
  input_recommended_valve_ids uuid[],
  input_isolated_feature_ids uuid[],
  input_affected_meter_ids uuid[],
  input_customer_references text[],
  input_topology_complete boolean,
  input_warnings text[]
)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  plan_id uuid;
  affected_customer_count integer;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.map_incidents incident
    where incident.organization_id = input_organization_id
      and incident.id = input_incident_id
      and incident.status <> 'resolved'
  ) then
    raise exception 'Choose an active incident.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(coalesce(input_recommended_valve_ids, '{}')) valve_id
    where not exists (
      select 1 from public.map_network_devices device
      where device.organization_id = input_organization_id
        and device.device_feature_id = valve_id
    )
  ) then
    raise exception 'The plan contains an invalid network valve.' using errcode = '22023';
  end if;
  if exists (
    select 1 from pg_catalog.unnest(
      coalesce(input_isolated_feature_ids, '{}') || coalesce(input_affected_meter_ids, '{}')
    ) feature_id
    where not exists (
      select 1 from public.map_features feature
      where feature.organization_id = input_organization_id
        and feature.id = feature_id
        and feature.archived_at is null
    )
  ) then
    raise exception 'The plan contains an invalid mapped item.' using errcode = '22023';
  end if;

  select count(distinct reference_value)::integer into affected_customer_count
  from pg_catalog.unnest(coalesce(input_customer_references, '{}')) reference_value
  where nullif(pg_catalog.btrim(reference_value), '') is not null;

  perform pg_catalog.set_config('n3xra.maps_isolation_action', 'save', true);
  insert into public.map_incident_isolation_plans (
    organization_id, incident_id, recommended_valve_ids, isolated_feature_ids,
    affected_meter_ids, customer_references, affected_meter_count,
    affected_customer_count, topology_complete, warnings
  ) values (
    input_organization_id, input_incident_id,
    coalesce(input_recommended_valve_ids, '{}'), coalesce(input_isolated_feature_ids, '{}'),
    coalesce(input_affected_meter_ids, '{}'), coalesce(input_customer_references, '{}'),
    pg_catalog.cardinality(coalesce(input_affected_meter_ids, '{}')), affected_customer_count,
    coalesce(input_topology_complete, false), coalesce(input_warnings, '{}')
  )
  on conflict (organization_id, incident_id) do update set
    recommended_valve_ids = excluded.recommended_valve_ids,
    isolated_feature_ids = excluded.isolated_feature_ids,
    affected_meter_ids = excluded.affected_meter_ids,
    customer_references = excluded.customer_references,
    affected_meter_count = excluded.affected_meter_count,
    affected_customer_count = excluded.affected_customer_count,
    topology_complete = excluded.topology_complete,
    warnings = excluded.warnings
  returning id into plan_id;
  return plan_id;
end;
$$;

create or replace function public.maps_save_incident_isolation_plan(
  input_organization_id uuid,
  input_incident_id uuid,
  input_recommended_valve_ids uuid[],
  input_isolated_feature_ids uuid[],
  input_affected_meter_ids uuid[],
  input_customer_references text[],
  input_topology_complete boolean,
  input_warnings text[]
)
returns uuid
language sql
volatile
security invoker
set search_path = ''
as $$
  select private.maps_save_incident_isolation_plan(
    input_organization_id, input_incident_id, input_recommended_valve_ids,
    input_isolated_feature_ids, input_affected_meter_ids, input_customer_references,
    input_topology_complete, input_warnings
  );
$$;

revoke all on function private.guard_map_incident_isolation_write() from public, anon, authenticated;
revoke all on function private.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function public.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) from public, anon;
revoke all on function private.maps_save_incident_isolation_plan(uuid, uuid, uuid[], uuid[], uuid[], text[], boolean, text[]) from public, anon;
revoke all on function public.maps_save_incident_isolation_plan(uuid, uuid, uuid[], uuid[], uuid[], text[], boolean, text[]) from public, anon;
grant execute on function private.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function public.maps_set_incident_valve_status(uuid, uuid, uuid, text, text, timestamptz) to authenticated;
grant execute on function private.maps_save_incident_isolation_plan(uuid, uuid, uuid[], uuid[], uuid[], text[], boolean, text[]) to authenticated;
grant execute on function public.maps_save_incident_isolation_plan(uuid, uuid, uuid[], uuid[], uuid[], text[], boolean, text[]) to authenticated;
