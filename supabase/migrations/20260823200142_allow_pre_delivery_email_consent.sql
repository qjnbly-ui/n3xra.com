-- Allow a verified subscription form to collect durable email consent while
-- outbound delivery is still waiting for provider-domain verification.
-- SMS remains unavailable until its channel is fully active.

create or replace function public.ingest_website_form_submission(
  input_form_public_id uuid,
  input_source_token text,
  input_idempotency_key text,
  input_origin text,
  input_source_page text,
  input_values jsonb,
  input_topic_ids uuid[],
  input_channels text[],
  input_consent_versions jsonb,
  input_ip_hash text,
  input_user_agent text,
  input_link_contact boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  target_form public.website_forms%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  target_source public.communications_signup_sources%rowtype;
  phone_subscriber public.communications_subscribers%rowtype;
  email_subscriber public.communications_subscribers%rowtype;
  target_subscriber public.communications_subscribers%rowtype;
  existing_submission_id uuid;
  target_submission_id uuid;
  target_contact_id uuid;
  normalized_origin text := lower(regexp_replace(trim(coalesce(input_origin, '')), '/+$', ''));
  normalized_source_page text := trim(coalesce(input_source_page, ''));
  normalized_email text;
  normalized_phone text;
  normalized_name text;
  selected_topic_ids uuid[] := coalesce(input_topic_ids, '{}'::uuid[]);
  selected_channels text[];
  required_field record;
  channel_name text;
  channel_configuration jsonb;
  previous_status text;
  event_kind text;
begin
  if jsonb_typeof(coalesce(input_values, '{}'::jsonb)) <> 'object' then
    raise exception 'Invalid form values.';
  end if;
  if length(trim(coalesce(input_idempotency_key, ''))) not between 16 and 200 then
    raise exception 'Invalid submission identifier.';
  end if;

  select * into target_form
  from public.website_forms
  where public_id = input_form_public_id and status = 'active'
  limit 1;
  if target_form.id is null then
    raise exception 'This form is unavailable.';
  end if;

  select * into target_source
  from public.communications_signup_sources
  where form_id = target_form.id
    and public_token = trim(coalesce(input_source_token, ''))
    and status = 'active'
  limit 1;
  if target_source.id is null then
    raise exception 'Signup source is invalid.';
  end if;
  if target_source.organization_id <> target_form.organization_id
     or target_source.website_id <> target_form.website_id
     or target_source.workspace_id is distinct from target_form.communications_workspace_id then
    raise exception 'Signup source does not belong to this form.';
  end if;

  if target_source.source_type = 'hosted_signup' then
    if normalized_origin not in ('https://n3xra.com', 'https://www.n3xra.com') then
      raise exception 'Submission origin is not allowed.';
    end if;
  elsif normalized_origin = '' or not (normalized_origin = any(target_form.allowed_origins)) then
    raise exception 'Submission origin is not allowed.';
  end if;
  if normalized_source_page <> normalized_origin
     and normalized_source_page not like normalized_origin || '/%' then
    raise exception 'Submission source page is not allowed.';
  end if;

  select id into existing_submission_id
  from public.website_form_submissions
  where form_id = target_form.id and idempotency_key = trim(input_idempotency_key)
  limit 1;
  if existing_submission_id is not null then
    return existing_submission_id;
  end if;

  for required_field in
    select field_key, label
    from public.website_form_fields
    where form_id = target_form.id and required
  loop
    if not (input_values ? required_field.field_key)
       or nullif(trim(input_values ->> required_field.field_key), '') is null then
      raise exception 'A required form field is missing: %.', required_field.label;
    end if;
  end loop;

  select nullif(trim(input_values ->> field_key), '') into normalized_name
  from public.website_form_fields
  where form_id = target_form.id and contact_field_mapping = 'full_name'
  order by sort_order limit 1;
  select nullif(lower(trim(input_values ->> field_key)), '') into normalized_email
  from public.website_form_fields
  where form_id = target_form.id and contact_field_mapping = 'email'
  order by sort_order limit 1;
  select nullif(regexp_replace(input_values ->> field_key, '[^0-9+]', '', 'g'), '') into normalized_phone
  from public.website_form_fields
  where form_id = target_form.id and contact_field_mapping = 'phone_e164'
  order by sort_order limit 1;

  if normalized_phone is not null and normalized_phone ~ '^[0-9]{10}$' then
    normalized_phone := '+1' || normalized_phone;
  elsif normalized_phone is not null and normalized_phone ~ '^1[0-9]{10}$' then
    normalized_phone := '+' || normalized_phone;
  end if;
  if normalized_email is not null and normalized_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Email address is invalid.';
  end if;
  if normalized_phone is not null and normalized_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Mobile number is invalid.';
  end if;

  select coalesce(array_agg(distinct lower(value)), '{}'::text[]) into selected_channels
  from unnest(coalesce(input_channels, '{}'::text[])) value
  where lower(value) in ('sms', 'email');
  if cardinality(selected_channels) <> cardinality(coalesce(input_channels, '{}'::text[])) then
    raise exception 'One or more selected channels are invalid.';
  end if;

  if target_form.form_type = 'subscription' then
    if target_form.communications_workspace_id is null then
      raise exception 'Subscription form has no Communications workspace.';
    end if;
    select * into target_workspace
    from public.communications_workspaces
    where id = target_form.communications_workspace_id and status in ('setup', 'active')
    limit 1;
    if target_workspace.id is null then
      raise exception 'Communications workspace is unavailable.';
    end if;
    if cardinality(selected_channels) = 0 then
      raise exception 'Choose email, text messages, or both.';
    end if;
    if 'email' = any(selected_channels) and normalized_email is null then
      raise exception 'Email address is required for email updates.';
    end if;
    if 'sms' = any(selected_channels) and normalized_phone is null then
      raise exception 'Mobile number is required for text updates.';
    end if;
    if exists (
      select 1 from unnest(selected_channels) selected_channel
      where not exists (
        select 1 from public.communications_channels channel_setting
        where channel_setting.workspace_id = target_workspace.id
          and channel_setting.channel = selected_channel
          and (
            (selected_channel = 'email' and channel_setting.status in ('pending_setup', 'pending_verification', 'active'))
            or (selected_channel = 'sms' and channel_setting.status = 'active')
          )
      )
    ) then
      raise exception 'A selected communication channel is unavailable.';
    end if;
    if exists (
      select 1 from unnest(selected_topic_ids) selected_topic_id
      where not exists (
        select 1 from public.communications_topics topic
        where topic.id = selected_topic_id
          and topic.workspace_id = target_workspace.id
          and topic.active
      )
    ) then
      raise exception 'One or more selected topics are invalid.';
    end if;
    foreach channel_name in array selected_channels loop
      channel_configuration := target_form.active_consent_configuration -> channel_name;
      if channel_configuration is null
         or nullif(channel_configuration ->> 'version', '') is null
         or nullif(channel_configuration ->> 'disclosure', '') is null
         or nullif(channel_configuration ->> 'checkbox_label', '') is null
         or input_consent_versions ->> channel_name is distinct from channel_configuration ->> 'version' then
        raise exception 'Consent configuration is invalid or outdated.';
      end if;
    end loop;
  end if;

  insert into public.website_form_submissions (
    organization_id, website_id, form_id, workspace_id, idempotency_key,
    original_values, verified_signup_source_id, source_page, request_origin, request_ip_hash, processing_status
  ) values (
    target_form.organization_id, target_form.website_id, target_form.id,
    target_form.communications_workspace_id, trim(input_idempotency_key), input_values,
    target_source.id, normalized_source_page, normalized_origin, input_ip_hash, 'processing'
  )
  on conflict (form_id, idempotency_key) do nothing
  returning id into target_submission_id;
  if target_submission_id is null then
    select id into target_submission_id
    from public.website_form_submissions
    where form_id = target_form.id and idempotency_key = trim(input_idempotency_key);
    return target_submission_id;
  end if;

  if target_form.form_type = 'subscription' then
    if normalized_phone is not null then
      select * into phone_subscriber from public.communications_subscribers
      where workspace_id = target_workspace.id and phone_e164 = normalized_phone limit 1;
    end if;
    if normalized_email is not null then
      select * into email_subscriber from public.communications_subscribers
      where workspace_id = target_workspace.id and lower(email) = normalized_email limit 1;
    end if;
    if phone_subscriber.id is not null and email_subscriber.id is not null
       and phone_subscriber.id <> email_subscriber.id then
      raise exception 'These contact details belong to separate subscriber records.';
    end if;
    if phone_subscriber.id is not null then
      target_subscriber := phone_subscriber;
    else
      target_subscriber := email_subscriber;
    end if;

    if input_link_contact and normalized_email is not null and normalized_name is not null then
      select id into target_contact_id
      from public.organization_contacts
      where organization_id = target_form.organization_id
        and lower(email) = normalized_email
        and lower(trim(full_name)) = lower(normalized_name)
      limit 1;
    end if;

    if target_subscriber.id is null then
      insert into public.communications_subscribers (
        workspace_id, organization_contact_id, full_name, phone_e164, email, sms_status, email_status
      ) values (
        target_workspace.id, target_contact_id, normalized_name, normalized_phone, normalized_email,
        case when 'sms' = any(selected_channels) then 'subscribed' else 'not_requested' end,
        case when 'email' = any(selected_channels) then 'subscribed' else 'not_requested' end
      ) returning * into target_subscriber;
    else
      update public.communications_subscribers
      set organization_contact_id = coalesce(organization_contact_id, target_contact_id),
          full_name = coalesce(normalized_name, full_name),
          phone_e164 = coalesce(normalized_phone, phone_e164),
          email = coalesce(normalized_email, email),
          sms_status = case when 'sms' = any(selected_channels) then 'subscribed' else sms_status end,
          email_status = case when 'email' = any(selected_channels) then 'subscribed' else email_status end,
          last_interaction_at = now()
      where id = target_subscriber.id
      returning * into target_subscriber;
    end if;

    delete from public.communications_subscriber_topics where subscriber_id = target_subscriber.id;
    insert into public.communications_subscriber_topics (subscriber_id, topic_id)
    select target_subscriber.id, selected_topic_id
    from unnest(selected_topic_ids) selected_topic_id
    on conflict do nothing;

    update public.website_form_submissions
    set subscriber_id = target_subscriber.id,
        contact_id = target_contact_id
    where id = target_submission_id;

    foreach channel_name in array selected_channels loop
      channel_configuration := target_form.active_consent_configuration -> channel_name;
      previous_status := case when channel_name = 'sms' then coalesce(phone_subscriber.sms_status, email_subscriber.sms_status, 'not_requested')
                              else coalesce(phone_subscriber.email_status, email_subscriber.email_status, 'not_requested') end;
      event_kind := case when previous_status = 'unsubscribed' then 'resubscribe'
                         when previous_status = 'subscribed' then 'preference_update'
                         else 'subscribe' end;
      insert into public.communications_consent_events (
        workspace_id, subscriber_id, channel, event_type, consent_method,
        verified_signup_source_id, disclosure_version, disclosure_text, checkbox_label,
        program_name, sender_name, message_frequency, privacy_policy_url,
        messaging_terms_url, topic_ids, form_submission_id, source_page, ip_hash,
        user_agent, consent_snapshot
      ) values (
        target_workspace.id, target_subscriber.id, channel_name, event_kind,
        target_source.source_type, target_source.id,
        channel_configuration ->> 'version', channel_configuration ->> 'disclosure',
        channel_configuration ->> 'checkbox_label', target_workspace.program_name,
        target_workspace.sender_name, target_workspace.expected_message_frequency,
        target_workspace.privacy_policy_url, target_workspace.program_terms_url,
        selected_topic_ids, target_submission_id, normalized_source_page,
        input_ip_hash, left(coalesce(input_user_agent, ''), 500),
        jsonb_build_object(
          'channel', channel_name,
          'event_type', event_kind,
          'consent_method', target_source.source_type,
          'verified_signup_source_id', target_source.id,
          'disclosure_version', channel_configuration ->> 'version',
          'disclosure_text', channel_configuration ->> 'disclosure',
          'checkbox_label', channel_configuration ->> 'checkbox_label',
          'program_name', target_workspace.program_name,
          'sender_name', target_workspace.sender_name,
          'message_frequency', target_workspace.expected_message_frequency,
          'privacy_policy_url', target_workspace.privacy_policy_url,
          'messaging_terms_url', target_workspace.program_terms_url,
          'topic_ids', to_jsonb(selected_topic_ids),
          'form_submission_id', target_submission_id,
          'source_page', normalized_source_page
        )
      );
    end loop;
  end if;

  insert into public.website_form_action_queue (organization_id, submission_id, form_action_id)
  select target_form.organization_id, target_submission_id, action.id
  from public.website_form_actions action
  where action.form_id = target_form.id
    and action.status = 'active'
    and action.action_type in ('notify_organization', 'queue_autoresponder', 'call_external_webhook')
  on conflict do nothing;

  update public.website_form_submissions
  set processing_status = 'processed', processed_at = now()
  where id = target_submission_id;
  return target_submission_id;
end;
$$;

revoke all on function public.ingest_website_form_submission(
  uuid, text, text, text, text, jsonb, uuid[], text[], jsonb, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.ingest_website_form_submission(
  uuid, text, text, text, text, jsonb, uuid[], text[], jsonb, text, text, boolean
) to service_role;

comment on function public.ingest_website_form_submission(
  uuid, text, text, text, text, jsonb, uuid[], text[], jsonb, text, text, boolean
) is 'Ingests universal website forms and permits email consent collection before provider delivery activation while preserving verified-source, origin, tenant, and exact-consent checks.';
