create table public.map_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  feature_id uuid,
  sequence_number integer not null,
  event_type text not null,
  title text not null,
  summary text,
  severity text not null default 'routine',
  compliance_basis text not null default 'operational',
  occurred_at timestamptz not null,
  discovered_at timestamptz,
  resolved_at timestamptz,
  geometry extensions.geometry(Geometry, 4326),
  asset_geometry_snapshot extensions.geometry(Geometry, 4326),
  details jsonb not null default '{}'::jsonb,
  future_customer_account_id uuid,
  future_customer_request_id uuid,
  customer_reference text,
  request_reference text,
  amends_event_id uuid,
  amendment_kind text,
  amendment_reason text,
  previous_hash text,
  record_hash text not null,
  created_by_user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  submitted_at timestamptz not null default now(),
  constraint map_events_organization_id_id_unique unique (organization_id, id),
  constraint map_events_feature_organization_fkey
    foreign key (organization_id, feature_id)
    references public.map_features (organization_id, id)
    on delete restrict,
  constraint map_events_amends_fkey
    foreign key (amends_event_id)
    references public.map_events (id)
    on delete restrict,
  constraint map_events_organization_sequence_unique unique (organization_id, sequence_number),
  constraint map_events_record_hash_unique unique (record_hash),
  constraint map_events_sequence_check check (sequence_number > 0),
  constraint map_events_type_check check (event_type in (
    'water_main_break', 'sewer_overflow', 'blockage', 'valve_inspection',
    'hydrant_inspection', 'backflow_test', 'pressure_event', 'sample',
    'inspection', 'maintenance', 'repair', 'replacement', 'task_completed',
    'customer_request', 'correction', 'void'
  )),
  constraint map_events_title_check check (char_length(trim(title)) between 1 and 180),
  constraint map_events_summary_check check (summary is null or char_length(summary) <= 8000),
  constraint map_events_severity_check check (severity in ('routine', 'attention', 'urgent', 'emergency')),
  constraint map_events_compliance_basis_check check (compliance_basis in ('operational', 'recommended', 'organization_policy', 'rule', 'permit')),
  constraint map_events_details_check check (jsonb_typeof(details) = 'object'),
  constraint map_events_customer_reference_check check (customer_reference is null or char_length(customer_reference) <= 160),
  constraint map_events_request_reference_check check (request_reference is null or char_length(request_reference) <= 160),
  constraint map_events_hash_check check (record_hash ~ '^[0-9a-f]{64}$'),
  constraint map_events_previous_hash_check check (previous_hash is null or previous_hash ~ '^[0-9a-f]{64}$'),
  constraint map_events_amendment_check check (
    (amends_event_id is null and amendment_kind is null and amendment_reason is null)
    or
    (amends_event_id is not null and amendment_kind in ('correction', 'void') and char_length(trim(amendment_reason)) between 1 and 1000)
  )
);

create table public.map_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_id uuid,
  source_event_id uuid,
  title text not null,
  category text not null default 'maintenance',
  description text,
  priority text not null default 'normal',
  status text not null default 'open',
  compliance_basis text not null default 'operational',
  compliance_source_name text,
  compliance_source_url text,
  due_at timestamptz,
  assigned_to_user_id uuid references auth.users (id) on delete set null,
  future_customer_account_id uuid,
  future_customer_request_id uuid,
  customer_reference text,
  request_reference text,
  completed_at timestamptz,
  completed_by_user_id uuid references auth.users (id) on delete set null,
  completion_event_id uuid,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint map_tasks_feature_organization_fkey
    foreign key (organization_id, feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_tasks_source_event_organization_fkey
    foreign key (organization_id, source_event_id)
    references public.map_events (organization_id, id)
    on delete set null (source_event_id),
  constraint map_tasks_completion_event_organization_fkey
    foreign key (organization_id, completion_event_id)
    references public.map_events (organization_id, id)
    on delete set null (completion_event_id),
  constraint map_tasks_title_check check (char_length(trim(title)) between 1 and 180),
  constraint map_tasks_description_check check (description is null or char_length(description) <= 8000),
  constraint map_tasks_category_check check (category in ('inspection', 'maintenance', 'repair', 'testing', 'sampling', 'reporting', 'customer_request', 'follow_up')),
  constraint map_tasks_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint map_tasks_status_check check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  constraint map_tasks_compliance_basis_check check (compliance_basis in ('operational', 'recommended', 'organization_policy', 'rule', 'permit')),
  constraint map_tasks_completion_check check (
    (status = 'completed' and completed_at is not null and completion_event_id is not null)
    or
    (status <> 'completed' and completed_at is null and completion_event_id is null)
  ),
  constraint map_tasks_customer_reference_check check (customer_reference is null or char_length(customer_reference) <= 160),
  constraint map_tasks_request_reference_check check (request_reference is null or char_length(request_reference) <= 160)
);

