-- Atomically connects a career application to an Auth identity and prepares
-- the applicant's personal workspace before an activation link is sent.
-- Auth identity creation remains in the trusted Edge Function because GoTrue
-- is outside the PostgreSQL transaction.

create or replace function public.admin_provision_career_applicant(
  input_application_id uuid,
  input_user_id uuid,
  input_actor_user_id uuid,
  input_product_keys text[]
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  request_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  target_application public.careers_applications%rowtype;
  target_organization public.organizations%rowtype;
  normalized_products text[];
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  if input_application_id is null or input_user_id is null or input_actor_user_id is null then
    raise exception 'An application, account, and provisioning administrator are required.';
  end if;

  select application.* into target_application
  from public.careers_applications as application
  where application.id = input_application_id
  for update;

  if target_application.id is null then
    raise exception 'The career application was not found.';
  end if;

  if target_application.account_user_id is not null
    and target_application.account_user_id <> input_user_id
  then
    raise exception 'This application is already connected to a different account.';
  end if;

  select coalesce(array_agg(product_key order by product_key), '{}'::text[])
  into normalized_products
  from (
    select distinct lower(trim(product_key)) as product_key
    from unnest(coalesce(input_product_keys, '{}'::text[])) as requested(product_key)
    where trim(product_key) <> ''
  ) as products;

  if cardinality(normalized_products) = 0 then
    raise exception 'Select at least one product to activate.';
  end if;

  if exists (
    select 1
    from unnest(normalized_products) as requested(product_key)
    left join public.n3xra_product_catalog as catalog
      on catalog.product_key = requested.product_key
      and catalog.status = 'active'
      and catalog.client_portal_available = true
    where catalog.product_key is null
  ) then
    raise exception 'One or more selected products cannot be activated for client accounts.';
  end if;

  if exists (
    select 1
    from unnest(normalized_products) as requested(product_key)
    where requested.product_key <> 'records'
  ) then
    raise exception 'One or more selected products require their own setup workflow.';
  end if;

  insert into public.profiles (id, email, full_name, updated_at)
  values (
    input_user_id,
    lower(trim(target_application.email)),
    nullif(trim(target_application.full_name), ''),
    now()
  )
  on conflict (id) do update
  set email = excluded.email,
      full_name = coalesce(excluded.full_name, public.profiles.full_name),
      updated_at = now();

  update public.careers_applications
  set account_user_id = input_user_id,
      updated_at = now()
  where id = target_application.id;

  select organization.* into target_organization
  from public.organizations as organization
  where organization.owner_user_id = input_user_id
  order by organization.created_at asc
  limit 1
  for update;

  if target_organization.id is null then
    insert into public.organizations (
      name,
      slug,
      owner_user_id,
      subscription_tier,
      account_status
    ) values (
      coalesce(nullif(trim(target_application.full_name), ''), 'Personal'),
      public.unique_org_slug(coalesce(nullif(trim(target_application.full_name), ''), 'Personal')),
      input_user_id,
      'free',
      'active'
    )
    returning * into target_organization;
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    target_organization.id,
    input_user_id,
    'account_admin',
    input_actor_user_id
  )
  on conflict (organization_id, user_id) do update
  set role = case
        when public.organization_memberships.role = 'account_admin' then public.organization_memberships.role
        else excluded.role
      end,
      updated_at = now();

  insert into public.organization_product_entitlements (
    organization_id,
    product_key,
    status,
    portal_enabled,
    source,
    starts_at,
    metadata
  )
  select
    target_organization.id,
    product_key,
    'active',
    true,
    'manual',
    now(),
    jsonb_build_object(
      'provisioned_from', 'career_application',
      'application_id', target_application.id,
      'provisioned_by', input_actor_user_id
    )
  from unnest(normalized_products) as requested(product_key)
  on conflict (organization_id, product_key) do update
  set status = case
        when public.organization_product_entitlements.source = 'subscription'
          then public.organization_product_entitlements.status
        else 'active'
      end,
      portal_enabled = case
        when public.organization_product_entitlements.source = 'subscription'
          then public.organization_product_entitlements.portal_enabled
        else true
      end,
      source = case
        when public.organization_product_entitlements.source = 'subscription'
          then public.organization_product_entitlements.source
        else 'manual'
      end,
      starts_at = coalesce(public.organization_product_entitlements.starts_at, now()),
      ends_at = case
        when public.organization_product_entitlements.source = 'subscription'
          then public.organization_product_entitlements.ends_at
        else null
      end,
      metadata = coalesce(public.organization_product_entitlements.metadata, '{}'::jsonb)
        || excluded.metadata,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'application_id', target_application.id,
    'user_id', input_user_id,
    'organization_id', target_organization.id,
    'organization_name', target_organization.name,
    'products', normalized_products
  );
end;
$$;

revoke all on function public.admin_provision_career_applicant(uuid, uuid, uuid, text[])
from public, anon, authenticated;
grant execute on function public.admin_provision_career_applicant(uuid, uuid, uuid, text[])
to service_role;

comment on function public.admin_provision_career_applicant(uuid, uuid, uuid, text[]) is
'Atomically connects a career applicant to a pending or existing Auth identity, prepares a personal organization, and activates selected client products. Callable only by trusted service-role code.';
