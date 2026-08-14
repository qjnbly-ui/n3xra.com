-- Trusted Resend delivery foundation.
-- Provider credentials remain in trusted server environment variables; this
-- migration stores only tenant-scoped delivery state and immutable audit data.

alter table public.communications_message_events
  drop constraint communications_message_events_status_check;
alter table public.communications_message_events
  add constraint communications_message_events_status_check
  check (status in (
    'queued', 'scheduled', 'sent', 'delivered', 'delivery_delayed',
    'failed', 'bounced', 'complained', 'suppressed', 'received'
  ));

create table public.communications_email_delivery_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  subscriber_id uuid references public.communications_subscribers (id) on delete set null,
  idempotency_key text not null,
  payload_hash text not null,
  from_address text not null,
  to_address text not null,
  subject text not null,
  provider text not null default 'resend',
  provider_message_id text,
  provider_status_at timestamptz,
  status text not null default 'prepared',
  retryable boolean not null default false,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, idempotency_key),
  constraint communications_email_delivery_provider_check check (provider = 'resend'),
  constraint communications_email_delivery_idempotency_check
    check (length(idempotency_key) between 1 and 200),
  constraint communications_email_delivery_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint communications_email_delivery_from_check
    check (from_address = lower(from_address) and from_address ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint communications_email_delivery_to_check
    check (to_address = lower(to_address) and to_address ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint communications_email_delivery_subject_check
    check (length(subject) between 1 and 300),
  constraint communications_email_delivery_status_check
    check (status in (
      'prepared', 'sending', 'scheduled', 'sent', 'delivered',
      'delivery_delayed', 'failed', 'bounced', 'complained', 'suppressed'
    )),
  constraint communications_email_delivery_attempts_check
    check (attempt_count between 0 and 5)
);

create unique index communications_email_delivery_provider_message_uidx
  on public.communications_email_delivery_requests (provider_message_id)
  where provider_message_id is not null;
create index communications_email_delivery_workspace_created_idx
  on public.communications_email_delivery_requests (workspace_id, created_at desc);
create index communications_email_delivery_subscriber_created_idx
  on public.communications_email_delivery_requests (subscriber_id, created_at desc)
  where subscriber_id is not null;
create index communications_email_delivery_retryable_idx
  on public.communications_email_delivery_requests (last_attempt_at, created_at)
  where status in ('sending', 'failed') and retryable is true;

create table public.communications_email_suppressions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.communications_workspaces (id) on delete cascade,
  subscriber_id uuid references public.communications_subscribers (id) on delete set null,
  email text not null,
  reason text not null,
  status text not null default 'active',
  provider text not null default 'resend',
  provider_message_id text,
  source_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  first_suppressed_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_email_suppressions_email_check
    check (email = lower(email) and email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint communications_email_suppressions_reason_check
    check (reason in ('bounce', 'complaint', 'provider', 'manual')),
  constraint communications_email_suppressions_status_check
    check (status in ('active', 'removed')),
  constraint communications_email_suppressions_provider_check check (provider = 'resend'),
  constraint communications_email_suppressions_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint communications_email_suppressions_removed_check
    check ((status = 'active' and removed_at is null) or (status = 'removed' and removed_at is not null))
);

create index communications_email_suppressions_active_email_idx
  on public.communications_email_suppressions (email, workspace_id)
  where status = 'active';
create unique index communications_email_suppressions_workspace_email_uidx
  on public.communications_email_suppressions (workspace_id, email)
  where workspace_id is not null;
create unique index communications_email_suppressions_global_email_uidx
  on public.communications_email_suppressions (email)
  where workspace_id is null;
create index communications_email_suppressions_workspace_updated_idx
  on public.communications_email_suppressions (workspace_id, updated_at desc);
create index communications_email_suppressions_subscriber_idx
  on public.communications_email_suppressions (subscriber_id)
  where subscriber_id is not null;

create table public.communications_resend_webhook_events (
  id uuid primary key default gen_random_uuid(),
  svix_id text not null unique,
  event_type text not null,
  provider_message_id text,
  workspace_id uuid,
  delivery_request_id uuid,
  payload_hash text not null,
  event_payload jsonb not null,
  processing_status text not null,
  result jsonb not null,
  occurred_at timestamptz not null,
  received_at timestamptz not null default now(),
  constraint communications_resend_webhook_svix_id_check check (length(svix_id) between 3 and 200),
  constraint communications_resend_webhook_event_type_check
    check (event_type in (
      'email.scheduled', 'email.sent', 'email.delivered', 'email.delivery_delayed',
      'email.failed', 'email.bounced', 'email.complained', 'email.suppressed',
      'email.opened', 'email.clicked', 'suppression.added', 'suppression.removed'
    )),
  constraint communications_resend_webhook_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint communications_resend_webhook_payload_check check (jsonb_typeof(event_payload) = 'object'),
  constraint communications_resend_webhook_processing_check
    check (processing_status in ('processed', 'ignored')),
  constraint communications_resend_webhook_result_check check (jsonb_typeof(result) = 'object')
);

create index communications_resend_webhook_provider_message_idx
  on public.communications_resend_webhook_events (provider_message_id, received_at desc)
  where provider_message_id is not null;
create index communications_resend_webhook_workspace_received_idx
  on public.communications_resend_webhook_events (workspace_id, received_at desc)
  where workspace_id is not null;

create table public.communications_provider_audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid,
  delivery_request_id uuid,
  provider text not null,
  action text not null,
  idempotency_key text,
  provider_message_id text,
  identity_snapshot jsonb not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint communications_provider_audit_provider_check check (provider in ('resend', 'twilio')),
  constraint communications_provider_audit_action_check check (action ~ '^[a-z][a-z0-9_]{2,79}$'),
  constraint communications_provider_audit_identity_check check (jsonb_typeof(identity_snapshot) = 'object'),
  constraint communications_provider_audit_details_check check (jsonb_typeof(details) = 'object')
);

