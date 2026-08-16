-- Records shares the organizations table with Websites and Communications.
-- Removing Records must therefore remove only Records-owned data and its
-- entitlement; the shared tenant, website, Communications data, contacts,
-- memberships, and branding remain intact.

create or replace function public.has_active_records_entitlement(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.organization_product_entitlements entitlement
    where entitlement.organization_id = target_organization_id
      and entitlement.product_key = 'records'
      and entitlement.portal_enabled
      and entitlement.status in ('active', 'trialing', 'past_due')
  );
$$;

revoke all on function public.has_active_records_entitlement(uuid) from public, anon;
grant execute on function public.has_active_records_entitlement(uuid) to authenticated, service_role;

create or replace function public.is_records_organization_member(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_active_records_entitlement(target_organization_id)
    and (
      exists (
        select 1 from public.organizations organization
        where organization.id = target_organization_id
          and organization.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = (select auth.uid())
      )
    );
$$;

create or replace function public.can_manage_records_support(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.has_active_records_entitlement(target_organization_id)
    and (
      exists (
        select 1 from public.organizations organization
        where organization.id = target_organization_id
          and organization.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = (select auth.uid())
          and membership.role in ('account_owner', 'account_admin')
      )
    );
$$;

revoke all on function public.is_records_organization_member(uuid) from public, anon;
revoke all on function public.can_manage_records_support(uuid) from public, anon;
grant execute on function public.is_records_organization_member(uuid) to authenticated, service_role;
grant execute on function public.can_manage_records_support(uuid) to authenticated, service_role;

create or replace function public.admin_remove_records_enrollment(
  input_user_id uuid,
  input_organization_id uuid,
  input_remove_product_data boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_organization public.organizations%rowtype;
  other_member_count integer := 0;
  request_claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
begin
  if coalesce(request_claims ->> 'role', '') <> 'service_role' then
    raise exception using
      errcode = '42501',
      message = 'This operation is restricted to trusted service-role code.';
  end if;

  select * into target_organization
  from public.organizations
  where id = input_organization_id
  for update;

  if target_organization.id is null then
    raise exception 'The Records workspace no longer exists.';
  end if;

  if target_organization.owner_user_id <> input_user_id then
    if input_remove_product_data then
      raise exception 'Records ownership changed. Reload the account before trying again.';
    end if;

    delete from public.organization_memberships
    where organization_id = input_organization_id
      and user_id = input_user_id;

    if not found then
      raise exception 'This account does not have access to that Records workspace.';
    end if;

    return jsonb_build_object(
      'ok', true,
      'product', 'records',
      'mode', 'access_only',
      'workspace_id', input_organization_id
    );
  end if;

  if not input_remove_product_data then
    raise exception 'Records ownership changed. Reload the account before trying again.';
  end if;

  select count(distinct membership.user_id)::integer into other_member_count
  from public.organization_memberships membership
  where membership.organization_id = input_organization_id
    and membership.user_id <> input_user_id;

  if other_member_count > 0 then
    raise exception 'This Records workspace has % other member(s). Remove their Records access before deleting its data.', other_member_count;
  end if;

  if target_organization.stripe_subscription_id is not null
    or target_organization.subscription_tier in ('starter', 'organization')
  then
    if target_organization.account_status not in ('canceled', 'suspended') then
      raise exception 'Cancel the active Records subscription before deleting its data.';
    end if;
  end if;

  -- Delete Records-owned relational data. Foreign keys clean up recording
  -- chunks, references, share links, and related rows where appropriate.
  delete from public.record_packet_transfer_requests
  where source_organization_id = input_organization_id;
  delete from public.phone_meeting_retention_jobs
  where organization_id = input_organization_id;
  delete from public.phone_meeting_usage_events
  where organization_id = input_organization_id;
  delete from public.phone_meeting_sessions
  where organization_id = input_organization_id;
  delete from public.organization_phone_meeting_settings
  where organization_id = input_organization_id;
  delete from public.records_emergency_access
  where organization_id = input_organization_id;
  delete from public.records_support_audit_log
  where organization_id = input_organization_id;
  delete from public.records_support_grants
  where organization_id = input_organization_id;
  delete from public.records_activity_log
  where organization_id = input_organization_id;
  delete from public.records_ai_usage_events
  where organization_id = input_organization_id;
  delete from public.records_demo_workspace_claims
  where organization_id = input_organization_id;
  delete from public.meeting_recordings
  where organization_id = input_organization_id;
  delete from public.app_documents
  where organization_id = input_organization_id;
  delete from public.documents
  where organization_id = input_organization_id;
  delete from public.organization_invites
  where organization_id = input_organization_id;

  update public.organization_product_entitlements
  set status = 'canceled',
      portal_enabled = false,
      source = 'manual',
      ends_at = greatest(now(), coalesce(starts_at, now())),
      metadata = metadata || jsonb_build_object('records_removed_at', now()),
      updated_at = now()
  where organization_id = input_organization_id
    and product_key = 'records';

  if not found then
    insert into public.organization_product_entitlements (
      organization_id, product_key, status, portal_enabled, source, ends_at, metadata
    ) values (
      input_organization_id, 'records', 'canceled', false, 'manual', now(),
      jsonb_build_object('records_removed_at', now())
    );
  end if;

  update public.organizations
  set subscription_tier = 'free',
      stripe_subscription_id = null,
      stripe_price_id = null,
      cancel_at_period_end = false,
      subscription_current_period_end = null,
      public_embed_enabled = false,
      transcript_preview_enabled = false,
      hosted_public_portal_enabled = false,
      records_ai_context = null,
      records_ai_response_style = null,
      records_ai_memory = null,
      records_default_minutes_style = 'standard',
      records_speaker_detection_enabled = false,
      records_admin_only_meetings_enabled = false,
      updated_at = now()
  where id = input_organization_id;

  return jsonb_build_object(
    'ok', true,
    'product', 'records',
    'mode', 'product_data',
    'workspace_id', input_organization_id,
    'shared_organization_preserved', true
  );
end;
$$;

revoke all on function public.admin_remove_records_enrollment(uuid, uuid, boolean) from public, anon, authenticated;
grant execute on function public.admin_remove_records_enrollment(uuid, uuid, boolean) to service_role;

comment on function public.admin_remove_records_enrollment(uuid, uuid, boolean) is
'Removes Records access or Records-owned data without deleting the shared organization, website, Communications data, contacts, memberships, or branding.';
;
