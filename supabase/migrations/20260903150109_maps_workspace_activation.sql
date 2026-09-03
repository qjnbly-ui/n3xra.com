alter table public.maps_access_requests
  add column if not exists activated_organization_id uuid
    references public.organizations (id) on delete set null,
  add column if not exists activated_at timestamptz;

create index if not exists maps_access_requests_activated_organization_idx
  on public.maps_access_requests (activated_organization_id)
  where activated_organization_id is not null;

create or replace function public.maps_activation_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  requesting_user_id uuid := auth.uid();
  access_request public.maps_access_requests%rowtype;
  eligible_organizations jsonb;
begin
  if requesting_user_id is null then
    raise exception 'Sign in to set up Maps.' using errcode = '42501';
  end if;

  select request.*
  into access_request
  from public.maps_access_requests request
  where request.user_id = requesting_user_id;

  if access_request.id is null or access_request.status <> 'approved' then
    raise exception 'Approved Maps early access is required.' using errcode = '42501';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', organization.id,
        'name', organization.name,
        'isOwner', organization.owner_user_id = requesting_user_id,
        'mapsConnected', exists (
          select 1
          from public.organization_product_entitlements entitlement
          where entitlement.organization_id = organization.id
            and entitlement.product_key = 'maps'
            and entitlement.portal_enabled
            and entitlement.status in ('trialing', 'active', 'past_due')
        )
      ) order by organization.name
    ),
    '[]'::jsonb
  )
  into eligible_organizations
  from public.organizations organization
  where organization.owner_user_id = requesting_user_id
     or exists (
       select 1
       from public.organization_memberships membership
       where membership.organization_id = organization.id
         and membership.user_id = requesting_user_id
         and membership.role = 'account_admin'
     );

  return jsonb_build_object(
    'approved', true,
    'activatedOrganizationId', access_request.activated_organization_id,
    'organizations', eligible_organizations
  );
end;
$$;

create or replace function public.activate_maps_workspace(
  input_organization_id uuid default null,
  input_organization_name text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  requesting_user_id uuid := auth.uid();
  access_request public.maps_access_requests%rowtype;
  selected_organization public.organizations%rowtype;
  requested_name text := nullif(trim(input_organization_name), '');
begin
  if requesting_user_id is null then
    raise exception 'Sign in to set up Maps.' using errcode = '42501';
  end if;

  select request.*
  into access_request
  from public.maps_access_requests request
  where request.user_id = requesting_user_id
  for update;

  if access_request.id is null or access_request.status <> 'approved' then
    raise exception 'Approved Maps early access is required.' using errcode = '42501';
  end if;

  if access_request.activated_organization_id is not null then
    select organization.*
    into selected_organization
    from public.organizations organization
    where organization.id = access_request.activated_organization_id;

    return jsonb_build_object(
      'ok', true,
      'organizationId', selected_organization.id,
      'organizationName', selected_organization.name,
      'created', false,
      'alreadyActivated', true
    );
  end if;

  if input_organization_id is not null and requested_name is not null then
    raise exception 'Choose an existing organization or create a new one, not both.' using errcode = '22023';
  end if;

  if input_organization_id is not null then
    select organization.*
    into selected_organization
    from public.organizations organization
    where organization.id = input_organization_id
      and (
        organization.owner_user_id = requesting_user_id
        or exists (
          select 1
          from public.organization_memberships membership
          where membership.organization_id = organization.id
            and membership.user_id = requesting_user_id
            and membership.role = 'account_admin'
        )
      );

    if selected_organization.id is null then
      raise exception 'You must own or administer the selected organization.' using errcode = '42501';
    end if;
  else
    if requested_name is null then
      raise exception 'Choose an organization or enter a new organization name.' using errcode = '22023';
    end if;
    if char_length(requested_name) > 160 then
      raise exception 'Organization names must be 160 characters or fewer.' using errcode = '22023';
    end if;

    insert into public.organizations (name, slug, owner_user_id)
    values (requested_name, public.unique_org_slug(requested_name), requesting_user_id)
    returning * into selected_organization;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      created_by
    ) values (
      selected_organization.id,
      requesting_user_id,
      'account_admin',
      requesting_user_id
    )
    on conflict (organization_id, user_id) do update
    set role = 'account_admin', updated_at = now();
  end if;

  insert into public.organization_product_entitlements (
    organization_id,
    product_key,
    status,
    portal_enabled,
    source,
    starts_at,
    metadata
  ) values (
    selected_organization.id,
    'maps',
    'active',
    true,
    'manual',
    now(),
    jsonb_build_object('early_access', true, 'approved_request_id', access_request.id)
  )
  on conflict (organization_id, product_key) do update
  set status = 'active',
      portal_enabled = true,
      source = 'manual',
      starts_at = coalesce(organization_product_entitlements.starts_at, excluded.starts_at),
      ends_at = null,
      metadata = organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now();

  insert into public.organization_product_member_access (
    organization_id,
    product_key,
    user_id,
    role,
    status,
    granted_by
  ) values (
    selected_organization.id,
    'maps',
    requesting_user_id,
    'account_admin',
    'active',
    requesting_user_id
  )
  on conflict (organization_id, product_key, user_id) do update
  set role = 'account_admin',
      status = 'active',
      granted_by = excluded.granted_by,
      updated_at = now();

  update public.maps_access_requests
  set activated_organization_id = selected_organization.id,
      activated_at = now()
  where id = access_request.id;

  return jsonb_build_object(
    'ok', true,
    'organizationId', selected_organization.id,
    'organizationName', selected_organization.name,
    'created', input_organization_id is null,
    'alreadyActivated', false
  );
end;
$$;

revoke all on function public.maps_activation_options() from public, anon;
revoke all on function public.activate_maps_workspace(uuid, text) from public, anon;
grant execute on function public.maps_activation_options() to authenticated;
grant execute on function public.activate_maps_workspace(uuid, text) to authenticated;