create index communications_provider_audit_workspace_created_idx
  on public.communications_provider_audit_log (workspace_id, created_at desc)
  where workspace_id is not null;
create index communications_provider_audit_delivery_created_idx
  on public.communications_provider_audit_log (delivery_request_id, created_at desc)
  where delivery_request_id is not null;
create index communications_provider_audit_message_created_idx
  on public.communications_provider_audit_log (provider_message_id, created_at desc)
  where provider_message_id is not null;

create trigger communications_email_delivery_set_updated_at
before update on public.communications_email_delivery_requests
for each row execute function public.set_updated_at();
create trigger communications_email_suppressions_set_updated_at
before update on public.communications_email_suppressions
for each row execute function public.set_updated_at();

alter table public.communications_email_delivery_requests enable row level security;
alter table public.communications_email_suppressions enable row level security;
alter table public.communications_resend_webhook_events enable row level security;
alter table public.communications_provider_audit_log enable row level security;

revoke all on public.communications_email_delivery_requests from public, anon, authenticated;
revoke all on public.communications_email_suppressions from public, anon, authenticated;
revoke all on public.communications_resend_webhook_events from public, anon, authenticated;
revoke all on public.communications_provider_audit_log from public, anon, authenticated;
revoke all on public.communications_email_delivery_requests from service_role;
revoke all on public.communications_email_suppressions from service_role;
revoke all on public.communications_resend_webhook_events from service_role;
revoke all on public.communications_provider_audit_log from service_role;
grant select, insert, update on public.communications_email_delivery_requests to service_role;
grant select, insert, update on public.communications_email_suppressions to service_role;
grant select, insert on public.communications_resend_webhook_events to service_role;
grant select, insert on public.communications_provider_audit_log to service_role;

create or replace function public.communications_provider_history_immutable()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Communications provider history is immutable.';
end;
$$;

revoke all on function public.communications_provider_history_immutable() from public, anon, authenticated;
create trigger communications_resend_webhook_events_immutable
before update or delete on public.communications_resend_webhook_events
for each row execute function public.communications_provider_history_immutable();
create trigger communications_resend_webhook_events_immutable_truncate
before truncate on public.communications_resend_webhook_events
for each statement execute function public.communications_provider_history_immutable();
create trigger communications_provider_audit_immutable
before update or delete on public.communications_provider_audit_log
for each row execute function public.communications_provider_history_immutable();
create trigger communications_provider_audit_immutable_truncate
before truncate on public.communications_provider_audit_log
for each statement execute function public.communications_provider_history_immutable();

