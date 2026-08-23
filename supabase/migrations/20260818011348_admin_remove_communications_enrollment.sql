-- Communications is an organization product, but its operational workspace can
-- be removed independently from the shared organization, website, contacts,
-- memberships, and N3XRA identity. Immutable consent and audit history must
-- never be silently erased by an account-management action.

create or replace function public.admin_remove_communications_enrollment(
  input_user_id uuid,
  input_workspace_id uuid,
  input_remove_product_data boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_workspace public.communications_workspaces%rowtype;
  target_organization public.organizations%rowtype;
  target_entitlement public.organization_product_entitlements%rowtype;
  request_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  remaining_workspace_count integer := 0;
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  if input_user_id is null or input_workspace_id is null then
    raise exception 'A user and Communications workspace are required.';
  end if;
  if not input_remove_product_data then
    raise exception 'Communications removal must delete the selected operational workspace.';
  end if;

  select * into target_workspace
  from public.communications_workspaces
  where id = input_workspace_id
  for update;

  if target_workspace.id is null then
    raise exception 'The Communications workspace no longer exists.';
  end if;

  select * into target_organization
  from public.organizations
  where id = target_workspace.organization_id
  for share;

  if target_organization.id is null then
    raise exception 'The Communications organization no longer exists.';
  end if;
  if target_organization.owner_user_id <> input_user_id then
    raise exception 'Only the organization owner can delete this Communications product and its shared workspace data.';
  end if;

  select * into target_entitlement
  from public.organization_product_entitlements
  where organization_id = target_workspace.organization_id
    and product_key = 'communications'
  for update;

  if target_entitlement.organization_id is not null
    and target_entitlement.source = 'subscription'
    and target_entitlement.status not in ('paused', 'canceled')
  then
    raise exception 'Cancel the active Communications subscription before deleting its data.';
  end if;

  if exists (
    select 1
    from public.communications_consent_events
    where workspace_id = target_workspace.id
  ) then
    raise exception 'This Communications workspace has immutable consent history and cannot be hard-deleted. Cancel and archive it instead.';
  end if;

  if exists (
    select 1
    from public.communications_email_delivery_requests
    where workspace_id = target_workspace.id
      and status in ('prepared', 'sending', 'scheduled', 'delivery_delayed')
  ) then
    raise exception 'Finish or cancel pending Communications deliveries before deleting this workspace.';
  end if;

  -- Submissions reference signup sources with RESTRICT semantics. Remove the
  -- operational submissions first so the workspace-owned form graph can then
  -- cascade cleanly. Immutable consent history was refused above.
  delete from public.website_form_submissions
  where workspace_id = target_workspace.id;

  delete from public.communications_workspaces
  where id = target_workspace.id;

  select count(*)::integer into remaining_workspace_count
  from public.communications_workspaces
  where organization_id = target_workspace.organization_id
    and status <> 'canceled';

  if remaining_workspace_count = 0 then
    update public.organization_product_entitlements
    set status = 'canceled',
        portal_enabled = false,
        source = case when source = 'subscription' then source else 'manual' end,
        ends_at = greatest(now(), coalesce(starts_at, now())),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'communications_removed_at', now(),
          'removed_workspace_id', target_workspace.id
        ),
        updated_at = now()
    where organization_id = target_workspace.organization_id
      and product_key = 'communications';

    if not found then
      insert into public.organization_product_entitlements (
        organization_id, product_key, status, portal_enabled, source, ends_at, metadata
      ) values (
        target_workspace.organization_id,
        'communications',
        'canceled',
        false,
        'manual',
        now(),
        jsonb_build_object(
          'communications_removed_at', now(),
          'removed_workspace_id', target_workspace.id
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'product', 'communications',
    'mode', 'product_data',
    'workspace_id', target_workspace.id,
    'organization_id', target_workspace.organization_id,
    'shared_organization_preserved', true,
    'remaining_workspaces', remaining_workspace_count
  );
end;
$$;

revoke all on function public.admin_remove_communications_enrollment(uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function public.admin_remove_communications_enrollment(uuid, uuid, boolean)
to service_role;

comment on function public.admin_remove_communications_enrollment(uuid, uuid, boolean) is
'Removes one empty or prelaunch Communications workspace while preserving the shared organization, website, account, contacts, and immutable audit history. Callable only by trusted service-role code.';