create index map_events_feature_timeline_idx on public.map_events (organization_id, feature_id, occurred_at desc, sequence_number desc);
create index map_events_type_timeline_idx on public.map_events (organization_id, event_type, occurred_at desc);
create index map_events_geometry_gist_idx on public.map_events using gist (geometry);
create index map_events_customer_reference_idx on public.map_events (organization_id, customer_reference) where customer_reference is not null;
create index map_events_request_reference_idx on public.map_events (organization_id, request_reference) where request_reference is not null;
create index map_tasks_feature_status_due_idx on public.map_tasks (organization_id, feature_id, status, due_at) where archived_at is null;
create index map_tasks_organization_due_idx on public.map_tasks (organization_id, status, due_at) where archived_at is null;
create index map_tasks_customer_reference_idx on public.map_tasks (organization_id, customer_reference) where customer_reference is not null;
create index map_tasks_request_reference_idx on public.map_tasks (organization_id, request_reference) where request_reference is not null;

create or replace function private.prepare_map_event()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  latest_hash text;
  source_geometry extensions.geometry(Geometry, 4326);
  amended_organization_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in is required to submit a map event.' using errcode = '42501';
  end if;

  if public.organization_product_role(new.organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.organization_id::text, 0));

  if new.feature_id is not null then
    select feature.geometry into source_geometry
    from public.map_features feature
    where feature.organization_id = new.organization_id
      and feature.id = new.feature_id;
    if source_geometry is null then
      raise exception 'The selected mapped item was not found.' using errcode = 'P0002';
    end if;
    new.asset_geometry_snapshot := source_geometry;
    new.geometry := coalesce(new.geometry, source_geometry);
  end if;

  if new.amends_event_id is not null then
    select event.organization_id into amended_organization_id
    from public.map_events event
    where event.id = new.amends_event_id;
    if amended_organization_id is distinct from new.organization_id then
      raise exception 'An amendment must remain in the original organization.' using errcode = '23514';
    end if;
    new.event_type := new.amendment_kind;
  end if;

  select coalesce(max(event.sequence_number), 0) + 1,
         (array_agg(event.record_hash order by event.sequence_number desc))[1]
    into new.sequence_number, latest_hash
  from public.map_events event
  where event.organization_id = new.organization_id;

  new.id := coalesce(new.id, gen_random_uuid());
  new.created_by_user_id := (select auth.uid());
  new.submitted_at := now();
  new.previous_hash := latest_hash;
  new.record_hash := encode(extensions.digest(pg_catalog.convert_to(
    pg_catalog.concat_ws('|',
      new.id::text,
      new.organization_id::text,
      coalesce(new.feature_id::text, ''),
      new.sequence_number::text,
      new.event_type,
      new.title,
      coalesce(new.summary, ''),
      new.severity,
      new.compliance_basis,
      new.occurred_at::text,
      coalesce(new.discovered_at::text, ''),
      coalesce(new.resolved_at::text, ''),
      coalesce(encode(extensions.st_asbinary(new.geometry), 'hex'), ''),
      new.details::text,
      coalesce(new.customer_reference, ''),
      coalesce(new.request_reference, ''),
      coalesce(new.amends_event_id::text, ''),
      coalesce(new.amendment_kind, ''),
      coalesce(new.amendment_reason, ''),
      coalesce(latest_hash, ''),
      new.created_by_user_id::text,
      new.submitted_at::text
    ), 'UTF8'
  ), 'sha256'), 'hex');

  return new;
end;
$$;

