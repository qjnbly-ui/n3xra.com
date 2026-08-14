-- Trusted Communications Admin provisioning operations.
-- These RPCs are called only by N3XRA server code after platform-admin session verification.

create table public.communications_admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  idempotency_key uuid not null unique,
  actor_user_id uuid not null,
  organization_id uuid not null,
  workspace_id uuid not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  identity_snapshot jsonb not null,
  before_state jsonb,
  after_state jsonb,
  result jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint communications_admin_audit_action_check
    check (action in ('provision_workspace', 'save_form', 'save_topic', 'update_pricing')),
  constraint communications_admin_audit_entity_type_check
    check (entity_type in ('communications_workspace', 'website_form', 'communications_topic', 'communications_pricing')),
  constraint communications_admin_audit_identity_snapshot_check
    check (
      jsonb_typeof(identity_snapshot) = 'object'
      and jsonb_typeof(identity_snapshot -> 'actor') = 'object'
      and jsonb_typeof(identity_snapshot -> 'organization') = 'object'
      and jsonb_typeof(identity_snapshot -> 'workspace') = 'object'
    ),
  constraint communications_admin_audit_before_state_check
    check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint communications_admin_audit_after_state_check
    check (after_state is null or jsonb_typeof(after_state) = 'object'),
  constraint communications_admin_audit_result_check check (jsonb_typeof(result) = 'object'),
  constraint communications_admin_audit_metadata_check check (jsonb_typeof(metadata) = 'object')
);

create index communications_admin_audit_workspace_created_idx
  on public.communications_admin_audit_log (workspace_id, created_at desc);
create index communications_admin_audit_organization_created_idx
  on public.communications_admin_audit_log (organization_id, created_at desc);
create index communications_admin_audit_actor_created_idx
  on public.communications_admin_audit_log (actor_user_id, created_at desc);

alter table public.communications_admin_audit_log enable row level security;
revoke all on public.communications_admin_audit_log from public, anon, authenticated;
revoke all on public.communications_admin_audit_log from service_role;
grant select, insert on public.communications_admin_audit_log to service_role;

create or replace function public.communications_admin_audit_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Communications administrative audit records are immutable.';
end;
$$;

revoke all on function public.communications_admin_audit_immutable() from public, anon, authenticated;
drop trigger if exists communications_admin_audit_immutable on public.communications_admin_audit_log;
create trigger communications_admin_audit_immutable
before update or delete on public.communications_admin_audit_log
for each row execute function public.communications_admin_audit_immutable();
drop trigger if exists communications_admin_audit_immutable_truncate on public.communications_admin_audit_log;
create trigger communications_admin_audit_immutable_truncate
before truncate on public.communications_admin_audit_log
for each statement execute function public.communications_admin_audit_immutable();

