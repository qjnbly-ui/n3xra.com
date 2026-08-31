create or replace function public.activate_project_cards(input_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
begin
  if current_user_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  if input_organization_id is null
    or not public.can_manage_members(input_organization_id) then
    raise exception 'Organization administrator access is required.' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.n3xra_product_catalog product
    where product.product_key = 'project_cards'
      and product.status = 'active'
      and product.client_portal_available
  ) then
    raise exception 'Project Cards is not available.' using errcode = '55000';
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
    input_organization_id,
    'project_cards',
    'active',
    true,
    'manual',
    now(),
    jsonb_build_object(
      'activated_via', 'self_service',
      'activated_by_user_id', current_user_id
    )
  )
  on conflict (organization_id, product_key) do update
  set status = 'active',
      portal_enabled = true,
      source = case
        when public.organization_product_entitlements.source = 'subscription'
          then public.organization_product_entitlements.source
        else 'manual'
      end,
      starts_at = coalesce(public.organization_product_entitlements.starts_at, now()),
      ends_at = null,
      metadata = public.organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now();

  insert into public.organization_product_member_access (
    organization_id,
    product_key,
    user_id,
    role,
    status,
    granted_by
  ) values (
    input_organization_id,
    'project_cards',
    current_user_id,
    'account_admin',
    'active',
    current_user_id
  )
  on conflict (organization_id, product_key, user_id) do update
  set role = 'account_admin',
      status = 'active',
      granted_by = current_user_id,
      updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'organization_id', input_organization_id,
    'product_key', 'project_cards',
    'status', 'active'
  );
end;
$$;

revoke all on function public.activate_project_cards(uuid) from public, anon;
grant execute on function public.activate_project_cards(uuid) to authenticated;

comment on function public.activate_project_cards(uuid) is
  'Activates Project Cards for an organization after verifying organization-administrator access and grants the activating administrator product access.';