create or replace function private.prevent_map_event_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Submitted map history is permanent. Add a correction or void record instead.' using errcode = '55000';
end;
$$;

create or replace function private.guard_map_task_update()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.feature_id is distinct from old.feature_id
     or new.source_event_id is distinct from old.source_event_id
     or new.created_by_user_id is distinct from old.created_by_user_id
     or new.created_at is distinct from old.created_at then
    raise exception 'Task identity and source links cannot be changed.' using errcode = '55000';
  end if;

  if new.status = 'completed' and old.status <> 'completed'
     and coalesce(pg_catalog.current_setting('n3xra.maps_completing_task', true), '') <> old.id::text then
    raise exception 'Complete this task through the protected completion action.' using errcode = '55000';
  end if;

  if old.status = 'completed' then
    raise exception 'Completed tasks are permanent. Add a follow-up task or correction event instead.' using errcode = '55000';
  end if;

  new.updated_by_user_id := (select auth.uid());
  return new;
end;
$$;

create trigger map_events_prepare
before insert on public.map_events
for each row execute function private.prepare_map_event();

create trigger map_events_prevent_update_delete
before update or delete on public.map_events
for each row execute function private.prevent_map_event_mutation();

create trigger map_tasks_guard_update
before update on public.map_tasks
for each row execute function private.guard_map_task_update();

drop trigger if exists map_tasks_set_updated_at on public.map_tasks;
create trigger map_tasks_set_updated_at
before update on public.map_tasks
for each row execute function public.set_updated_at();

create or replace function public.maps_complete_task(
  input_organization_id uuid,
  input_task_id uuid,
  input_completion_summary text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $$
declare
  task_row public.map_tasks%rowtype;
  created_event public.map_events%rowtype;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  select * into task_row
  from public.map_tasks
  where id = input_task_id
    and organization_id = input_organization_id
    and archived_at is null
  for update;

  if task_row.id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;
  if task_row.status = 'completed' then
    raise exception 'This task is already complete.' using errcode = '55000';
  end if;

  insert into public.map_events (
    organization_id, feature_id, sequence_number, event_type, title, summary,
    severity, compliance_basis, occurred_at, details, customer_reference,
    request_reference, record_hash
  ) values (
    input_organization_id, task_row.feature_id, 1, 'task_completed',
    task_row.title,
    coalesce(nullif(btrim(input_completion_summary), ''), task_row.description, 'Task completed.'),
    case when task_row.priority = 'urgent' then 'urgent' when task_row.priority = 'high' then 'attention' else 'routine' end,
    task_row.compliance_basis,
    now(),
    jsonb_build_object('taskId', task_row.id, 'category', task_row.category, 'dueAt', task_row.due_at),
    task_row.customer_reference,
    task_row.request_reference,
    repeat('0', 64)
  ) returning * into created_event;

  perform pg_catalog.set_config('n3xra.maps_completing_task', task_row.id::text, true);

  update public.map_tasks
  set status = 'completed',
      completed_at = created_event.occurred_at,
      completed_by_user_id = (select auth.uid()),
      completion_event_id = created_event.id,
      updated_by_user_id = (select auth.uid())
  where id = task_row.id;

  return jsonb_build_object('taskId', task_row.id, 'eventId', created_event.id);
end;
$$;

alter table public.map_events enable row level security;
alter table public.map_tasks enable row level security;

revoke all on public.map_events from public, anon, authenticated;
revoke all on public.map_tasks from public, anon, authenticated;
grant select, insert on public.map_events to authenticated;
grant select, insert, update on public.map_tasks to authenticated;
grant select, insert on public.map_events to service_role;
grant select, insert, update on public.map_tasks to service_role;

create policy "map_events_select"
on public.map_events for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_events_insert"
on public.map_events for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_tasks_select"
on public.map_tasks for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_tasks_insert"
on public.map_tasks for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_tasks_update"
on public.map_tasks for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

revoke all on function private.prepare_map_event() from public, anon, authenticated;
revoke all on function private.prevent_map_event_mutation() from public, anon, authenticated;
revoke all on function private.guard_map_task_update() from public, anon, authenticated;
revoke all on function public.maps_complete_task(uuid, uuid, text) from public, anon;
grant execute on function public.maps_complete_task(uuid, uuid, text) to authenticated;