create or replace function public.communications_admin_provision_workspace(
  input_actor_user_id uuid,
  input_idempotency_key uuid,
  input_workspace_id uuid,
  input_organization_id uuid,
  input_website_id uuid,
  input_slug text,
  input_program_name text,
  input_sender_name text,
  input_website_url text,
  input_privacy_policy_url text,
  input_program_terms_url text,
  input_support_email text,
  input_support_phone text,
  input_expected_message_frequency text,
  input_workspace_status text,
  input_entitlement_status text,
  input_portal_enabled boolean,
  input_included_sms_segments integer,
  input_sms_overage_cents integer,
  input_mms_unit_cents integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_audit public.communications_admin_audit_log%rowtype;
  actor_admin public.platform_admins%rowtype;
  target_organization public.organizations%rowtype;
  prior_workspace public.communications_workspaces%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  operation_result jsonb;
begin
  if input_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_idempotency_key::text, 0));

  select * into actor_admin
  from public.platform_admins
  where user_id = input_actor_user_id and status = 'active' and role in ('owner', 'admin')
  for share;
  if not found then
    raise exception 'Active platform administrator access is required.';
  end if;

  select * into prior_audit
  from public.communications_admin_audit_log
  where idempotency_key = input_idempotency_key;
  if found then
    if prior_audit.action <> 'provision_workspace' then
      raise exception 'Idempotency key was already used for another operation.';
    end if;
    return prior_audit.result;
  end if;

  select * into target_organization
  from public.organizations
  where id = input_organization_id
  for share;
  if input_organization_id is null or not found then
    raise exception 'Choose a valid organization.';
  end if;
  if input_website_id is not null and not exists (
    select 1 from public.client_websites
    where id = input_website_id and organization_id = input_organization_id
  ) then
    raise exception 'The selected website does not belong to this organization.';
  end if;
  if btrim(coalesce(input_slug, '')) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'Workspace slug is invalid.';
  end if;
  if length(btrim(coalesce(input_program_name, ''))) not between 2 and 120
     or length(btrim(coalesce(input_sender_name, ''))) not between 2 and 120 then
    raise exception 'Program and sender names are required.';
  end if;
  if btrim(coalesce(input_website_url, '')) !~* '^https?://'
     or btrim(coalesce(input_privacy_policy_url, '')) !~* '^https?://'
     or btrim(coalesce(input_program_terms_url, '')) !~* '^https?://' then
    raise exception 'Website, privacy, and terms URLs must use HTTP or HTTPS.';
  end if;
  if btrim(coalesce(input_support_email, '')) !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Support email is invalid.';
  end if;
  if length(btrim(coalesce(input_expected_message_frequency, ''))) not between 3 and 240 then
    raise exception 'Expected message frequency is required.';
  end if;
  if nullif(btrim(coalesce(input_support_phone, '')), '') is not null
     and btrim(input_support_phone) !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Support phone must use E.164 format.';
  end if;
  if input_workspace_status not in ('setup', 'carrier_pending', 'paused', 'canceled') then
    raise exception 'Provider-backed activation is not available in this release.';
  end if;
  if input_entitlement_status not in ('trialing', 'active', 'paused', 'canceled') then
    raise exception 'Entitlement status is invalid.';
  end if;
  if input_included_sms_segments not between 0 and 100000000
     or input_sms_overage_cents not between 0 and 100000
     or input_mms_unit_cents not between 0 and 100000 then
    raise exception 'Usage pricing values are outside the supported range.';
  end if;

  if input_workspace_id is null then
    insert into public.communications_workspaces (
      organization_id, slug, program_name, sender_name, website_url,
      privacy_policy_url, program_terms_url, support_email, support_phone,
      expected_message_frequency, status, included_sms_segments,
      sms_overage_cents, mms_unit_cents
    ) values (
      input_organization_id, lower(btrim(input_slug)), btrim(input_program_name),
      btrim(input_sender_name), btrim(input_website_url), btrim(input_privacy_policy_url),
      btrim(input_program_terms_url), lower(btrim(input_support_email)),
      nullif(btrim(coalesce(input_support_phone, '')), ''),
      btrim(input_expected_message_frequency), input_workspace_status,
      input_included_sms_segments, input_sms_overage_cents, input_mms_unit_cents
    ) returning * into target_workspace;
  else
    select * into prior_workspace
    from public.communications_workspaces
    where id = input_workspace_id and organization_id = input_organization_id
    for update;
    if not found then raise exception 'Communications workspace not found.'; end if;

    update public.communications_workspaces
    set slug = lower(btrim(input_slug)),
        program_name = btrim(input_program_name),
        sender_name = btrim(input_sender_name),
        website_url = btrim(input_website_url),
        privacy_policy_url = btrim(input_privacy_policy_url),
        program_terms_url = btrim(input_program_terms_url),
        support_email = lower(btrim(input_support_email)),
        support_phone = nullif(btrim(coalesce(input_support_phone, '')), ''),
        expected_message_frequency = btrim(input_expected_message_frequency),
        status = input_workspace_status,
        included_sms_segments = input_included_sms_segments,
        sms_overage_cents = input_sms_overage_cents,
        mms_unit_cents = input_mms_unit_cents,
        updated_at = now()
    where id = input_workspace_id
    returning * into target_workspace;
  end if;

  if input_website_id is not null then
    insert into public.communications_workspace_websites (workspace_id, website_id, organization_id, status)
    values (target_workspace.id, input_website_id, input_organization_id, 'active')
    on conflict (workspace_id, website_id) do update set status = 'active';
  end if;

  insert into public.communications_channels (workspace_id, channel, status)
  values
    (target_workspace.id, 'email', 'pending_verification'),
    (target_workspace.id, 'sms', 'pending_setup')
  on conflict (workspace_id, channel) do nothing;

  insert into public.organization_product_entitlements (
    organization_id, product_key, status, portal_enabled, source, starts_at, metadata
  ) values (
    input_organization_id, 'communications', input_entitlement_status,
    input_portal_enabled, 'manual',
    case when input_entitlement_status in ('trialing', 'active') then now() else null end,
    jsonb_build_object('workspace_id', target_workspace.id, 'managed_by', 'communications_admin')
  )
  on conflict (organization_id, product_key) do update
  set status = excluded.status,
      portal_enabled = excluded.portal_enabled,
      source = 'manual',
      starts_at = case
        when excluded.status in ('trialing', 'active')
          then coalesce(public.organization_product_entitlements.starts_at, now())
        else public.organization_product_entitlements.starts_at
      end,
      ends_at = case when excluded.status = 'canceled' then now() else null end,
      metadata = public.organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now();

  operation_result := jsonb_build_object(
    'ok', true,
    'operation', 'provision_workspace',
    'workspace_id', target_workspace.id,
    'organization_id', target_workspace.organization_id,
    'created', input_workspace_id is null
  );

  insert into public.communications_admin_audit_log (
    idempotency_key, actor_user_id, organization_id, workspace_id, action,
    entity_type, entity_id, identity_snapshot, before_state, after_state, result, metadata
  ) values (
    input_idempotency_key, input_actor_user_id, input_organization_id,
    target_workspace.id, 'provision_workspace', 'communications_workspace',
    target_workspace.id,
    jsonb_build_object(
      'actor', jsonb_build_object('user_id', actor_admin.user_id, 'email', actor_admin.email, 'role', actor_admin.role),
      'organization', jsonb_build_object('id', target_organization.id, 'name', target_organization.name, 'slug', target_organization.slug),
      'workspace', jsonb_build_object('id', target_workspace.id, 'slug', target_workspace.slug, 'program_name', target_workspace.program_name, 'sender_name', target_workspace.sender_name)
    ),
    case when input_workspace_id is null then null else to_jsonb(prior_workspace) end,
    to_jsonb(target_workspace), operation_result,
    jsonb_build_object('website_id', input_website_id, 'entitlement_status', input_entitlement_status)
  );

  return operation_result;