create or replace function public.communications_prepare_resend_delivery(
  input_workspace_id uuid,
  input_subscriber_id uuid,
  input_idempotency_key text,
  input_payload_hash text,
  input_from_address text,
  input_to_address text,
  input_subject text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_workspace public.communications_workspaces%rowtype;
  target_subscriber public.communications_subscribers%rowtype;
  prior_request public.communications_email_delivery_requests%rowtype;
  target_request public.communications_email_delivery_requests%rowtype;
  normalized_from text := lower(btrim(coalesce(input_from_address, '')));
  normalized_to text := lower(btrim(coalesce(input_to_address, '')));
  normalized_key text := btrim(coalesce(input_idempotency_key, ''));
  normalized_subject text := btrim(coalesce(input_subject, ''));
  sender_domain text;
  identity_snapshot jsonb;
  operation_result jsonb;
begin
  if input_workspace_id is null or input_subscriber_id is null then
    raise exception 'Workspace and subscriber are required.';
  end if;
  if length(normalized_key) not between 1 and 200 then
    raise exception 'Delivery idempotency key is invalid.';
  end if;
  if btrim(coalesce(input_payload_hash, '')) !~ '^[0-9a-f]{64}$' then
    raise exception 'Delivery payload hash is invalid.';
  end if;
  if normalized_from !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or normalized_to !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Delivery addresses are invalid.';
  end if;
  if length(normalized_subject) not between 1 and 300 then
    raise exception 'Delivery subject is invalid.';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(input_workspace_id::text || ':' || normalized_key, 0)
  );

  select * into prior_request
  from public.communications_email_delivery_requests
  where workspace_id = input_workspace_id and idempotency_key = normalized_key
  for update;
  if found then
    if prior_request.payload_hash <> input_payload_hash then
      raise exception 'Delivery idempotency key was already used with a different payload.';
    end if;
    return jsonb_build_object(
      'ok', true,
      'existing', true,
      'request_id', prior_request.id,
      'status', prior_request.status,
      'provider_message_id', prior_request.provider_message_id
    );
  end if;

  select * into target_workspace
  from public.communications_workspaces
  where id = input_workspace_id
  for share;
  if not found then raise exception 'Communications workspace not found.'; end if;
  if target_workspace.status <> 'active' then
    raise exception 'Communications workspace is not active.';
  end if;

  if not exists (
    select 1 from public.communications_channels channel
    where channel.workspace_id = input_workspace_id
      and channel.channel = 'email'
      and channel.status = 'active'
  ) then
    raise exception 'Email channel is not active.';
  end if;

  sender_domain := pg_catalog.split_part(normalized_from, '@', 2);
  if not exists (
    select 1 from public.communications_sending_domains domain
    where domain.workspace_id = input_workspace_id
      and lower(domain.domain) = sender_domain
      and domain.provider = 'resend'
      and domain.status = 'verified'
  ) then
    raise exception 'Resend sending domain is not verified.';
  end if;

  select * into target_subscriber
  from public.communications_subscribers
  where id = input_subscriber_id and workspace_id = input_workspace_id
  for share;
  if not found then raise exception 'Communications subscriber not found.'; end if;
  if target_subscriber.email is null or lower(target_subscriber.email) <> normalized_to then
    raise exception 'Delivery recipient does not match the subscriber.';
  end if;
  if target_subscriber.email_status <> 'subscribed' then
    raise exception 'Subscriber does not have active email consent.';
  end if;
  if exists (
    select 1 from public.communications_email_suppressions suppression
    where suppression.email = normalized_to and suppression.status = 'active'
  ) then
    raise exception 'Recipient email address is suppressed.';
  end if;

  insert into public.communications_email_delivery_requests (
    workspace_id, subscriber_id, idempotency_key, payload_hash,
    from_address, to_address, subject
  ) values (
    input_workspace_id, input_subscriber_id, normalized_key, input_payload_hash,
    normalized_from, normalized_to, normalized_subject
  ) returning * into target_request;

  identity_snapshot := jsonb_build_object(
    'workspace', jsonb_build_object(
      'id', target_workspace.id,
      'organization_id', target_workspace.organization_id,
      'slug', target_workspace.slug,
      'program_name', target_workspace.program_name,
      'sender_name', target_workspace.sender_name
    ),
    'subscriber', jsonb_build_object(
      'id', target_subscriber.id,
      'email', normalized_to,
      'email_status', target_subscriber.email_status
    )
  );
  operation_result := jsonb_build_object(
    'ok', true,
    'existing', false,
    'request_id', target_request.id,
    'status', target_request.status,
    'provider_message_id', null
  );

  insert into public.communications_provider_audit_log (
    workspace_id, delivery_request_id, provider, action, idempotency_key,
    identity_snapshot, details
  ) values (
    target_workspace.id, target_request.id, 'resend', 'delivery_prepared', normalized_key,
    identity_snapshot,
    jsonb_build_object('payload_hash', input_payload_hash, 'subject', normalized_subject)
  );

  return operation_result;
