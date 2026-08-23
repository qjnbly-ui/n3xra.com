begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'alpha-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '11000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'beta-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.organizations (id, name, slug, owner_user_id)
values
  ('21000000-0000-4000-8000-000000000001', 'Alpha Signup Test', 'alpha-signup-test', '11000000-0000-4000-8000-000000000001'),
  ('21000000-0000-4000-8000-000000000002', 'Beta Signup Test', 'beta-signup-test', '11000000-0000-4000-8000-000000000002');

insert into public.client_websites (id, organization_id, name, slug, portal_slug, live_url, status, created_by_user_id)
values
  ('31000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'Alpha Website', 'alpha-signup-site', 'alpha-signup-portal', 'https://alpha.example.test', 'active', '11000000-0000-4000-8000-000000000001'),
  ('31000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'Beta Website', 'beta-signup-site', 'beta-signup-portal', 'https://beta.example.test', 'active', '11000000-0000-4000-8000-000000000002');

insert into public.communications_workspaces (
  id, organization_id, slug, program_name, sender_name, website_url,
  privacy_policy_url, program_terms_url, support_email, expected_message_frequency, status
) values
  ('41000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', 'alpha-pre-delivery', 'Alpha Updates', 'Alpha', 'https://alpha.example.test', 'https://alpha.example.test/privacy', 'https://alpha.example.test/terms', 'support@alpha.example.test', 'Monthly.', 'setup'),
  ('41000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000002', 'beta-pre-delivery', 'Beta Updates', 'Beta', 'https://beta.example.test', 'https://beta.example.test/privacy', 'https://beta.example.test/terms', 'support@beta.example.test', 'Monthly.', 'setup');

insert into public.communications_channels (workspace_id, channel, status)
values
  ('41000000-0000-4000-8000-000000000001', 'email', 'pending_verification'),
  ('41000000-0000-4000-8000-000000000001', 'sms', 'pending_setup'),
  ('41000000-0000-4000-8000-000000000002', 'email', 'pending_verification'),
  ('41000000-0000-4000-8000-000000000002', 'sms', 'pending_setup');

insert into public.communications_topics (id, workspace_id, slug, name, active, sort_order)
values
  ('51000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', 'general-updates', 'General updates', true, 10),
  ('51000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', 'general-updates', 'General updates', true, 10);

insert into public.website_forms (
  id, public_id, organization_id, website_id, communications_workspace_id,
  name, form_type, status, success_message, allowed_origins, active_consent_configuration
) values
  (
    '61000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001',
    '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001', 'Alpha signup', 'subscription', 'active',
    'Preferences saved.', array['https://alpha.example.test'],
    '{"email":{"version":"alpha-email-v1","disclosure":"Exact Alpha email consent.","checkbox_label":"Email updates"},"sms":{"version":"alpha-sms-v1","disclosure":"Exact Alpha SMS consent.","checkbox_label":"Text updates"}}'
  ),
  (
    '61000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002',
    '21000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002',
    '41000000-0000-4000-8000-000000000002', 'Beta signup', 'subscription', 'active',
    'Preferences saved.', array['https://beta.example.test'],
    '{"email":{"version":"beta-email-v1","disclosure":"Exact Beta email consent.","checkbox_label":"Email updates"}}'
  );

insert into public.website_form_fields (
  form_id, field_key, field_type, label, required, sort_order, contact_field_mapping
) values
  ('61000000-0000-4000-8000-000000000001', 'full_name', 'text', 'Name', false, 10, 'full_name'),
  ('61000000-0000-4000-8000-000000000001', 'email', 'email', 'Email', true, 20, 'email'),
  ('61000000-0000-4000-8000-000000000001', 'phone', 'phone', 'Phone', false, 30, 'phone_e164'),
  ('61000000-0000-4000-8000-000000000002', 'email', 'email', 'Email', true, 10, 'email');

insert into public.communications_signup_sources (
  id, organization_id, website_id, workspace_id, form_id, source_type, name, slug, public_token, status
) values
  ('81000000-0000-4000-8000-000000000001', '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'website_embed', 'Alpha website', 'website', 'alpha-website-test-token-000001', 'active'),
  ('81000000-0000-4000-8000-000000000002', '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'hosted_signup', 'Alpha hosted', 'hosted', 'alpha-hosted-test-token-000002', 'active'),
  ('81000000-0000-4000-8000-000000000003', '21000000-0000-4000-8000-000000000002', '31000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000002', '61000000-0000-4000-8000-000000000002', 'website_embed', 'Beta website', 'website', 'beta-website-test-token-000003', 'active'),
  ('81000000-0000-4000-8000-000000000004', '21000000-0000-4000-8000-000000000001', '31000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000001', '61000000-0000-4000-8000-000000000001', 'qr_campaign', 'Alpha QR', 'qr', 'alpha-qr-test-token-000004', 'active');

do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.ingest_website_form_submission(uuid,text,text,text,text,jsonb,uuid[],text[],jsonb,text,text,boolean)', 'execute') then
    raise exception 'anon must not execute website form ingestion directly';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.ingest_website_form_submission(uuid,text,text,text,text,jsonb,uuid[],text[],jsonb,text,text,boolean)', 'execute') then
    raise exception 'authenticated must not execute website form ingestion directly';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.ingest_website_form_submission(uuid,text,text,text,text,jsonb,uuid[],text[],jsonb,text,text,boolean)', 'execute') then
    raise exception 'service_role must execute website form ingestion';
  end if;
end;
$$;

set local role service_role;

select public.ingest_website_form_submission(
  '71000000-0000-4000-8000-000000000001', 'alpha-website-test-token-000001',
  'alpha-email-submission-000001', 'https://alpha.example.test', 'https://alpha.example.test/join',
  '{"full_name":"Test Subscriber","email":"subscriber@example.test"}',
  array['51000000-0000-4000-8000-000000000001']::uuid[], array['email'],
  '{"email":"alpha-email-v1"}', repeat('a', 64), 'Communications integration test', false
);

select public.ingest_website_form_submission(
  '71000000-0000-4000-8000-000000000001', 'alpha-qr-test-token-000004',
  'qr-email-submission-000001', 'https://www.n3xra.com', 'https://www.n3xra.com/nexra-communications/subscribe/',
  '{"email":"qr@example.test"}', array['51000000-0000-4000-8000-000000000001']::uuid[], array['email'],
  '{"email":"alpha-email-v1"}', repeat('1', 64), 'Communications QR integration test', false
);

do $$
begin
  if not exists (
    select 1
    from public.website_form_submissions submission
    join public.communications_subscribers subscriber on subscriber.id = submission.subscriber_id
    join public.communications_consent_events consent on consent.form_submission_id = submission.id
    where submission.idempotency_key = 'alpha-email-submission-000001'
      and submission.organization_id = '21000000-0000-4000-8000-000000000001'
      and submission.workspace_id = '41000000-0000-4000-8000-000000000001'
      and submission.verified_signup_source_id = '81000000-0000-4000-8000-000000000001'
      and subscriber.workspace_id = submission.workspace_id
      and subscriber.email_status = 'subscribed'
      and subscriber.sms_status = 'not_requested'
      and consent.channel = 'email'
      and consent.consent_method = 'website_embed'
      and consent.disclosure_version = 'alpha-email-v1'
      and consent.disclosure_text = 'Exact Alpha email consent.'
      and consent.checkbox_label = 'Email updates'
      and consent.consent_snapshot ->> 'disclosure_text' = 'Exact Alpha email consent.'
  ) then
    raise exception 'email signup did not preserve tenant ownership, source attribution, independent preferences, and exact consent';
  end if;
  if exists (
    select 1 from public.communications_subscribers
    where workspace_id = '41000000-0000-4000-8000-000000000002'
  ) then
    raise exception 'Alpha signup created data in the Beta tenant';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.ingest_website_form_submission(
      '71000000-0000-4000-8000-000000000001', 'beta-website-test-token-000003',
      'cross-tenant-attempt-000001', 'https://alpha.example.test', 'https://alpha.example.test/join',
      '{"email":"cross-tenant@example.test"}', '{}'::uuid[], array['email'],
      '{"email":"alpha-email-v1"}', repeat('b', 64), 'Communications integration test', false
    );
    raise exception 'cross-tenant source token unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant source token unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.ingest_website_form_submission(
      '71000000-0000-4000-8000-000000000001', 'alpha-website-test-token-000001',
      'disallowed-origin-000001', 'https://attacker.example.test', 'https://attacker.example.test/join',
      '{"email":"bad-origin@example.test"}', '{}'::uuid[], array['email'],
      '{"email":"alpha-email-v1"}', repeat('c', 64), 'Communications integration test', false
    );
    raise exception 'disallowed origin unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'disallowed origin unexpectedly succeeded' then raise; end if;
  end;

  begin
    perform public.ingest_website_form_submission(
      '71000000-0000-4000-8000-000000000001', 'alpha-website-test-token-000001',
      'pending-sms-attempt-000001', 'https://alpha.example.test', 'https://alpha.example.test/join',
      '{"phone":"+15415550123"}', '{}'::uuid[], array['sms'],
      '{"sms":"alpha-sms-v1"}', repeat('d', 64), 'Communications integration test', false
    );
    raise exception 'pending SMS channel unexpectedly accepted consent';
  exception when others then
    if sqlerrm = 'pending SMS channel unexpectedly accepted consent' then raise; end if;
  end;

  begin
    perform public.ingest_website_form_submission(
      '71000000-0000-4000-8000-000000000001', 'alpha-hosted-test-token-000002',
      'hosted-wrong-origin-000001', 'https://alpha.example.test', 'https://alpha.example.test/join',
      '{"email":"hosted-wrong@example.test"}', '{}'::uuid[], array['email'],
      '{"email":"alpha-email-v1"}', repeat('e', 64), 'Communications integration test', false
    );
    raise exception 'hosted source accepted a non-N3XRA origin';
  exception when others then
    if sqlerrm = 'hosted source accepted a non-N3XRA origin' then raise; end if;
  end;
end;
$$;

select public.ingest_website_form_submission(
  '71000000-0000-4000-8000-000000000001', 'alpha-hosted-test-token-000002',
  'hosted-email-submission-000001', 'https://www.n3xra.com', 'https://www.n3xra.com/nexra-communications/subscribe/',
  '{"email":"hosted@example.test"}', '{}'::uuid[], array['email'],
  '{"email":"alpha-email-v1"}', repeat('f', 64), 'Communications integration test', false
);

do $$
begin
  if not exists (
    select 1 from public.communications_consent_events
    where consent_method = 'hosted_signup'
      and verified_signup_source_id = '81000000-0000-4000-8000-000000000002'
      and disclosure_text = 'Exact Alpha email consent.'
  ) then
    raise exception 'hosted signup source did not preserve attribution and consent';
  end if;
  if not exists (
    select 1 from public.communications_consent_events
    where consent_method = 'qr_campaign'
      and verified_signup_source_id = '81000000-0000-4000-8000-000000000004'
      and disclosure_text = 'Exact Alpha email consent.'
  ) then
    raise exception 'QR signup source did not preserve attribution and consent';
  end if;
  if exists (
    select 1 from public.communications_email_delivery_requests
    where workspace_id = '41000000-0000-4000-8000-000000000001'
  ) then
    raise exception 'pre-delivery signup unexpectedly queued outbound email';
  end if;
end;
$$;

reset role;
rollback;