end;
$$;

create or replace function public.communications_admin_save_form(
  input_actor_user_id uuid,
  input_idempotency_key uuid,
  input_workspace_id uuid,
  input_form_id uuid,
  input_website_id uuid,
  input_name text,
  input_status text,
  input_success_message text,
  input_allowed_origins text[],
  input_email_enabled boolean,
  input_sms_enabled boolean,
  input_email_version text,
  input_email_disclosure text,
  input_email_checkbox_label text,
  input_sms_version text,
  input_sms_disclosure text,
  input_sms_checkbox_label text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_audit public.communications_admin_audit_log%rowtype;
  actor_admin public.platform_admins%rowtype;
  target_organization public.organizations%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  prior_form public.website_forms%rowtype;
  target_form public.website_forms%rowtype;
  consent_configuration jsonb;
  operation_result jsonb;
begin
  if input_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_idempotency_key::text, 0));
  select * into actor_admin
  from public.platform_admins
  where user_id = input_actor_user_id and status = 'active' and role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active platform administrator access is required.'; end if;

  select * into prior_audit from public.communications_admin_audit_log
  where idempotency_key = input_idempotency_key;
  if found then
    if prior_audit.action <> 'save_form' then raise exception 'Idempotency key was already used for another operation.'; end if;
    return prior_audit.result;
  end if;

  select * into target_workspace from public.communications_workspaces
  where id = input_workspace_id for update;
  if not found then raise exception 'Communications workspace not found.'; end if;
  select * into target_organization from public.organizations
  where id = target_workspace.organization_id for share;
  if not found then raise exception 'Workspace organization not found.'; end if;
  if not exists (
    select 1 from public.communications_workspace_websites
    where workspace_id = input_workspace_id and website_id = input_website_id
      and organization_id = target_workspace.organization_id and status = 'active'
  ) then raise exception 'Choose an active website connected to this workspace.'; end if;
  if length(btrim(coalesce(input_name, ''))) not between 2 and 120 then raise exception 'Form name is required.'; end if;
  if length(btrim(coalesce(input_success_message, ''))) not between 2 and 500 then raise exception 'Success message is required.'; end if;
  if input_status not in ('draft', 'active', 'paused', 'archived') then raise exception 'Form status is invalid.'; end if;
  if not coalesce(input_email_enabled, false) and not coalesce(input_sms_enabled, false) then
    raise exception 'Enable email, texting, or both.';
  end if;
  if coalesce(cardinality(input_allowed_origins), 0) < 1 or cardinality(input_allowed_origins) > 20 then
    raise exception 'Provide between one and twenty allowed origins.';
  end if;
  if exists (
    select 1 from unnest(input_allowed_origins) as origin(value)
    where btrim(value) !~* '^https://[^/[:space:]]+$'
      and btrim(value) !~* '^http://localhost(?::[0-9]{1,5})?$'
  ) then raise exception 'Allowed origins must be HTTPS origins or localhost development origins.'; end if;
  if input_email_enabled and (
    length(btrim(coalesce(input_email_version, ''))) < 3
    or length(btrim(coalesce(input_email_disclosure, ''))) < 20
    or length(btrim(coalesce(input_email_checkbox_label, ''))) < 2
  ) then raise exception 'Complete the email consent version, disclosure, and checkbox label.'; end if;
  if input_sms_enabled and (
    length(btrim(coalesce(input_sms_version, ''))) < 3
    or length(btrim(coalesce(input_sms_disclosure, ''))) < 40
    or length(btrim(coalesce(input_sms_checkbox_label, ''))) < 2
  ) then raise exception 'Complete the texting consent version, disclosure, and checkbox label.'; end if;

  consent_configuration := jsonb_strip_nulls(jsonb_build_object(
    'email', case when input_email_enabled then jsonb_build_object(
      'version', btrim(input_email_version), 'disclosure', btrim(input_email_disclosure),
      'checkbox_label', btrim(input_email_checkbox_label)
    ) else null end,
    'sms', case when input_sms_enabled then jsonb_build_object(
      'version', btrim(input_sms_version), 'disclosure', btrim(input_sms_disclosure),
      'checkbox_label', btrim(input_sms_checkbox_label)
    ) else null end
  ));

  if input_form_id is null then
    insert into public.website_forms (
      organization_id, website_id, communications_workspace_id, name, form_type,
      status, success_message, allowed_origins, active_consent_configuration
    ) values (
      target_workspace.organization_id, input_website_id, input_workspace_id,
      btrim(input_name), 'subscription', input_status, btrim(input_success_message),
      input_allowed_origins, consent_configuration
    ) returning * into target_form;
  else
    select * into prior_form from public.website_forms
    where id = input_form_id and communications_workspace_id = input_workspace_id
      and organization_id = target_workspace.organization_id and form_type = 'subscription'
    for update;
    if not found then raise exception 'Subscription form not found.'; end if;
    update public.website_forms
    set website_id = input_website_id,
        name = btrim(input_name),
        status = input_status,
        success_message = btrim(input_success_message),
        allowed_origins = input_allowed_origins,
        active_consent_configuration = consent_configuration,
        updated_at = now()
    where id = input_form_id
    returning * into target_form;
  end if;

  insert into public.website_form_fields (
    form_id, field_key, field_type, label, required, sort_order, contact_field_mapping
  ) values (target_form.id, 'full_name', 'text', 'Name', false, 10, 'full_name')
  on conflict (form_id, field_key) do update
  set field_type = excluded.field_type, label = excluded.label, required = excluded.required,
      sort_order = excluded.sort_order, contact_field_mapping = excluded.contact_field_mapping,
      updated_at = now();

  if input_sms_enabled then
    insert into public.website_form_fields (
      form_id, field_key, field_type, label, placeholder, required, sort_order, contact_field_mapping
    ) values (target_form.id, 'phone', 'phone', 'Mobile phone', '(541) 555-0138', false, 20, 'phone_e164')
    on conflict (form_id, field_key) do update
    set field_type = excluded.field_type, label = excluded.label, placeholder = excluded.placeholder,
        required = excluded.required, sort_order = excluded.sort_order,
        contact_field_mapping = excluded.contact_field_mapping, updated_at = now();
  else
    delete from public.website_form_fields where form_id = target_form.id and field_key = 'phone';
  end if;

  if input_email_enabled then
    insert into public.website_form_fields (
      form_id, field_key, field_type, label, required, sort_order, contact_field_mapping
    ) values (target_form.id, 'email', 'email', 'Email address', false, 30, 'email')
    on conflict (form_id, field_key) do update
    set field_type = excluded.field_type, label = excluded.label, required = excluded.required,
        sort_order = excluded.sort_order, contact_field_mapping = excluded.contact_field_mapping,
        updated_at = now();
  else
    delete from public.website_form_fields where form_id = target_form.id and field_key = 'email';
  end if;

  insert into public.website_form_actions (form_id, action_type, status, sort_order)
  values
    (target_form.id, 'save_submission', 'active', 10),
    (target_form.id, 'upsert_communications_subscriber', 'active', 20),
    (target_form.id, 'subscribe_email', case when input_email_enabled then 'active' else 'disabled' end, 30),
    (target_form.id, 'subscribe_sms', case when input_sms_enabled then 'active' else 'disabled' end, 40),
    (target_form.id, 'record_consent', 'active', 50),
    (target_form.id, 'save_topics', 'active', 60)
  on conflict (form_id, action_type) do update
  set status = excluded.status, sort_order = excluded.sort_order, updated_at = now();

  insert into public.communications_signup_sources (
    organization_id, website_id, workspace_id, form_id, source_type, name, slug, status
  ) values
    (target_workspace.organization_id, input_website_id, input_workspace_id, target_form.id,
      'hosted_signup', 'Hosted subscriber signup', 'hosted-signup', 'active'),
    (target_workspace.organization_id, input_website_id, input_workspace_id, target_form.id,
      'website_embed', target_workspace.sender_name || ' website signup', 'website-signup', 'active'),
    (target_workspace.organization_id, input_website_id, input_workspace_id, target_form.id,
      'qr_campaign', 'Primary signup QR code', 'primary-qr', 'active')
  on conflict (form_id, slug) do update
  set website_id = excluded.website_id, source_type = excluded.source_type,
      name = excluded.name, status = 'active', updated_at = now();

  operation_result := jsonb_build_object(
    'ok', true, 'operation', 'save_form', 'workspace_id', input_workspace_id,
    'form_id', target_form.id, 'created', input_form_id is null
  );
  insert into public.communications_admin_audit_log (
    idempotency_key, actor_user_id, organization_id, workspace_id, action,
    entity_type, entity_id, identity_snapshot, before_state, after_state, result, metadata
  ) values (
    input_idempotency_key, input_actor_user_id, target_workspace.organization_id,
    input_workspace_id, 'save_form', 'website_form', target_form.id,
    jsonb_build_object(
      'actor', jsonb_build_object('user_id', actor_admin.user_id, 'email', actor_admin.email, 'role', actor_admin.role),
      'organization', jsonb_build_object('id', target_organization.id, 'name', target_organization.name, 'slug', target_organization.slug),
      'workspace', jsonb_build_object('id', target_workspace.id, 'slug', target_workspace.slug, 'program_name', target_workspace.program_name, 'sender_name', target_workspace.sender_name)
    ),
    case when input_form_id is null then null else to_jsonb(prior_form) end,
    to_jsonb(target_form), operation_result,
    jsonb_build_object('website_id', input_website_id, 'email_enabled', input_email_enabled, 'sms_enabled', input_sms_enabled)
  );
  return operation_result;
