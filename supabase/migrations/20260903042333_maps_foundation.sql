create extension if not exists postgis with schema extensions;

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
  'maps',
  'Maps',
  'Map utility assets, infrastructure, service areas, and reference layers.',
  '/maps/',
  'maps',
  true,
  'active',
  30
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

create table public.map_layers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  description text,
  geometry_type text not null default 'point',
  feature_kind text not null default 'asset',
  icon_key text not null default 'marker',
  color text not null default '#1ed7b2',
  fill_color text not null default '#1ed7b2',
  opacity numeric(4,3) not null default 0.75,
  sort_order integer not null default 100,
  is_visible_by_default boolean not null default true,
  is_searchable boolean not null default true,
  is_editable boolean not null default true,
  source_name text,
  source_url text,
  external_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint map_layers_organization_id_id_unique unique (organization_id, id),
  constraint map_layers_name_check check (char_length(trim(name)) between 1 and 100),
  constraint map_layers_description_check check (description is null or char_length(description) <= 500),
  constraint map_layers_geometry_type_check check (geometry_type in ('point', 'line', 'polygon', 'raster')),
  constraint map_layers_feature_kind_check check (feature_kind in ('asset', 'reference')),
  constraint map_layers_icon_key_check check (icon_key ~ '^[a-z][a-z0-9_-]{0,49}$'),
  constraint map_layers_color_check check (color ~ '^#[0-9a-fA-F]{6}$'),
  constraint map_layers_fill_color_check check (fill_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint map_layers_opacity_check check (opacity between 0 and 1),
  constraint map_layers_sort_order_check check (sort_order between 0 and 10000),
  constraint map_layers_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create table public.map_features (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  layer_id uuid not null,
  title text not null,
  reference_code text,
  description text,
  status text not null default 'active',
  geometry_type text not null,
  geometry extensions.geometry(Geometry, 4326) not null,
  location_accuracy_m numeric(10,3),
  placement_method text not null default 'manual',
  properties jsonb not null default '{}'::jsonb,
  future_customer_account_id uuid,
  future_work_order_id uuid,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  updated_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint map_features_layer_organization_fkey
    foreign key (organization_id, layer_id)
    references public.map_layers (organization_id, id)
    on delete cascade,
  constraint map_features_title_check check (char_length(trim(title)) between 1 and 140),
  constraint map_features_reference_code_check check (reference_code is null or char_length(reference_code) <= 100),
  constraint map_features_description_check check (description is null or char_length(description) <= 4000),
  constraint map_features_status_check check (status in ('active', 'inactive', 'unknown')),
  constraint map_features_geometry_type_check check (geometry_type in ('point', 'line', 'polygon')),
  constraint map_features_accuracy_check check (location_accuracy_m is null or location_accuracy_m between 0 and 100000),
  constraint map_features_placement_method_check check (placement_method in ('manual', 'device_gps', 'import', 'external_gnss')),
  constraint map_features_properties_check check (jsonb_typeof(properties) = 'object')
);

create index map_layers_organization_active_idx
  on public.map_layers (organization_id, sort_order, name)
  where archived_at is null;
create index map_features_organization_active_idx
  on public.map_features (organization_id, layer_id, title)
  where archived_at is null;
create index map_features_geometry_gist_idx
  on public.map_features using gist (geometry);
create index map_features_title_search_idx
  on public.map_features (organization_id, lower(title));
create index map_features_reference_search_idx
  on public.map_features (organization_id, lower(reference_code))
  where reference_code is not null;

drop trigger if exists map_layers_set_updated_at on public.map_layers;
create trigger map_layers_set_updated_at
before update on public.map_layers
for each row execute function public.set_updated_at();

drop trigger if exists map_features_set_updated_at on public.map_features;
create trigger map_features_set_updated_at
before update on public.map_features
for each row execute function public.set_updated_at();

alter table public.map_layers enable row level security;
alter table public.map_features enable row level security;

revoke all on public.map_layers from public, anon, authenticated;
revoke all on public.map_features from public, anon, authenticated;
grant select, insert, update on public.map_layers to authenticated;
grant select, insert, update on public.map_features to authenticated;
grant all on public.map_layers to service_role;
grant all on public.map_features to service_role;

create policy "map_layers_select"
on public.map_layers for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_layers_insert"
on public.map_layers for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_layers_update"
on public.map_layers for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_features_select"
on public.map_features for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_features_insert"
on public.map_features for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_features_update"
on public.map_features for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create or replace function public.maps_access_list()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'organizationId', access.organization_id,
        'organizationName', organization.name,
        'role', access.role
      ) order by organization.name
    ),
    '[]'::jsonb
  )
  from public.organization_product_member_access access
  join public.organizations organization on organization.id = access.organization_id
  join public.organization_product_entitlements entitlement
    on entitlement.organization_id = access.organization_id
   and entitlement.product_key = access.product_key
  where access.user_id = (select auth.uid())
    and access.product_key = 'maps'
    and access.status = 'active'
    and entitlement.portal_enabled
    and entitlement.status in ('trialing', 'active', 'past_due');
