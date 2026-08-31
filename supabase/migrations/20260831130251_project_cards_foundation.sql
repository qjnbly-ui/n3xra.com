insert into public.n3xra_product_catalog (
  product_key,
  name,
  description,
  portal_path,
  icon_key,
  client_portal_available,
  status,
  sort_order
)
values (
  'project_cards',
  'Projects & Cards',
  'Reusable resource hubs connected to assignable physical NFC cards.',
  '/client-portal/project-cards/',
  'project-cards',
  true,
  'active',
  35
)
on conflict (product_key) do update
set name = excluded.name,
    description = excluded.description,
    portal_path = excluded.portal_path,
    icon_key = excluded.icon_key,
    client_portal_available = excluded.client_portal_available,
    status = excluded.status,
    sort_order = excluded.sort_order,
    updated_at = now();

create table public.project_card_projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null default '',
  location_text text not null default '',
  status text not null default 'draft'
    check (status in ('draft', 'live', 'archived')),
  access_level text not null default 'public'
    check (access_level in ('public', 'private')),
  created_by_user_id uuid not null references auth.users(id),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_card_projects_slug_check check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
    and length(slug) between 3 and 80
  ),
  constraint project_card_projects_name_check check (length(btrim(name)) between 1 and 140),
  constraint project_card_projects_description_check check (length(description) <= 500),
  constraint project_card_projects_location_check check (length(location_text) <= 180),
  constraint project_card_projects_published_check check (
    (status = 'live' and published_at is not null)
    or (status <> 'live')
  )
);

create unique index project_card_projects_slug_unique_idx
on public.project_card_projects (lower(slug));

create index project_card_projects_organization_status_idx
on public.project_card_projects (organization_id, status, updated_at desc);

create table public.project_card_resources (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.project_card_projects(id) on delete cascade,
  resource_type text not null
    check (resource_type in ('pdf', 'radio', 'image', 'file', 'link', 'text', 'form')),
  title text not null,
  detail text not null default '',
  sort_order integer not null default 0 check (sort_order between 0 and 10000),
  content jsonb not null default '{}'::jsonb,
  external_url text,
  storage_path text,
  is_visible boolean not null default true,
  created_by_user_id uuid not null references auth.users(id),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_card_resources_title_check check (length(btrim(title)) between 1 and 140),
  constraint project_card_resources_detail_check check (length(detail) <= 500),
  constraint project_card_resources_content_check check (
    jsonb_typeof(content) = 'object' and octet_length(content::text) <= 100000
  ),
  constraint project_card_resources_url_check check (
    external_url is null or external_url ~* '^https://[^[:space:]]+$'
  ),
  constraint project_card_resources_storage_check check (
    storage_path is null
    or (
      storage_path !~ '(^|/)\.\.(/|$)'
      and storage_path !~ '^/'
      and length(storage_path) between 3 and 500
    )
  )
);

create index project_card_resources_project_order_idx
on public.project_card_resources (project_id, sort_order, created_at);

create table public.project_card_devices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.project_card_projects(id) on delete set null,
  token text not null unique,
  card_code text not null unique,
  assigned_name text not null default '',
  status text not null default 'active'
    check (status in ('active', 'inactive', 'retired')),
  activated_by_user_id uuid not null references auth.users(id),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  activated_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_card_devices_token_check check (token ~ '^[0-9a-f]{32}$'),
  constraint project_card_devices_code_check check (card_code ~ '^N3-[0-9A-F]{8}$'),
  constraint project_card_devices_name_check check (length(assigned_name) <= 80),
  constraint project_card_devices_retired_check check (
    (status = 'retired' and retired_at is not null)
    or (status <> 'retired' and retired_at is null)
  )
);

create index project_card_devices_organization_status_idx
on public.project_card_devices (organization_id, status, updated_at desc);

create index project_card_devices_project_idx
on public.project_card_devices (project_id)
where project_id is not null;