end;
$$;

create or replace function public.communications_admin_save_topic(
  input_actor_user_id uuid,
  input_idempotency_key uuid,
  input_workspace_id uuid,
  input_topic_id uuid,
  input_slug text,
  input_name text,
  input_description text,
  input_active boolean,
  input_sort_order integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_audit public.communications_admin_audit_log%rowtype;
  actor_admin public.platform_admins%rowtype;
  target_organization public.organizations%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  prior_topic public.communications_topics%rowtype;
  target_topic public.communications_topics%rowtype;
  operation_result jsonb;
begin
  if input_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_idempotency_key::text, 0));
  select * into actor_admin
  from public.platform_admins
  where user_id = input_actor_user_id and status = 'active' and role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active platform administrator access is required.'; end if;
  select * into prior_audit from public.communications_admin_audit_log where idempotency_key = input_idempotency_key;
  if found then
    if prior_audit.action <> 'save_topic' then raise exception 'Idempotency key was already used for another operation.'; end if;
    return prior_audit.result;
  end if;
  select * into target_workspace from public.communications_workspaces
  where id = input_workspace_id for share;
  if not found then raise exception 'Communications workspace not found.'; end if;
  select * into target_organization from public.organizations
  where id = target_workspace.organization_id for share;
  if not found then raise exception 'Workspace organization not found.'; end if;
  if btrim(coalesce(input_slug, '')) !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then raise exception 'Topic slug is invalid.'; end if;
  if length(btrim(coalesce(input_name, ''))) not between 2 and 120 then raise exception 'Topic name is required.'; end if;
  if input_sort_order not between 0 and 10000 then raise exception 'Topic order is invalid.'; end if;

  if input_topic_id is null then
    insert into public.communications_topics (workspace_id, slug, name, description, active, sort_order)
    values (input_workspace_id, lower(btrim(input_slug)), btrim(input_name),
      nullif(btrim(coalesce(input_description, '')), ''), input_active, input_sort_order)
    returning * into target_topic;
  else
    select * into prior_topic from public.communications_topics
    where id = input_topic_id and workspace_id = input_workspace_id for update;
    if not found then raise exception 'Communications topic not found.'; end if;
    update public.communications_topics
    set slug = lower(btrim(input_slug)), name = btrim(input_name),
        description = nullif(btrim(coalesce(input_description, '')), ''),
        active = input_active, sort_order = input_sort_order, updated_at = now()
    where id = input_topic_id returning * into target_topic;
  end if;

  operation_result := jsonb_build_object(
    'ok', true, 'operation', 'save_topic', 'workspace_id', input_workspace_id,
    'topic_id', target_topic.id, 'created', input_topic_id is null
  );
  insert into public.communications_admin_audit_log (
    idempotency_key, actor_user_id, organization_id, workspace_id, action,
    entity_type, entity_id, identity_snapshot, before_state, after_state, result
  ) values (
    input_idempotency_key, input_actor_user_id, target_workspace.organization_id,
    input_workspace_id, 'save_topic', 'communications_topic', target_topic.id,
    jsonb_build_object(
      'actor', jsonb_build_object('user_id', actor_admin.user_id, 'email', actor_admin.email, 'role', actor_admin.role),
      'organization', jsonb_build_object('id', target_organization.id, 'name', target_organization.name, 'slug', target_organization.slug),
      'workspace', jsonb_build_object('id', target_workspace.id, 'slug', target_workspace.slug, 'program_name', target_workspace.program_name, 'sender_name', target_workspace.sender_name)
    ),
    case when input_topic_id is null then null else to_jsonb(prior_topic) end,
    to_jsonb(target_topic), operation_result
  );
  return operation_result;