end;
$$;

create or replace function public.communications_claim_resend_delivery(
  input_request_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_request public.communications_email_delivery_requests%rowtype;
  can_claim boolean := false;
begin
  select * into target_request
  from public.communications_email_delivery_requests
  where id = input_request_id
  for update;
  if not found then raise exception 'Email delivery request not found.'; end if;

  can_claim := target_request.status = 'prepared'
    or (
      target_request.status = 'failed'
      and target_request.retryable
      and target_request.attempt_count < 5
      and target_request.created_at > now() - interval '23 hours'
    )
    or (
      target_request.status = 'sending'
      and target_request.last_attempt_at < now() - interval '15 minutes'
      and target_request.attempt_count < 5
      and target_request.created_at > now() - interval '23 hours'
    );

  if not can_claim then
    return jsonb_build_object(
      'ok', true,
      'should_send', false,
      'request_id', target_request.id,
      'status', target_request.status,
      'provider_message_id', target_request.provider_message_id
    );
  end if;

  update public.communications_email_delivery_requests
  set status = 'sending',
      retryable = false,
      attempt_count = attempt_count + 1,
      last_attempt_at = now(),
      last_error = null
  where id = target_request.id
  returning * into target_request;

  insert into public.communications_provider_audit_log (
    workspace_id, delivery_request_id, provider, action, idempotency_key,
    identity_snapshot, details
  ) values (
    target_request.workspace_id, target_request.id, 'resend', 'delivery_claimed',
    target_request.idempotency_key,
    jsonb_build_object('workspace_id', target_request.workspace_id, 'subscriber_id', target_request.subscriber_id),
    jsonb_build_object('attempt_count', target_request.attempt_count)
  );

  return jsonb_build_object(
    'ok', true,
    'should_send', true,
    'request_id', target_request.id,
    'status', target_request.status,
    'attempt_count', target_request.attempt_count
  );
end;
$$;

create or replace function public.communications_record_resend_delivery_result(
  input_request_id uuid,
  input_success boolean,
  input_provider_message_id text,
  input_error text,
  input_retryable boolean
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_request public.communications_email_delivery_requests%rowtype;
  normalized_provider_id text := nullif(btrim(coalesce(input_provider_message_id, '')), '');
  normalized_error text := nullif(left(btrim(coalesce(input_error, '')), 1000), '');
  operation_result jsonb;
begin
  select * into target_request
  from public.communications_email_delivery_requests
  where id = input_request_id
  for update;
  if not found then raise exception 'Email delivery request not found.'; end if;

  if input_success then
    if normalized_provider_id is null then raise exception 'Provider message ID is required.'; end if;
    if target_request.status in ('sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'suppressed') then
      if target_request.provider_message_id <> normalized_provider_id then
        raise exception 'Delivery result conflicts with the recorded provider message.';
      end if;
      return jsonb_build_object(
        'ok', true,
        'existing', true,
        'request_id', target_request.id,
        'status', target_request.status,
        'provider_message_id', target_request.provider_message_id
      );
    end if;
    if target_request.status <> 'sending' then raise exception 'Email delivery request is not sending.'; end if;

    update public.communications_email_delivery_requests
    set status = 'sent',
        provider_message_id = normalized_provider_id,
        provider_status_at = now(),
        retryable = false,
        last_error = null
    where id = target_request.id
    returning * into target_request;

    insert into public.communications_message_events (
      workspace_id, subscriber_id, channel, direction, status,
      provider_message_id, from_address, to_address, body_preview,
      billable_units, occurred_at
    ) values (
      target_request.workspace_id, target_request.subscriber_id, 'email', 'outbound', 'sent',
      normalized_provider_id, target_request.from_address, target_request.to_address,
      left(target_request.subject, 500), 1, now()
    ) on conflict do nothing;

    insert into public.communications_provider_audit_log (
      workspace_id, delivery_request_id, provider, action, idempotency_key,
      provider_message_id, identity_snapshot, details
    ) values (
      target_request.workspace_id, target_request.id, 'resend', 'delivery_accepted',
      target_request.idempotency_key, normalized_provider_id,
      jsonb_build_object('workspace_id', target_request.workspace_id, 'subscriber_id', target_request.subscriber_id),
      jsonb_build_object('attempt_count', target_request.attempt_count)
    );
  else
    if target_request.status <> 'sending' then
      return jsonb_build_object(
        'ok', true,
        'existing', true,
        'request_id', target_request.id,
        'status', target_request.status,
        'provider_message_id', target_request.provider_message_id
      );
    end if;

    update public.communications_email_delivery_requests
    set status = 'failed',
        retryable = coalesce(input_retryable, false)
          and attempt_count < 5
          and created_at > now() - interval '23 hours',
        last_error = coalesce(normalized_error, 'Resend delivery failed.')
    where id = target_request.id
    returning * into target_request;

    insert into public.communications_provider_audit_log (
      workspace_id, delivery_request_id, provider, action, idempotency_key,
      identity_snapshot, details
    ) values (
      target_request.workspace_id, target_request.id, 'resend', 'delivery_failed',
      target_request.idempotency_key,
      jsonb_build_object('workspace_id', target_request.workspace_id, 'subscriber_id', target_request.subscriber_id),
      jsonb_build_object(
        'attempt_count', target_request.attempt_count,
        'retryable', target_request.retryable,
        'error', target_request.last_error
      )
    );
  end if;

  operation_result := jsonb_build_object(
    'ok', input_success,
    'existing', false,
    'request_id', target_request.id,
    'status', target_request.status,
    'provider_message_id', target_request.provider_message_id,
    'retryable', target_request.retryable
  );
  return operation_result;
end;
$$;

create or replace function public.communications_process_resend_webhook(
  input_svix_id text,
  input_event_type text,
  input_provider_message_id text,
  input_payload_hash text,
  input_event_payload jsonb,
  input_occurred_at timestamptz
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  prior_event public.communications_resend_webhook_events%rowtype;
  target_request public.communications_email_delivery_requests%rowtype;
  normalized_svix_id text := btrim(coalesce(input_svix_id, ''));
  normalized_event_type text := lower(btrim(coalesce(input_event_type, '')));
  normalized_provider_id text := nullif(btrim(coalesce(input_provider_message_id, '')), '');
  mapped_status text;
  suppression_reason text;
  suppression_email text;
  suppression_origin text;
  suppression_status text;
  suppression_source_event_id text;
  suppression_state_applied boolean := false;
  status_applied boolean := false;
  affected_suppressions integer := 0;
  operation_result jsonb;
begin
  if length(normalized_svix_id) not between 3 and 200 then raise exception 'Webhook event ID is invalid.'; end if;
  if normalized_event_type not in (
    'email.scheduled', 'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.failed', 'email.bounced', 'email.complained', 'email.suppressed',
    'email.opened', 'email.clicked', 'suppression.added', 'suppression.removed'
  ) then raise exception 'Webhook event type is unsupported.'; end if;
  if btrim(coalesce(input_payload_hash, '')) !~ '^[0-9a-f]{64}$' then raise exception 'Webhook payload hash is invalid.'; end if;
  if input_event_payload is null or jsonb_typeof(input_event_payload) <> 'object' then raise exception 'Webhook payload is invalid.'; end if;
  if input_occurred_at is null then raise exception 'Webhook occurrence time is required.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_svix_id, 0));
  select * into prior_event
  from public.communications_resend_webhook_events
  where svix_id = normalized_svix_id;
  if found then
    if prior_event.payload_hash <> input_payload_hash
       or prior_event.event_type <> normalized_event_type
       or prior_event.provider_message_id is distinct from normalized_provider_id then
      raise exception 'Webhook event ID was already used with a different payload.';
    end if;
    return prior_event.result || jsonb_build_object('duplicate', true);
  end if;

  if normalized_event_type in ('suppression.added', 'suppression.removed') then
    suppression_email := lower(btrim(coalesce(input_event_payload #>> '{data,email}', '')));
    suppression_origin := lower(btrim(coalesce(input_event_payload #>> '{data,origin}', 'provider')));
    if suppression_email !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
      raise exception 'Suppression email address is invalid.';
    end if;
    suppression_reason := case suppression_origin
      when 'bounce' then 'bounce'
      when 'complaint' then 'complaint'
      when 'manual' then 'manual'
      else 'provider'
    end;

    insert into public.communications_email_suppressions (
      workspace_id, subscriber_id, email, reason, status, provider,
      source_event_id, metadata, first_suppressed_at, last_event_at, removed_at
    ) values (
      null, null, suppression_email, suppression_reason,
      case when normalized_event_type = 'suppression.added' then 'active' else 'removed' end,
      'resend', normalized_svix_id,
      jsonb_build_object('event_type', normalized_event_type, 'origin', suppression_origin),
      input_occurred_at, input_occurred_at,
      case when normalized_event_type = 'suppression.removed' then input_occurred_at else null end
    )
    on conflict (email) where workspace_id is null do update
    set reason = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.reason
          else communications_email_suppressions.reason
        end,
        status = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.status
          else communications_email_suppressions.status
        end,
        source_event_id = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.source_event_id
          else communications_email_suppressions.source_event_id
        end,
        metadata = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.metadata
          else communications_email_suppressions.metadata
        end,
        first_suppressed_at = least(
          excluded.first_suppressed_at,
          communications_email_suppressions.first_suppressed_at
        ),
        last_event_at = greatest(
          excluded.last_event_at,
          communications_email_suppressions.last_event_at
        ),
        removed_at = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.removed_at
          else communications_email_suppressions.removed_at
        end
    returning status, source_event_id
    into suppression_status, suppression_source_event_id;

    suppression_state_applied := suppression_source_event_id = normalized_svix_id;

    if normalized_event_type = 'suppression.removed' and suppression_state_applied then
      update public.communications_email_suppressions
      set status = 'removed',
          source_event_id = normalized_svix_id,
          metadata = jsonb_build_object('event_type', normalized_event_type, 'origin', suppression_origin),
          last_event_at = input_occurred_at,
          removed_at = input_occurred_at
      where email = suppression_email
        and input_occurred_at >= last_event_at;
      get diagnostics affected_suppressions = row_count;
    else
      select count(*)::integer into affected_suppressions
      from public.communications_email_suppressions
      where email = suppression_email and status = 'active';
    end if;

    operation_result := jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'processed', true,
      'suppression_email', suppression_email,
      'suppression_status', suppression_status,
      'status_applied', suppression_state_applied,
      'affected_suppressions', affected_suppressions
    );
    insert into public.communications_resend_webhook_events (
      svix_id, event_type, payload_hash, event_payload,
      processing_status, result, occurred_at
    ) values (
      normalized_svix_id, normalized_event_type, input_payload_hash,
      input_event_payload, 'processed', operation_result, input_occurred_at
    );
    insert into public.communications_provider_audit_log (
      provider, action, identity_snapshot, details
    ) values (
      'resend',
      case when normalized_event_type = 'suppression.added'
        then 'suppression_added'
        else 'suppression_removed'
      end,
      jsonb_build_object('email', suppression_email),
      jsonb_build_object(
        'svix_id', normalized_svix_id,
        'origin', suppression_origin,
        'status_applied', suppression_state_applied,
        'affected_suppressions', affected_suppressions,
        'payload_hash', input_payload_hash
      )
    );
    return operation_result;
  end if;

  if normalized_provider_id is not null then
    select * into target_request
    from public.communications_email_delivery_requests
    where provider_message_id = normalized_provider_id
    for update;
  end if;

  if target_request.id is null then
    operation_result := jsonb_build_object(
      'ok', true,
      'duplicate', false,
      'processed', false,
      'reason', 'unknown_provider_message'
    );
    insert into public.communications_resend_webhook_events (
      svix_id, event_type, provider_message_id, payload_hash, event_payload,
      processing_status, result, occurred_at
    ) values (
      normalized_svix_id, normalized_event_type, normalized_provider_id,
      input_payload_hash, input_event_payload, 'ignored', operation_result, input_occurred_at
    );
    insert into public.communications_provider_audit_log (
      provider, action, provider_message_id, identity_snapshot, details
    ) values (
      'resend', 'webhook_ignored', normalized_provider_id,
      jsonb_build_object('svix_id', normalized_svix_id, 'event_type', normalized_event_type),
      jsonb_build_object('reason', 'unknown_provider_message', 'payload_hash', input_payload_hash)
    );
    return operation_result;
  end if;

  mapped_status := case normalized_event_type
    when 'email.scheduled' then 'scheduled'
    when 'email.sent' then 'sent'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delivery_delayed'
    when 'email.failed' then 'failed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.suppressed' then 'suppressed'
    else null
  end;
  suppression_reason := case normalized_event_type
    when 'email.bounced' then 'bounce'
    when 'email.complained' then 'complaint'
    when 'email.suppressed' then 'provider'
    else null
  end;

  if mapped_status is not null
     and (
       target_request.provider_status_at is null
       or input_occurred_at >= target_request.provider_status_at
     ) then
    update public.communications_email_delivery_requests
    set status = mapped_status,
        provider_status_at = input_occurred_at,
        retryable = false,
        last_error = case when mapped_status = 'failed'
          then left(coalesce(input_event_payload #>> '{data,failed,reason}', 'Resend reported delivery failure.'), 1000)
          else null end
    where id = target_request.id
    returning * into target_request;

    update public.communications_message_events
    set status = mapped_status,
        occurred_at = input_occurred_at
    where provider_message_id = target_request.provider_message_id;

    status_applied := true;
  end if;

  if suppression_reason is not null then
    insert into public.communications_email_suppressions (
      workspace_id, subscriber_id, email, reason, status, provider,
      provider_message_id, source_event_id, metadata, first_suppressed_at, last_event_at
    ) values (
      target_request.workspace_id, target_request.subscriber_id, target_request.to_address,
      suppression_reason, 'active', 'resend', target_request.provider_message_id,
      normalized_svix_id, jsonb_build_object('event_type', normalized_event_type),
      input_occurred_at, input_occurred_at
    )
    on conflict (workspace_id, email) where workspace_id is not null do update
    set subscriber_id = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.subscriber_id
          else communications_email_suppressions.subscriber_id
        end,
        reason = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.reason
          else communications_email_suppressions.reason
        end,
        status = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then 'active'
          else communications_email_suppressions.status
        end,
        provider_message_id = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.provider_message_id
          else communications_email_suppressions.provider_message_id
        end,
        source_event_id = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.source_event_id
          else communications_email_suppressions.source_event_id
        end,
        metadata = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then excluded.metadata
          else communications_email_suppressions.metadata
        end,
        first_suppressed_at = least(
          excluded.first_suppressed_at,
          communications_email_suppressions.first_suppressed_at
        ),
        last_event_at = greatest(
          excluded.last_event_at,
          communications_email_suppressions.last_event_at
        ),
        removed_at = case
          when excluded.last_event_at >= communications_email_suppressions.last_event_at
            then null
          else communications_email_suppressions.removed_at
        end
    returning source_event_id = normalized_svix_id
    into suppression_state_applied;

    insert into public.communications_provider_audit_log (
      workspace_id, delivery_request_id, provider, action, idempotency_key,
      provider_message_id, identity_snapshot, details
    ) values (
      target_request.workspace_id, target_request.id, 'resend',
      case when suppression_state_applied then 'suppression_applied' else 'suppression_ignored_stale' end,
      target_request.idempotency_key, target_request.provider_message_id,
      jsonb_build_object(
        'workspace_id', target_request.workspace_id,
        'subscriber_id', target_request.subscriber_id,
        'email', target_request.to_address
      ),
      jsonb_build_object(
        'reason', suppression_reason,
        'svix_id', normalized_svix_id,
        'status_applied', suppression_state_applied
      )
    );
  end if;

  operation_result := jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'processed', true,
    'workspace_id', target_request.workspace_id,
    'request_id', target_request.id,
    'status', target_request.status,
    'event_status', mapped_status,
    'status_applied', status_applied,
    'suppressed', suppression_reason is not null,
    'suppression_applied', suppression_state_applied
  );

  insert into public.communications_resend_webhook_events (
    svix_id, event_type, provider_message_id, workspace_id, delivery_request_id,
    payload_hash, event_payload, processing_status, result, occurred_at
  ) values (
    normalized_svix_id, normalized_event_type, target_request.provider_message_id,
    target_request.workspace_id, target_request.id, input_payload_hash,
    input_event_payload, 'processed', operation_result, input_occurred_at
  );
  insert into public.communications_provider_audit_log (
    workspace_id, delivery_request_id, provider, action, idempotency_key,
    provider_message_id, identity_snapshot, details
  ) values (
    target_request.workspace_id, target_request.id, 'resend', 'webhook_processed',
    target_request.idempotency_key, target_request.provider_message_id,
    jsonb_build_object('svix_id', normalized_svix_id, 'event_type', normalized_event_type),
    jsonb_build_object(
      'status', target_request.status,
      'event_status', mapped_status,
      'status_applied', status_applied,
      'payload_hash', input_payload_hash
    )
  );

  return operation_result;
end;
$$;

revoke all on function public.communications_prepare_resend_delivery(uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.communications_claim_resend_delivery(uuid)
  from public, anon, authenticated;
revoke all on function public.communications_record_resend_delivery_result(uuid, boolean, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.communications_process_resend_webhook(text, text, text, text, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.communications_prepare_resend_delivery(uuid, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.communications_claim_resend_delivery(uuid)
  to service_role;
grant execute on function public.communications_record_resend_delivery_result(uuid, boolean, text, text, boolean)
  to service_role;
grant execute on function public.communications_process_resend_webhook(text, text, text, text, jsonb, timestamptz)
  to service_role;

comment on table public.communications_email_delivery_requests is
  'Server-only Resend delivery state with permanent workspace-scoped idempotency and no message body storage.';
comment on table public.communications_email_suppressions is
  'Tenant-attributed email suppressions derived from provider bounce, complaint, suppression, or trusted manual actions.';
comment on table public.communications_resend_webhook_events is
  'Immutable, signature-verified Resend webhook receipt history deduplicated by svix-id.';
comment on table public.communications_provider_audit_log is
  'Permanently append-only audit records for trusted Communications provider operations.';
comment on function public.communications_prepare_resend_delivery(uuid, uuid, text, text, text, text, text) is
  'Atomically enforces channel activation, verified domain, consent, suppression, and permanent idempotency before Resend delivery.';
comment on function public.communications_claim_resend_delivery(uuid) is
  'Atomically claims one prepared or safely retryable Resend delivery and prevents concurrent sends.';
comment on function public.communications_record_resend_delivery_result(uuid, boolean, text, text, boolean) is
  'Records Resend acceptance or failure without storing provider credentials or message bodies.';
comment on function public.communications_process_resend_webhook(text, text, text, text, jsonb, timestamptz) is
  'Atomically deduplicates verified Resend events, reconciles delivery state, applies suppressions, and writes provider audit history.';
