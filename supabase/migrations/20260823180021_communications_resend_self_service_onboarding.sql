-- Trusted, administrator-driven Resend domain onboarding.
-- Provider credentials and DNS records remain in trusted server responses;
-- PostgreSQL stores only tenant ownership, provider identifiers, readiness, and audit history.

create unique index communications_sending_domains_provider_id_uidx
  on public.communications_sending_domains (provider, provider_domain_id)
  where provider_domain_id is not null;

create or replace function public.communications_admin_record_resend_domain(
  input_actor_user_id uuid,
  input_idempotency_key uuid,
  input_workspace_id uuid,
  input_domain text,
  input_provider_domain_id text,
  input_provider_status text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_admin public.platform_admins%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  target_domain public.communications_sending_domains%rowtype;
  normalized_domain text := lower(btrim(coalesce(input_domain, '')));
  normalized_provider_id text := btrim(coalesce(input_provider_domain_id, ''));
  normalized_status text := lower(btrim(coalesce(input_provider_status, '')));
  local_status text;
  operation_result jsonb;
begin
  if input_idempotency_key is null then raise exception 'Idempotency key is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_idempotency_key::text, 0));

  select * into actor_admin
  from public.platform_admins
  where user_id = input_actor_user_id and status = 'active' and role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active platform administrator access is required.'; end if;

  select * into target_workspace
  from public.communications_workspaces
  where id = input_workspace_id
  for update;
  if not found then raise exception 'Communications workspace not found.'; end if;

  if exists (
    select 1 from public.communications_provider_audit_log
    where workspace_id = input_workspace_id
      and provider = 'resend'
      and action = 'domain_recorded'
      and idempotency_key = input_idempotency_key::text
  ) then
    select * into target_domain
    from public.communications_sending_domains
    where workspace_id = input_workspace_id and domain = normalized_domain;
    return jsonb_build_object(
      'ok', true, 'existing', true, 'workspace_id', input_workspace_id,
      'domain_id', target_domain.id, 'status', target_domain.status
    );
  end if;

  if normalized_domain !~* '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$' then
    raise exception 'Sending domain is invalid.';
  end if;
  if length(normalized_provider_id) not between 3 and 200 then
    raise exception 'Resend domain identifier is invalid.';
  end if;
  if normalized_status not in (
    'not_started', 'pending', 'verified', 'partially_verified',
    'partially_failed', 'failed', 'temporary_failure'
  ) then
    raise exception 'Resend domain status is invalid.';
  end if;

  local_status := case
    when normalized_status = 'verified' then 'verified'
    when normalized_status in ('failed', 'partially_failed') then 'failed'
    else 'pending_verification'
  end;

  insert into public.communications_sending_domains (
    workspace_id, domain, provider, provider_domain_id, status
  ) values (
    target_workspace.id, normalized_domain, 'resend', normalized_provider_id, local_status
  )
  on conflict (workspace_id, domain) do update
  set provider = 'resend',
      provider_domain_id = excluded.provider_domain_id,
      status = excluded.status,
      updated_at = now()
  returning * into target_domain;

  update public.communications_channels
  set status = case when status = 'active' and local_status = 'verified' then status else 'pending_verification' end,
      updated_at = now()
  where workspace_id = target_workspace.id and channel = 'email';

  operation_result := jsonb_build_object(
    'ok', true, 'existing', false, 'workspace_id', target_workspace.id,
    'domain_id', target_domain.id, 'status', target_domain.status
  );

  insert into public.communications_provider_audit_log (
    workspace_id, provider, action, idempotency_key, identity_snapshot, details
  ) values (
    target_workspace.id, 'resend', 'domain_recorded', input_idempotency_key::text,
    jsonb_build_object(
      'actor', jsonb_build_object('user_id', actor_admin.user_id, 'email', actor_admin.email, 'role', actor_admin.role),
      'workspace', jsonb_build_object('id', target_workspace.id, 'organization_id', target_workspace.organization_id, 'slug', target_workspace.slug),
      'domain', jsonb_build_object('id', target_domain.id, 'domain', target_domain.domain, 'provider_domain_id', target_domain.provider_domain_id)
    ),
    jsonb_build_object('provider_status', normalized_status, 'local_status', local_status)
  );

  return operation_result;
end;
$$;

create or replace function public.communications_admin_activate_resend_email(
  input_actor_user_id uuid,
  input_idempotency_key uuid,
  input_workspace_id uuid,
  input_provider_domain_id text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  actor_admin public.platform_admins%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  target_domain public.communications_sending_domains%rowtype;
  operation_result jsonb;
begin
  if input_idempotency_key is null then raise exception 'Idempotency key is required.'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_idempotency_key::text, 0));

  select * into actor_admin
  from public.platform_admins
  where user_id = input_actor_user_id and status = 'active' and role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active platform administrator access is required.'; end if;

  select * into target_workspace
  from public.communications_workspaces
  where id = input_workspace_id
  for update;
  if not found then raise exception 'Communications workspace not found.'; end if;

  if exists (
    select 1 from public.communications_provider_audit_log
    where workspace_id = input_workspace_id
      and provider = 'resend'
      and action = 'email_activated'
      and idempotency_key = input_idempotency_key::text
  ) then
    return jsonb_build_object('ok', true, 'existing', true, 'workspace_id', input_workspace_id, 'status', 'active');
  end if;

  select * into target_domain
  from public.communications_sending_domains
  where workspace_id = input_workspace_id
    and provider = 'resend'
    and provider_domain_id = btrim(coalesce(input_provider_domain_id, ''))
  for update;
  if not found then raise exception 'Resend sending domain not found.'; end if;
  if target_domain.status <> 'verified' then raise exception 'Verify the Resend sending domain before activation.'; end if;

  update public.communications_channels
  set status = 'active', updated_at = now()
  where workspace_id = target_workspace.id and channel = 'email';
  if not found then raise exception 'Email channel not found.'; end if;

  update public.communications_workspaces
  set status = 'active', updated_at = now()
  where id = target_workspace.id;

  operation_result := jsonb_build_object(
    'ok', true, 'existing', false, 'workspace_id', target_workspace.id,
    'domain_id', target_domain.id, 'status', 'active'
  );

  insert into public.communications_provider_audit_log (
    workspace_id, provider, action, idempotency_key, identity_snapshot, details
  ) values (
    target_workspace.id, 'resend', 'email_activated', input_idempotency_key::text,
    jsonb_build_object(
      'actor', jsonb_build_object('user_id', actor_admin.user_id, 'email', actor_admin.email, 'role', actor_admin.role),
      'workspace', jsonb_build_object('id', target_workspace.id, 'organization_id', target_workspace.organization_id, 'slug', target_workspace.slug),
      'domain', jsonb_build_object('id', target_domain.id, 'domain', target_domain.domain, 'provider_domain_id', target_domain.provider_domain_id)
    ),
    jsonb_build_object('domain_status', target_domain.status, 'channel_status', 'active', 'workspace_status', 'active')
  );

  return operation_result;
end;
$$;

revoke all on function public.communications_admin_record_resend_domain(uuid, uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.communications_admin_activate_resend_email(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.communications_admin_record_resend_domain(uuid, uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.communications_admin_activate_resend_email(uuid, uuid, uuid, text)
  to service_role;

comment on function public.communications_admin_record_resend_domain(uuid, uuid, uuid, text, text, text) is
  'Stores or synchronizes a tenant-owned Resend domain after trusted platform-admin and provider checks.';
comment on function public.communications_admin_activate_resend_email(uuid, uuid, uuid, text) is
  'Activates email and the Communications workspace only after trusted provider verification has been recorded.';
