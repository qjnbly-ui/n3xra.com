-- Service-role-only destructive enrollment removal. The platform-admin Edge
-- Function performs the human/admin authorization check before calling this
-- transaction. Shared workspaces are intentionally refused here.
create or replace function public.admin_remove_product_enrollment(
  input_product text,
  input_user_id uuid,
  input_workspace_id uuid,
  input_delete_workspace boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  normalized_product text := lower(trim(coalesce(input_product, '')));
  target_organization public.organizations%rowtype;
  target_website public.client_websites%rowtype;
  target_loan public.loan_accounts%rowtype;
  target_membership public.website_members%rowtype;
  other_member_count integer := 0;
  project_row record;
  request_ids uuid[] := '{}'::uuid[];
  request_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  if input_user_id is null then
    raise exception 'A user is required.';
  end if;

  if normalized_product = 'records' then
    if input_workspace_id is null then
      raise exception 'A Records workspace is required.';
    end if;

    select * into target_organization
    from public.organizations
    where id = input_workspace_id
    for update;

    if target_organization.id is null then
      raise exception 'The Records workspace no longer exists.';
    end if;

    if target_organization.owner_user_id <> input_user_id then
      if input_delete_workspace then
        raise exception 'Records ownership changed. Reload the account before trying again.';
      end if;

      delete from public.organization_memberships
      where organization_id = input_workspace_id
        and user_id = input_user_id;

      if not found then
        raise exception 'This account does not have access to that Records workspace.';
      end if;

      return jsonb_build_object(
        'ok', true,
        'product', normalized_product,
        'mode', 'access_only',
        'workspace_id', input_workspace_id
      );
    end if;

    if not input_delete_workspace then
      raise exception 'Records ownership changed. Reload the account before trying again.';
    end if;

    select count(distinct membership.user_id)::integer into other_member_count
    from public.organization_memberships membership
    where membership.organization_id = input_workspace_id
      and membership.user_id <> input_user_id;

    if other_member_count > 0 then
      raise exception 'This Records workspace has % other member(s). Transfer ownership or remove those members before deleting it.', other_member_count;
    end if;

    if target_organization.stripe_subscription_id is not null
      or target_organization.subscription_tier in ('starter', 'organization')
    then
      if target_organization.account_status not in ('canceled', 'suspended') then
        raise exception 'Cancel the active Records subscription before deleting this workspace.';
      end if;
    end if;

    delete from public.organizations where id = input_workspace_id;

    return jsonb_build_object(
      'ok', true,
      'product', normalized_product,
      'mode', 'workspace',
      'workspace_id', input_workspace_id
    );
  end if;

  if normalized_product = 'websites' then
    if input_workspace_id is null then
      raise exception 'A website workspace is required.';
    end if;

    select * into target_website
    from public.client_websites
    where id = input_workspace_id
    for update;

    if target_website.id is null then
      raise exception 'The website workspace no longer exists.';
    end if;

    select * into target_membership
    from public.website_members
    where website_id = input_workspace_id
      and user_id = input_user_id
    for update;

    if target_membership.id is null then
      raise exception 'This account does not have access to that website.';
    end if;

    if target_membership.role <> 'owner' then
      if input_delete_workspace then
        raise exception 'Website ownership changed. Reload the account before trying again.';
      end if;

      delete from public.website_members where id = target_membership.id;
      return jsonb_build_object(
        'ok', true,
        'product', normalized_product,
        'mode', 'access_only',
        'workspace_id', input_workspace_id
      );
    end if;

    if not input_delete_workspace then
      raise exception 'Website ownership changed. Reload the account before trying again.';
    end if;

    select count(distinct membership.user_id)::integer into other_member_count
    from public.website_members membership
    where membership.website_id = input_workspace_id
      and membership.user_id <> input_user_id
      and membership.status = 'active';

    if other_member_count > 0 then
      raise exception 'This website has % other active member(s). Transfer ownership or remove those members before deleting it.', other_member_count;
    end if;

    if exists (
      select 1
      from public.website_subscriptions subscription
      join public.website_projects project on project.id = subscription.project_id
      where project.managed_website_id = input_workspace_id
        and subscription.status not in ('canceled', 'paused')
    ) then
      raise exception 'Cancel the active website subscription before deleting this workspace.';
    end if;

    -- Delete project-owned data before the website. managed_website_id uses
    -- ON DELETE SET NULL because projects can normally outlive a website.
    for project_row in
      select id, request_id
      from public.website_projects
      where managed_website_id = input_workspace_id
      for update
    loop
      if project_row.request_id is not null then
        request_ids := array_append(request_ids, project_row.request_id);
      end if;
      delete from public.website_projects where id = project_row.id;
    end loop;

    if cardinality(request_ids) > 0 then
      delete from public.website_service_requests where id = any(request_ids);
    end if;

    delete from public.client_websites where id = input_workspace_id;

    return jsonb_build_object(
      'ok', true,
      'product', normalized_product,
      'mode', 'workspace',
      'workspace_id', input_workspace_id
    );
  end if;

  if normalized_product = 'loan_tracker' then
    if not input_delete_workspace then
      raise exception 'Loan Tracker deletion must remove its single-owner workspace.';
    end if;

    select * into target_loan
    from public.loan_accounts
    where id = input_workspace_id
      and user_id = input_user_id
    for update;

    if target_loan.id is null then
      raise exception 'The Loan Tracker enrollment no longer exists.';
    end if;

    delete from public.loan_payments where loan_account_id = target_loan.id;
    delete from public.loan_accounts where id = target_loan.id;

    return jsonb_build_object(
      'ok', true,
      'product', normalized_product,
      'mode', 'workspace',
      'workspace_id', input_workspace_id
    );
  end if;

  raise exception 'Unsupported product enrollment: %', normalized_product;
end;
$$;

revoke all on function public.admin_remove_product_enrollment(text, uuid, uuid, boolean) from public;
revoke all on function public.admin_remove_product_enrollment(text, uuid, uuid, boolean) from anon;
revoke all on function public.admin_remove_product_enrollment(text, uuid, uuid, boolean) from authenticated;
grant execute on function public.admin_remove_product_enrollment(text, uuid, uuid, boolean) to service_role;

comment on function public.admin_remove_product_enrollment(text, uuid, uuid, boolean) is
'Removes one product enrollment. Sole-owner workspaces are deleted; shared non-owner memberships only lose access. Callable only through trusted service-role code.';
