begin;

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, email_change, email_change_token_new, recovery_token
) values
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', '10000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'member@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now(), '', '', '', '');

insert into public.platform_admins (user_id, email, role, status)
values ('10000000-0000-4000-8000-000000000001', 'admin@example.test', 'owner', 'active');

insert into public.organizations (id, name, slug, owner_user_id)
values
  ('20000000-0000-4000-8000-000000000001', 'Alpha Test', 'alpha-test', '10000000-0000-4000-8000-000000000001'),
  ('20000000-0000-4000-8000-000000000002', 'Beta Test', 'beta-test', '10000000-0000-4000-8000-000000000002');

insert into public.communications_workspaces (
  id, organization_id, slug, program_name, sender_name, website_url,
  privacy_policy_url, program_terms_url, support_email, expected_message_frequency
) values
  ('30000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'alpha-comms', 'Alpha Communications', 'Alpha Test', 'https://alpha.example.test', 'https://alpha.example.test/privacy', 'https://alpha.example.test/terms', 'support@alpha.example.test', 'Up to four emails per month.'),
  ('30000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'beta-comms', 'Beta Communications', 'Beta Test', 'https://beta.example.test', 'https://beta.example.test/privacy', 'https://beta.example.test/terms', 'support@beta.example.test', 'Up to four emails per month.');

insert into public.communications_channels (workspace_id, channel, status)
values
  ('30000000-0000-4000-8000-000000000001', 'email', 'pending_verification'),
  ('30000000-0000-4000-8000-000000000001', 'sms', 'pending_setup'),
  ('30000000-0000-4000-8000-000000000002', 'email', 'pending_verification'),
  ('30000000-0000-4000-8000-000000000002', 'sms', 'pending_setup');

do $$
begin
  if pg_catalog.has_function_privilege('anon', 'public.communications_admin_record_resend_domain(uuid,uuid,uuid,text,text,text)', 'execute') then
    raise exception 'anon must not execute Resend domain recording';
  end if;
  if pg_catalog.has_function_privilege('authenticated', 'public.communications_admin_activate_resend_email(uuid,uuid,uuid,text)', 'execute') then
    raise exception 'authenticated must not execute Resend activation';
  end if;
  if not pg_catalog.has_function_privilege('service_role', 'public.communications_admin_record_resend_domain(uuid,uuid,uuid,text,text,text)', 'execute') then
    raise exception 'service_role must execute Resend domain recording';
  end if;
end;
$$;

set local role service_role;

select public.communications_admin_record_resend_domain(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000001',
  'updates.alpha.example.test',
  'resend-domain-alpha',
  'verified'
);

do $$
begin
  if not exists (
    select 1 from public.communications_sending_domains
    where workspace_id = '30000000-0000-4000-8000-000000000001'
      and domain = 'updates.alpha.example.test'
      and provider = 'resend'
      and provider_domain_id = 'resend-domain-alpha'
      and status = 'verified'
  ) then
    raise exception 'verified Alpha domain was not recorded';
  end if;
  if not exists (
    select 1 from public.communications_channels
    where workspace_id = '30000000-0000-4000-8000-000000000001'
      and channel = 'email' and status = 'pending_verification'
  ) then
    raise exception 'domain verification must not implicitly activate email';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.communications_admin_record_resend_domain(
      '10000000-0000-4000-8000-000000000002',
      '40000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      'updates.beta.example.test',
      'resend-domain-beta',
      'verified'
    );
    raise exception 'non-admin actor unexpectedly recorded a domain';
  exception when others then
    if sqlerrm = 'non-admin actor unexpectedly recorded a domain' then raise; end if;
  end;
end;
$$;

select public.communications_admin_activate_resend_email(
  '10000000-0000-4000-8000-000000000001',
  '40000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000001',
  'resend-domain-alpha'
);

do $$
begin
  if not exists (
    select 1 from public.communications_workspaces
    where id = '30000000-0000-4000-8000-000000000001' and status = 'active'
  ) then raise exception 'Alpha workspace was not activated'; end if;
  if not exists (
    select 1 from public.communications_channels
    where workspace_id = '30000000-0000-4000-8000-000000000001'
      and channel = 'email' and status = 'active'
  ) then raise exception 'Alpha email channel was not activated'; end if;
  if exists (
    select 1 from public.communications_workspaces
    where id = '30000000-0000-4000-8000-000000000002' and status = 'active'
  ) then raise exception 'Beta workspace changed during Alpha activation'; end if;
  if (select count(*) from public.communications_provider_audit_log
      where workspace_id = '30000000-0000-4000-8000-000000000001'
        and action in ('domain_recorded', 'email_activated')) <> 2 then
    raise exception 'expected immutable provider audit records were not written';
  end if;
end;
$$;

do $$
begin
  begin
    perform public.communications_admin_activate_resend_email(
      '10000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000002',
      'resend-domain-alpha'
    );
    raise exception 'cross-tenant domain activation unexpectedly succeeded';
  exception when others then
    if sqlerrm = 'cross-tenant domain activation unexpectedly succeeded' then raise; end if;
  end;
end;
$$;

reset role;
rollback;