$$;

create or replace function public.maps_workspace_snapshot(input_organization_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions
as $$
declare
  access_role text;
  result jsonb;
begin
  access_role := public.organization_product_role(input_organization_id, 'maps');
  if access_role is null and not (select public.is_platform_admin()) then
    raise exception 'Maps access is required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organization', jsonb_build_object('id', organization.id, 'name', organization.name),
    'role', coalesce(access_role, 'account_admin'),
    'layers', coalesce((
      select jsonb_agg(to_jsonb(layer) - 'metadata' - 'created_by_user_id' - 'updated_by_user_id' - 'archived_at' order by layer.sort_order, layer.name)
      from public.map_layers layer
      where layer.organization_id = input_organization_id and layer.archived_at is null
    ), '[]'::jsonb),
    'features', coalesce((
      select jsonb_agg(
        (to_jsonb(feature) - 'geometry' - 'created_by_user_id' - 'updated_by_user_id' - 'archived_at')
        || jsonb_build_object('geometry', extensions.st_asgeojson(feature.geometry)::jsonb)
        order by feature.title
      )
      from public.map_features feature
      where feature.organization_id = input_organization_id and feature.archived_at is null
    ), '[]'::jsonb)
  )
  into result
  from public.organizations organization
  where organization.id = input_organization_id;

  if result is null then
    raise exception 'Organization not found.' using errcode = 'P0002';
  end if;
  return result;
end;
$$;

create or replace function public.create_map_point(
  input_organization_id uuid,
  input_layer_id uuid,
  input_title text,
  input_reference_code text default null,
  input_description text default null,
  input_longitude double precision default null,
  input_latitude double precision default null,
  input_accuracy_m double precision default null,
  input_placement_method text default 'manual'
)
returns uuid
language plpgsql
volatile
security invoker
set search_path = public, extensions
as $$
declare
  created_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') not in ('account_admin', 'editor')
     and not (select public.is_platform_admin()) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;
  if nullif(trim(input_title), '') is null then
    raise exception 'A title is required.' using errcode = '22023';
  end if;
  if input_longitude is null or input_longitude not between -180 and 180
     or input_latitude is null or input_latitude not between -90 and 90 then
    raise exception 'Valid longitude and latitude are required.' using errcode = '22023';
  end if;
  if input_placement_method not in ('manual', 'device_gps', 'import', 'external_gnss') then
    raise exception 'Invalid placement method.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.map_layers layer
    where layer.id = input_layer_id
      and layer.organization_id = input_organization_id
      and layer.geometry_type = 'point'
      and layer.is_editable
      and layer.archived_at is null
  ) then
    raise exception 'Select an editable point layer.' using errcode = '22023';
  end if;

  insert into public.map_features (
    organization_id, layer_id, title, reference_code, description,
    geometry_type, geometry, location_accuracy_m, placement_method,
    created_by_user_id, updated_by_user_id
  ) values (
    input_organization_id,
    input_layer_id,
    trim(input_title),
    nullif(trim(input_reference_code), ''),
    nullif(trim(input_description), ''),
    'point',
    extensions.st_setsrid(extensions.st_makepoint(input_longitude, input_latitude), 4326),
    input_accuracy_m,
    input_placement_method,
    auth.uid(),
    auth.uid()
  )
  returning id into created_id;
  return created_id;
end;
$$;

revoke all on function public.maps_access_list() from public, anon;
revoke all on function public.maps_workspace_snapshot(uuid) from public, anon;
revoke all on function public.create_map_point(uuid, uuid, text, text, text, double precision, double precision, double precision, text) from public, anon;
grant execute on function public.maps_access_list() to authenticated;
grant execute on function public.maps_workspace_snapshot(uuid) to authenticated;
grant execute on function public.create_map_point(uuid, uuid, text, text, text, double precision, double precision, double precision, text) to authenticated;
