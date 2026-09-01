-- Authenticated Communications editors may send the exact branded email to an
-- entered test inbox. Test sends retain provider audit/idempotency without
-- becoming subscriber activity or consuming broadcast usage.

alter table public.communications_email_delivery_requests
  add column delivery_kind text not null default 'broadcast';

alter table public.communications_email_delivery_requests
  add constraint communications_email_delivery_kind_check
  check (delivery_kind in ('broadcast', 'test'));

create index communications_email_delivery_test_rate_idx
  on public.communications_email_delivery_requests (workspace_id, created_at desc)
  where delivery_kind = 'test';

create or replace function public.communications_prepare_resend_test_delivery(
  input_workspace_id uuid,
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
  prior_request public.communications_email_delivery_requests%rowtype;
  target_request public.communications_email_delivery_requests%rowtype;
  normalized_from text := lower(btrim(coalesce(input_from_address, '')));
  normalized_to text := lower(btrim(coalesce(input_to_address, '')));
  normalized_key text := btrim(coalesce(input_idempotency_key, ''));
  normalized_subject text := btrim(coalesce(input_subject, ''));
  sender_domain text;
begin
  if input_workspace_id is null then raise exception 'Workspace is required.'; end if;
  if normalized_key !~ '^test/[0-9a-f-]{36}$' then raise exception 'Test delivery idempotency key is invalid.'; end if;
  if btrim(coalesce(input_payload_hash, '')) !~ '^[0-9a-f]{64}$' then raise exception 'Delivery payload hash is invalid.'; end if;
  if normalized_from !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
     or normalized_to !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Delivery addresses are invalid.';
  end if;
  if length(normalized_subject) not between 1 and 300 then raise exception 'Delivery subject is invalid.'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(input_workspace_id::text || ':' || normalized_key, 0)
  );
  select * into prior_request
  from public.communications_email_delivery_requests
  where workspace_id = input_workspace_id and idempotency_key = normalized_key
  for update;
  if found then
    if prior_request.payload_hash <> input_payload_hash or prior_request.delivery_kind <> 'test' then
      raise exception 'Delivery idempotency key was already used with different content.';
    end if;
    return jsonb_build_object(
      'ok', true, 'existing', true, 'request_id', prior_request.id,
      'status', prior_request.status, 'provider_message_id', prior_request.provider_message_id
    );
  end if;

  select * into target_workspace
  from public.communications_workspaces
  where id = input_workspace_id
  for share;
  if not found then raise exception 'Communications workspace not found.'; end if;
  if target_workspace.status <> 'active' then raise exception 'Communications workspace is not active.'; end if;
  if not exists (
    select 1 from public.communications_channels channel
    where channel.workspace_id = input_workspace_id and channel.channel = 'email' and channel.status = 'active'
  ) then raise exception 'Email channel is not active.'; end if;

  sender_domain := pg_catalog.split_part(normalized_from, '@', 2);
  if not exists (
    select 1 from public.communications_sending_domains domain
    where domain.workspace_id = input_workspace_id
      and lower(domain.domain) = sender_domain
      and domain.provider = 'resend'
      and domain.status = 'verified'
  ) then raise exception 'Resend sending domain is not verified.'; end if;
  if exists (
    select 1 from public.communications_email_suppressions suppression
    where suppression.email = normalized_to and suppression.status = 'active'
  ) then raise exception 'Test email address is suppressed.'; end if;
  if (
    select count(*) from public.communications_email_delivery_requests request
    where request.workspace_id = input_workspace_id
      and request.delivery_kind = 'test'
      and request.created_at > now() - interval '15 minutes'
  ) >= 5 then raise exception 'Wait before sending another test email.'; end if;

  insert into public.communications_email_delivery_requests (
    workspace_id, subscriber_id, idempotency_key, payload_hash,
    from_address, to_address, subject, delivery_kind
  ) values (
    input_workspace_id, null, normalized_key, input_payload_hash,
    normalized_from, normalized_to, normalized_subject, 'test'
  ) returning * into target_request;

  insert into public.communications_provider_audit_log (
    workspace_id, delivery_request_id, provider, action, idempotency_key,
    identity_snapshot, details
  ) values (
    target_workspace.id, target_request.id, 'resend', 'test_delivery_prepared', normalized_key,
    jsonb_build_object(
      'workspace', jsonb_build_object('id', target_workspace.id, 'organization_id', target_workspace.organization_id),
      'test_recipient', normalized_to
    ),
    jsonb_build_object('payload_hash', input_payload_hash, 'subject', normalized_subject)
  );

  return jsonb_build_object(
    'ok', true, 'existing', false, 'request_id', target_request.id,
    'status', target_request.status, 'provider_message_id', null
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
        'ok', true, 'existing', true, 'request_id', target_request.id,
        'status', target_request.status, 'provider_message_id', target_request.provider_message_id
      );
    end if;
    if target_request.status <> 'sending' then raise exception 'Email delivery request is not sending.'; end if;

    update public.communications_email_delivery_requests
    set status = 'sent', provider_message_id = normalized_provider_id,
        provider_status_at = now(), retryable = false, last_error = null
    where id = target_request.id
    returning * into target_request;

    if target_request.delivery_kind = 'broadcast' then
      insert into public.communications_message_events (
        workspace_id, subscriber_id, channel, direction, status,
        provider_message_id, from_address, to_address, body_preview,
        billable_units, occurred_at
      ) values (
        target_request.workspace_id, target_request.subscriber_id, 'email', 'outbound', 'sent',
        normalized_provider_id, target_request.from_address, target_request.to_address,
        left(target_request.subject, 500), 1, now()
      ) on conflict do nothing;
    end if;

    insert into public.communications_provider_audit_log (
      workspace_id, delivery_request_id, provider, action, idempotency_key,
      provider_message_id, identity_snapshot, details
    ) values (
      target_request.workspace_id, target_request.id, 'resend',
      case when target_request.delivery_kind = 'test' then 'test_delivery_accepted' else 'delivery_accepted' end,
      target_request.idempotency_key, normalized_provider_id,
      jsonb_build_object(
        'workspace_id', target_request.workspace_id,
        'subscriber_id', target_request.subscriber_id,
        'delivery_kind', target_request.delivery_kind,
        'to_address', target_request.to_address
      ),
      jsonb_build_object('attempt_count', target_request.attempt_count)
    );
  else
    if target_request.status <> 'sending' then
      return jsonb_build_object(
        'ok', true, 'existing', true, 'request_id', target_request.id,
        'status', target_request.status, 'provider_message_id', target_request.provider_message_id
      );
    end if;
    update public.communications_email_delivery_requests
    set status = 'failed',
        retryable = coalesce(input_retryable, false) and attempt_count < 5 and created_at > now() - interval '23 hours',
        last_error = coalesce(normalized_error, 'Resend delivery failed.')
    where id = target_request.id
    returning * into target_request;
    insert into public.communications_provider_audit_log (
      workspace_id, delivery_request_id, provider, action, idempotency_key,
      identity_snapshot, details
    ) values (
      target_request.workspace_id, target_request.id, 'resend',
      case when target_request.delivery_kind = 'test' then 'test_delivery_failed' else 'delivery_failed' end,
      target_request.idempotency_key,
      jsonb_build_object(
        'workspace_id', target_request.workspace_id,
        'subscriber_id', target_request.subscriber_id,
        'delivery_kind', target_request.delivery_kind,
        'to_address', target_request.to_address
      ),
      jsonb_build_object(
        'attempt_count', target_request.attempt_count,
        'retryable', target_request.retryable,
        'error', target_request.last_error
      )
    );
  end if;

  return jsonb_build_object(
    'ok', input_success, 'existing', false, 'request_id', target_request.id,
    'status', target_request.status, 'provider_message_id', target_request.provider_message_id,
    'retryable', target_request.retryable, 'delivery_kind', target_request.delivery_kind
  );
end;
$$;

revoke all on function public.communications_prepare_resend_test_delivery(uuid, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.communications_prepare_resend_test_delivery(uuid, text, text, text, text, text)
  to service_role;

comment on function public.communications_prepare_resend_test_delivery(uuid, text, text, text, text, text) is
  'Prepares a rate-limited, audited Resend test email without subscriber consent or usage accounting.';
