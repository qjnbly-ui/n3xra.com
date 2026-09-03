drop policy if exists "map_layers_insert" on public.map_layers;
create policy "map_layers_insert"
on public.map_layers for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
);

drop policy if exists "map_layers_update" on public.map_layers;
create policy "map_layers_update"
on public.map_layers for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
);

drop policy if exists "map_layer_fields_insert" on public.map_layer_fields;
create policy "map_layer_fields_insert"
on public.map_layer_fields for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
);

drop policy if exists "map_layer_fields_update" on public.map_layer_fields;
create policy "map_layer_fields_update"
on public.map_layer_fields for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
);

drop policy if exists "map_layer_fields_delete" on public.map_layer_fields;
create policy "map_layer_fields_delete"
on public.map_layer_fields for delete to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) = 'account_admin'
  or (select public.is_platform_admin())
);

create or replace function public.maps_archive_layer(
  input_organization_id uuid,
  input_layer_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  archived_timestamp timestamptz := clock_timestamp();
  archived_layer_id uuid;
begin
  if public.organization_product_role(input_organization_id, 'maps') <> 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps administrator access is required.' using errcode = '42501';
  end if;

  update public.map_layers
  set archived_at = archived_timestamp,
      updated_by_user_id = (select auth.uid())
  where id = input_layer_id
    and organization_id = input_organization_id
    and archived_at is null
  returning id into archived_layer_id;

  if archived_layer_id is null then
    raise exception 'Active map layer not found.' using errcode = 'P0002';
  end if;

  update public.map_features
  set archived_at = archived_timestamp,
      updated_by_user_id = (select auth.uid())
  where organization_id = input_organization_id
    and layer_id = input_layer_id
    and archived_at is null;

  return archived_layer_id;
end;
$$;

create or replace function public.maps_restore_layer(
  input_organization_id uuid,
  input_layer_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  archived_timestamp timestamptz;
begin
  if public.organization_product_role(input_organization_id, 'maps') <> 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps administrator access is required.' using errcode = '42501';
  end if;

  select archived_at
  into archived_timestamp
  from public.map_layers
  where id = input_layer_id
    and organization_id = input_organization_id
    and archived_at is not null;

  if archived_timestamp is null then
    raise exception 'Archived map layer not found.' using errcode = 'P0002';
  end if;

  update public.map_layers
  set archived_at = null,
      updated_by_user_id = (select auth.uid())
  where id = input_layer_id
    and organization_id = input_organization_id;

  update public.map_features
  set archived_at = null,
      updated_by_user_id = (select auth.uid())
  where organization_id = input_organization_id
    and layer_id = input_layer_id
    and archived_at = archived_timestamp;

  return input_layer_id;
end;
$$;

create or replace function public.maps_team_snapshot(input_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  requesting_user_id uuid := auth.uid();
  organization_record public.organizations%rowtype;
begin
  if requesting_user_id is null then
    raise exception 'Sign in to manage Maps access.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') <> 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps administrator access is required.' using errcode = '42501';
  end if;

  select organization.*
  into organization_record
  from public.organizations organization
  join public.organization_product_entitlements entitlement
    on entitlement.organization_id = organization.id
   and entitlement.product_key = 'maps'
   and entitlement.portal_enabled
   and entitlement.status in ('trialing', 'active', 'past_due')
  where organization.id = input_organization_id;

  if organization_record.id is null then
    raise exception 'Active Maps organization not found.' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'organization', jsonb_build_object('id', organization_record.id, 'name', organization_record.name),
    'currentUserId', requesting_user_id,
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'membershipId', membership.id,
        'userId', membership.user_id,
        'fullName', coalesce(nullif(trim(profile.full_name), ''), split_part(coalesce(profile.email, ''), '@', 1), 'Team member'),
        'email', profile.email,
        'organizationRole', membership.role,
        'mapsRole', case when access.status = 'active' then access.role else null end,
        'isOwner', membership.user_id = organization_record.owner_user_id
      ) order by (membership.user_id = organization_record.owner_user_id) desc, lower(coalesce(profile.full_name, profile.email, '')))
      from public.organization_memberships membership
      left join public.profiles profile on profile.id = membership.user_id
      left join public.organization_product_member_access access
        on access.organization_id = membership.organization_id
       and access.product_key = 'maps'
       and access.user_id = membership.user_id
      where membership.organization_id = input_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.maps_set_member_role(
  input_organization_id uuid,
  input_user_id uuid,
  input_role text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  requesting_user_id uuid := auth.uid();
  target_owner_user_id uuid;
begin
  if requesting_user_id is null then
    raise exception 'Sign in to manage Maps access.' using errcode = '42501';
  end if;
  if public.organization_product_role(input_organization_id, 'maps') <> 'account_admin'
     and not (select public.is_platform_admin()) then
    raise exception 'Maps administrator access is required.' using errcode = '42501';
  end if;
  if input_role is not null and input_role not in ('account_admin', 'editor', 'viewer') then
    raise exception 'Choose a valid Maps role.' using errcode = '22023';
  end if;
  if input_user_id = requesting_user_id then
    raise exception 'You cannot change your own Maps access.' using errcode = '22023';
  end if;

  select organization.owner_user_id
  into target_owner_user_id
  from public.organizations organization
  join public.organization_product_entitlements entitlement
    on entitlement.organization_id = organization.id
   and entitlement.product_key = 'maps'
   and entitlement.portal_enabled
   and entitlement.status in ('trialing', 'active', 'past_due')
  where organization.id = input_organization_id;

  if target_owner_user_id is null then
    raise exception 'Active Maps organization not found.' using errcode = 'P0002';
  end if;
  if input_user_id = target_owner_user_id then
    raise exception 'The organization owner always has Maps administrator access.' using errcode = '22023';
  end if;
  if not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = input_organization_id
      and membership.user_id = input_user_id
  ) then
    raise exception 'Choose an existing organization member.' using errcode = '22023';
  end if;

  insert into public.organization_product_member_access (
    organization_id, product_key, user_id, role, status, granted_by
  ) values (
    input_organization_id,
    'maps',
    input_user_id,
    coalesce(input_role, 'viewer'),
    case when input_role is null then 'revoked' else 'active' end,
    requesting_user_id
  )
  on conflict (organization_id, product_key, user_id) do update
  set role = excluded.role,
      status = excluded.status,
      granted_by = excluded.granted_by,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'userId', input_user_id,
    'role', input_role
  );
end;
$$;

revoke all on function public.maps_team_snapshot(uuid) from public, anon;
revoke all on function public.maps_set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.maps_team_snapshot(uuid) to authenticated;
grant execute on function public.maps_set_member_role(uuid, uuid, text) to authenticated;