create table public.project_card_device_events (
  id bigint generated always as identity primary key,
  device_id uuid not null references public.project_card_devices(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null
    check (event_type in ('created', 'assigned', 'unassigned', 'activated', 'deactivated', 'retired', 'renamed', 'updated')),
  before_state jsonb,
  after_state jsonb not null,
  created_at timestamptz not null default now(),
  constraint project_card_device_events_before_check check (
    before_state is null or jsonb_typeof(before_state) = 'object'
  ),
  constraint project_card_device_events_after_check check (jsonb_typeof(after_state) = 'object')
);

create index project_card_device_events_device_created_idx
on public.project_card_device_events (device_id, created_at desc);

create index project_card_device_events_organization_created_idx
on public.project_card_device_events (organization_id, created_at desc);

create trigger project_card_projects_set_updated_at
before update on public.project_card_projects
for each row execute function public.set_updated_at();

create trigger project_card_resources_set_updated_at
before update on public.project_card_resources
for each row execute function public.set_updated_at();

create trigger project_card_devices_set_updated_at
before update on public.project_card_devices
for each row execute function public.set_updated_at();

create or replace function public.can_view_project_cards(target_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((select public.is_platform_admin()), false)
    or public.organization_product_role(target_organization_id, 'project_cards') is not null;
$$;

create or replace function public.can_manage_project_cards(target_organization_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce((select public.is_platform_admin()), false)
    or public.organization_product_role(target_organization_id, 'project_cards') in ('account_admin', 'editor');
$$;

revoke all on function public.can_view_project_cards(uuid) from public, anon;
revoke all on function public.can_manage_project_cards(uuid) from public, anon;
grant execute on function public.can_view_project_cards(uuid) to authenticated;
grant execute on function public.can_manage_project_cards(uuid) to authenticated;

create or replace function private.guard_project_card_project_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.organization_id is distinct from old.organization_id then
    raise exception 'Project organization cannot be changed.' using errcode = '42501';
  end if;

  if new.status = 'live' and (tg_op = 'INSERT' or old.status is distinct from 'live') then
    new.published_at = coalesce(new.published_at, now());
  elsif new.status <> 'live' then
    new.published_at = null;
  end if;

  new.updated_by_user_id = (select auth.uid());
  return new;
end;
$$;

create trigger project_card_projects_guard_write
before insert or update on public.project_card_projects
for each row execute function private.guard_project_card_project_write();

create or replace function private.guard_project_card_resource_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id then
    raise exception 'Move resources by copying them into the destination project.' using errcode = '42501';
  end if;
  new.updated_by_user_id = (select auth.uid());
  return new;
end;
$$;

create trigger project_card_resources_guard_write
before insert or update on public.project_card_resources
for each row execute function private.guard_project_card_resource_write();

create or replace function private.guard_project_card_device_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.organization_id is distinct from old.organization_id
      or new.token is distinct from old.token
      or new.card_code is distinct from old.card_code
      or new.activated_by_user_id is distinct from old.activated_by_user_id
      or new.activated_at is distinct from old.activated_at
      or new.created_at is distinct from old.created_at then
      raise exception 'Permanent card identity cannot be changed.' using errcode = '42501';
    end if;
    if old.status = 'retired' then
      raise exception 'A retired card identity cannot be reused.' using errcode = '42501';
    end if;
  end if;

  if new.project_id is not null and not exists (
    select 1
    from public.project_card_projects project
    where project.id = new.project_id
      and project.organization_id = new.organization_id
      and project.status <> 'archived'
  ) then
    raise exception 'Card and project must belong to the same organization.' using errcode = '23514';
  end if;

  if new.status = 'retired' then
    new.project_id = null;
    new.retired_at = coalesce(new.retired_at, now());
  else
    new.retired_at = null;
  end if;

  if (select auth.uid()) is not null then
    new.updated_by_user_id = (select auth.uid());
  end if;
  return new;
end;
$$;

create trigger project_card_devices_guard_write
before update on public.project_card_devices
for each row execute function private.guard_project_card_device_write();

create or replace function private.record_project_card_device_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_event text;
  old_state jsonb;
  new_state jsonb;
begin
  new_state := jsonb_build_object(
    'project_id', new.project_id,
    'assigned_name', new.assigned_name,
    'status', new.status
  );

  if tg_op = 'INSERT' then
    next_event := 'created';
    old_state := null;
  else
    old_state := jsonb_build_object(
      'project_id', old.project_id,
      'assigned_name', old.assigned_name,
      'status', old.status
    );
    next_event := case
      when new.status = 'retired' and old.status <> 'retired' then 'retired'
      when new.status = 'inactive' and old.status <> 'inactive' then 'deactivated'
      when new.status = 'active' and old.status = 'inactive' then 'activated'
      when new.project_id is null and old.project_id is not null then 'unassigned'
      when new.project_id is distinct from old.project_id then 'assigned'
      when new.assigned_name is distinct from old.assigned_name then 'renamed'
      else 'updated'
    end;
  end if;

  insert into public.project_card_device_events (
    device_id,
    organization_id,
    actor_user_id,
    event_type,
    before_state,
    after_state
  ) values (
    new.id,
    new.organization_id,
    (select auth.uid()),
    next_event,
    old_state,
    new_state
  );
  return new;
end;
$$;

revoke all on function private.guard_project_card_project_write() from public, anon, authenticated;
revoke all on function private.guard_project_card_resource_write() from public, anon, authenticated;
revoke all on function private.guard_project_card_device_write() from public, anon, authenticated;
revoke all on function private.record_project_card_device_event() from public, anon, authenticated;

create trigger project_card_devices_record_event
after insert or update on public.project_card_devices
for each row execute function private.record_project_card_device_event();

alter table public.project_card_projects enable row level security;
alter table public.project_card_resources enable row level security;
alter table public.project_card_devices enable row level security;
alter table public.project_card_device_events enable row level security;

revoke all on table public.project_card_projects from public, anon, authenticated;
revoke all on table public.project_card_resources from public, anon, authenticated;
revoke all on table public.project_card_devices from public, anon, authenticated;
revoke all on table public.project_card_device_events from public, anon, authenticated;

grant select, insert, update, delete on table public.project_card_projects to authenticated;
grant select, insert, update, delete on table public.project_card_resources to authenticated;
grant select, update (project_id, assigned_name, status, updated_by_user_id)
  on table public.project_card_devices to authenticated;
grant select on table public.project_card_device_events to authenticated;
grant all on table public.project_card_projects to service_role;
grant all on table public.project_card_resources to service_role;
grant all on table public.project_card_devices to service_role;
grant select, insert on table public.project_card_device_events to service_role;
grant usage, select on sequence public.project_card_device_events_id_seq to service_role;

create policy project_card_projects_member_select
on public.project_card_projects for select to authenticated
using ((select public.can_view_project_cards(organization_id)));

create policy project_card_projects_editor_insert
on public.project_card_projects for insert to authenticated
with check (
  (select public.can_manage_project_cards(organization_id))
  and created_by_user_id = (select auth.uid())
);

create policy project_card_projects_editor_update
on public.project_card_projects for update to authenticated
using ((select public.can_manage_project_cards(organization_id)))
with check ((select public.can_manage_project_cards(organization_id)));

create policy project_card_projects_editor_delete
on public.project_card_projects for delete to authenticated
using ((select public.can_manage_project_cards(organization_id)));

create policy project_card_resources_member_select
on public.project_card_resources for select to authenticated
using (
  exists (
    select 1
    from public.project_card_projects project
    where project.id = project_id
      and (select public.can_view_project_cards(project.organization_id))
  )
);

create policy project_card_resources_editor_insert
on public.project_card_resources for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.project_card_projects project
    where project.id = project_id
      and (select public.can_manage_project_cards(project.organization_id))
  )
);

create policy project_card_resources_editor_update
on public.project_card_resources for update to authenticated
using (
  exists (
    select 1
    from public.project_card_projects project
    where project.id = project_id
      and (select public.can_manage_project_cards(project.organization_id))
  )
)
with check (
  exists (
    select 1
    from public.project_card_projects project
    where project.id = project_id
      and (select public.can_manage_project_cards(project.organization_id))
  )
);

create policy project_card_resources_editor_delete
on public.project_card_resources for delete to authenticated
using (
  exists (
    select 1
    from public.project_card_projects project
    where project.id = project_id
      and (select public.can_manage_project_cards(project.organization_id))
  )
);

create policy project_card_devices_member_select
on public.project_card_devices for select to authenticated
using ((select public.can_view_project_cards(organization_id)));

create policy project_card_devices_editor_update
on public.project_card_devices for update to authenticated
using ((select public.can_manage_project_cards(organization_id)))
with check ((select public.can_manage_project_cards(organization_id)));

create policy project_card_device_events_member_select
on public.project_card_device_events for select to authenticated
using ((select public.can_view_project_cards(organization_id)));

create or replace function public.create_project_card(
  input_organization_id uuid,
  input_assigned_name text default '',
  input_project_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_token text;
  generated_code text;
  created_card public.project_card_devices%rowtype;
begin
  if (select auth.uid()) is null
    or not public.can_manage_project_cards(input_organization_id) then
    raise exception 'Project Card editor access is required.' using errcode = '42501';
  end if;

  if length(coalesce(input_assigned_name, '')) > 80 then
    raise exception 'Assigned name is too long.' using errcode = '22001';
  end if;

  if input_project_id is not null and not exists (
    select 1
    from public.project_card_projects project
    where project.id = input_project_id
      and project.organization_id = input_organization_id
      and project.status <> 'archived'
  ) then
    raise exception 'Project does not belong to this organization.' using errcode = '23514';
  end if;

  loop
    generated_token := encode(extensions.gen_random_bytes(16), 'hex');
    generated_code := 'N3-' || upper(left(generated_token, 8));
    exit when not exists (
      select 1
      from public.project_card_devices device
      where device.token = generated_token or device.card_code = generated_code
    );
  end loop;

  insert into public.project_card_devices (
    organization_id,
    project_id,
    token,
    card_code,
    assigned_name,
    activated_by_user_id,
    updated_by_user_id
  ) values (
    input_organization_id,
    input_project_id,
    generated_token,
    generated_code,
    btrim(coalesce(input_assigned_name, '')),
    (select auth.uid()),
    (select auth.uid())
  ) returning * into created_card;

  return jsonb_build_object(
    'id', created_card.id,
    'card_code', created_card.card_code,
    'token', created_card.token,
    'permanent_url', 'https://n3xra.com/t/' || created_card.token,
    'project_id', created_card.project_id,
    'assigned_name', created_card.assigned_name,
    'status', created_card.status
  );
end;
$$;

revoke all on function public.create_project_card(uuid, text, uuid) from public, anon;
grant execute on function public.create_project_card(uuid, text, uuid) to authenticated;

create or replace function public.resolve_project_card(input_token text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when input_token !~ '^[0-9a-f]{32}$' then null
    else (
      select jsonb_build_object(
        'card_status', device.status,
        'destination_slug', project.slug,
        'destination_access', project.access_level
      )
      from public.project_card_devices device
      left join public.project_card_projects project
        on project.id = device.project_id
       and project.status = 'live'
      where device.token = input_token
        and device.status = 'active'
      limit 1
    )
  end;
$$;

revoke all on function public.resolve_project_card(text) from public;
grant execute on function public.resolve_project_card(text) to anon, authenticated;

create or replace function public.get_project_card_page(input_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when input_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(input_slug) not between 3 and 80 then null
    else (
      select jsonb_build_object(
        'slug', project.slug,
        'name', project.name,
        'description', project.description,
        'location_text', project.location_text,
        'updated_at', project.updated_at,
        'resources', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', resource.id,
              'resource_type', resource.resource_type,
              'title', resource.title,
              'detail', resource.detail,
              'content', resource.content,
              'external_url', resource.external_url,
              'sort_order', resource.sort_order
            ) order by resource.sort_order, resource.created_at
          )
          from public.project_card_resources resource
          where resource.project_id = project.id
            and resource.is_visible
        ), '[]'::jsonb)
      )
      from public.project_card_projects project
      where project.slug = input_slug
        and project.status = 'live'
        and project.access_level = 'public'
      limit 1
    )
  end;
$$;

revoke all on function public.get_project_card_page(text) from public;
grant execute on function public.get_project_card_page(text) to anon, authenticated;

comment on table public.project_card_projects is
  'Organization-owned editable resource hubs that can exist independently of physical cards.';
comment on table public.project_card_resources is
  'Ordered project landing-page resources. Public output is restricted to get_project_card_page.';
comment on table public.project_card_devices is
  'Permanent NFC card identities. Retired tokens remain stored and can never be recycled.';
comment on table public.project_card_device_events is
  'Immutable assignment and lifecycle history for physical Project Cards.';
comment on function public.create_project_card(uuid, text, uuid) is
  'Creates a cryptographically random permanent card identity for an authorized organization editor.';
comment on function public.resolve_project_card(text) is
  'Resolves an active permanent card token to its current live project without exposing ownership data.';
comment on function public.get_project_card_page(text) is
  'Returns only visible resources from a live public project landing page.';