end;
$$;

create or replace function public.communications_admin_update_pricing(
  input_actor_user_id uuid,
  input_idempotency_key uuid,
  input_workspace_id uuid,
  input_included_sms_segments integer,
  input_sms_overage_cents integer,
  input_mms_unit_cents integer,
  input_entitlement_status text,
  input_portal_enabled boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_audit public.communications_admin_audit_log%rowtype;
  actor_admin public.platform_admins%rowtype;
  target_organization public.organizations%rowtype;
  prior_workspace public.communications_workspaces%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  prior_entitlement public.organization_product_entitlements%rowtype;
  target_entitlement public.organization_product_entitlements%rowtype;
  operation_result jsonb;
begin
  if input_idempotency_key is null then
    raise exception 'Idempotency key is required.';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(input_idempotency_key::text, 0));
  select * into actor_admin
  from public.platform_admins
  where user_id = input_actor_user_id and status = 'active' and role in ('owner', 'admin')
  for share;
  if not found then raise exception 'Active platform administrator access is required.'; end if;
  select * into prior_audit from public.communications_admin_audit_log where idempotency_key = input_idempotency_key;
  if found then
    if prior_audit.action <> 'update_pricing' then raise exception 'Idempotency key was already used for another operation.'; end if;
    return prior_audit.result;
  end if;
  if input_included_sms_segments not between 0 and 100000000
     or input_sms_overage_cents not between 0 and 100000
     or input_mms_unit_cents not between 0 and 100000 then
    raise exception 'Usage pricing values are outside the supported range.';
  end if;
  if input_entitlement_status not in ('trialing', 'active', 'paused', 'canceled') then
    raise exception 'Entitlement status is invalid.';
  end if;

  select * into prior_workspace from public.communications_workspaces
  where id = input_workspace_id for update;
  if not found then raise exception 'Communications workspace not found.'; end if;
  select * into target_organization from public.organizations
  where id = prior_workspace.organization_id for share;
  if not found then raise exception 'Workspace organization not found.'; end if;
  select * into prior_entitlement from public.organization_product_entitlements
  where organization_id = prior_workspace.organization_id and product_key = 'communications'
  for update;

  update public.communications_workspaces
  set included_sms_segments = input_included_sms_segments,
      sms_overage_cents = input_sms_overage_cents,
      mms_unit_cents = input_mms_unit_cents,
      updated_at = now()
  where id = input_workspace_id returning * into target_workspace;

  insert into public.organization_product_entitlements (
    organization_id, product_key, status, portal_enabled, source, starts_at, metadata
  ) values (
    prior_workspace.organization_id, 'communications', input_entitlement_status,
    input_portal_enabled, 'manual',
    case when input_entitlement_status in ('trialing', 'active') then now() else null end,
    jsonb_build_object('workspace_id', input_workspace_id, 'managed_by', 'communications_admin')
  )
  on conflict (organization_id, product_key) do update
  set status = excluded.status,
      portal_enabled = excluded.portal_enabled,
      source = 'manual',
      starts_at = case
        when excluded.status in ('trialing', 'active')
          then coalesce(public.organization_product_entitlements.starts_at, now())
        else public.organization_product_entitlements.starts_at
      end,
      ends_at = case when excluded.status = 'canceled' then now() else null end,
      metadata = public.organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now()
  returning * into target_entitlement;

  operation_result := jsonb_build_object(
    'ok', true, 'operation', 'update_pricing', 'workspace_id', input_workspace_id,
    'organization_id', target_workspace.organization_id
  );
  insert into public.communications_admin_audit_log (
    idempotency_key, actor_user_id, organization_id, workspace_id, action,
    entity_type, entity_id, identity_snapshot, before_state, after_state, result, metadata
  ) values (
    input_idempotency_key, input_actor_user_id, target_workspace.organization_id,
    input_workspace_id, 'update_pricing', 'communications_pricing', input_workspace_id,
    jsonb_build_object(
      'actor', jsonb_build_object('user_id', actor_admin.user_id, 'email', actor_admin.email, 'role', actor_admin.role),
      'organization', jsonb_build_object('id', target_organization.id, 'name', target_organization.name, 'slug', target_organization.slug),
      'workspace', jsonb_build_object('id', target_workspace.id, 'slug', target_workspace.slug, 'program_name', target_workspace.program_name, 'sender_name', target_workspace.sender_name)
    ),
    jsonb_build_object('workspace', to_jsonb(prior_workspace), 'entitlement', to_jsonb(prior_entitlement)),
    jsonb_build_object('workspace', to_jsonb(target_workspace), 'entitlement', to_jsonb(target_entitlement)),
    operation_result, jsonb_build_object('portal_enabled', input_portal_enabled)
  );
  return operation_result;
