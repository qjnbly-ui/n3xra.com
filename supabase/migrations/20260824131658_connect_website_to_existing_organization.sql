drop function if exists public.platform_connect_website_client_organization(uuid);

create function public.platform_connect_website_client_organization(
  input_website_id uuid,
  input_organization_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  website_record public.client_websites%rowtype;
  target_owner_user_id uuid;
  owner_count integer;
  existing_organization_count integer;
  owner_organization_count integer;
  target_organization public.organizations%rowtype;
  created_organization boolean := false;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'Platform administrator access is required.';
  end if;

  select * into website_record
  from public.client_websites
  where id = input_website_id
  for update;

  if website_record.id is null then
    raise exception 'Website not found.';
  end if;
  if website_record.organization_id is not null then
    select * into target_organization
    from public.organizations
    where id = website_record.organization_id;
    return jsonb_build_object(
      'ok', true,
      'created', false,
      'already_connected', true,
      'organization_id', target_organization.id,
      'organization_name', target_organization.name
    );
  end if;

  select count(distinct member.user_id), min(member.user_id::text)::uuid
  into owner_count, target_owner_user_id
  from public.website_members member
  where member.website_id = website_record.id
    and member.role = 'owner'
    and member.status = 'active';

  if owner_count > 1 then
    raise exception 'This website has multiple active owners. Choose one owner before connecting the client organization.';
  end if;

  if input_organization_id is not null then
    select * into target_organization
    from public.organizations
    where id = input_organization_id
    for update;

    if target_organization.id is null then
      raise exception 'The selected client organization was not found.';
    end if;
    if target_organization.account_status = 'suspended' then
      raise exception 'The selected client organization is suspended.';
    end if;
    if target_organization.owner_user_id is null then
      raise exception 'Assign an owner to the selected client organization before connecting this website.';
    end if;

    if target_owner_user_id is null then
      target_owner_user_id := target_organization.owner_user_id;
      insert into public.website_members (
        website_id,
        user_id,
        role,
        status,
        invited_by_user_id
      ) values (
        website_record.id,
        target_owner_user_id,
        'owner',
        'active',
        auth.uid()
      )
      on conflict (website_id, user_id) do update
      set role = 'owner',
          status = 'active',
          invited_by_user_id = auth.uid(),
          updated_at = now();
    elsif target_owner_user_id <> target_organization.owner_user_id then
      raise exception 'The website owner does not match the selected client organization owner.';
    end if;

    if not exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = target_organization.id
        and membership.user_id = target_owner_user_id
        and membership.role = 'account_admin'
    ) or target_organization.owner_user_id <> target_owner_user_id then
      raise exception 'The website owner must be the account administrator of the selected client organization.';
    end if;
  else
    if owner_count = 0 or target_owner_user_id is null then
      raise exception 'Assign one active website owner before creating the client organization.';
    end if;

    select count(*)
    into existing_organization_count
    from public.organizations organization
    where organization.owner_user_id = target_owner_user_id
      and (
        lower(trim(organization.name)) = lower(trim(website_record.name))
        or organization.slug = website_record.slug
      );

    if existing_organization_count > 1 then
      raise exception 'More than one matching client organization exists. Resolve the duplicate organizations before connecting this website.';
    elsif existing_organization_count = 1 then
      select * into target_organization
      from public.organizations organization
      where organization.owner_user_id = target_owner_user_id
        and (
          lower(trim(organization.name)) = lower(trim(website_record.name))
          or organization.slug = website_record.slug
        )
      order by organization.created_at
      limit 1;
    else
      select count(*) into owner_organization_count
      from public.organizations organization
      where organization.owner_user_id = target_owner_user_id
         or exists (
           select 1
           from public.organization_memberships membership
           where membership.organization_id = organization.id
             and membership.user_id = target_owner_user_id
         );

      if owner_organization_count > 0 then
        raise exception 'This website owner already belongs to another organization. Select the correct organization instead of creating a duplicate.';
      end if;

      insert into public.organizations (
        name,
        slug,
        owner_user_id,
        subscription_tier,
        account_status,
        user_limit
      ) values (
        website_record.name,
        public.unique_org_slug(website_record.name),
        target_owner_user_id,
        'free',
        'active',
        10
      )
      returning * into target_organization;
      created_organization := true;

      update public.organization_product_entitlements
      set status = 'canceled',
          portal_enabled = false,
          source = 'manual',
          ends_at = now(),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'website_only_organization', true,
            'connected_website_id', website_record.id,
            'provisioned_by', auth.uid()
          ),
          updated_at = now()
      where organization_id = target_organization.id
        and product_key = 'records';
    end if;
  end if;

  insert into public.profiles (id, email, full_name, updated_at)
  select
    user_record.id,
    lower(user_record.email),
    nullif(trim(coalesce(
      user_record.raw_user_meta_data ->> 'full_name',
      user_record.raw_user_meta_data ->> 'name',
      ''
    )), ''),
    now()
  from auth.users user_record
  where user_record.id = target_owner_user_id
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(public.profiles.full_name, excluded.full_name),
      updated_at = now();

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    target_organization.id,
    target_owner_user_id,
    'account_admin',
    auth.uid()
  )
  on conflict (organization_id, user_id) do update
  set role = 'account_admin',
      updated_at = now();

  update public.client_websites
  set organization_id = target_organization.id,
      updated_at = now()
  where id = website_record.id
    and organization_id is null;

  return jsonb_build_object(
    'ok', true,
    'created', created_organization,
    'already_connected', false,
    'organization_id', target_organization.id,
    'organization_name', target_organization.name,
    'owner_user_id', target_owner_user_id
  );
end;
$$;

revoke all on function public.platform_connect_website_client_organization(uuid, uuid)
from public, anon;
grant execute on function public.platform_connect_website_client_organization(uuid, uuid)
to authenticated;
;