end;
$$;

revoke all on function public.communications_admin_provision_workspace(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, text, boolean, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.communications_admin_save_form(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text[], boolean, boolean,
  text, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.communications_admin_save_topic(
  uuid, uuid, uuid, uuid, text, text, text, boolean, integer
) from public, anon, authenticated;
revoke all on function public.communications_admin_update_pricing(
  uuid, uuid, uuid, integer, integer, integer, text, boolean
) from public, anon, authenticated;

grant execute on function public.communications_admin_provision_workspace(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, text, boolean, integer, integer, integer
) to service_role;
grant execute on function public.communications_admin_save_form(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text[], boolean, boolean,
  text, text, text, text, text, text
) to service_role;
grant execute on function public.communications_admin_save_topic(
  uuid, uuid, uuid, uuid, text, text, text, boolean, integer
) to service_role;
grant execute on function public.communications_admin_update_pricing(
  uuid, uuid, uuid, integer, integer, integer, text, boolean
) to service_role;

comment on table public.communications_admin_audit_log is
  'Permanently append-only audit records with historical identity snapshots for trusted Communications Admin provisioning operations.';
comment on function public.communications_admin_provision_workspace(
  uuid, uuid, uuid, uuid, uuid, text, text, text, text, text, text, text,
  text, text, text, text, boolean, integer, integer, integer
) is 'Atomically creates or updates a Communications workspace and its base entitlement, website link, and pending channels.';
