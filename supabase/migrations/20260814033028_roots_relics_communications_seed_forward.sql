-- Forward-only Roots & Relics ownership and Communications setup.
-- Abort rather than infer identity when website, owner, or organization matches are ambiguous.
do $$
declare
  target_website public.client_websites%rowtype;
  target_owner_user_id uuid;
  target_owner_name text;
  target_owner_email text;
  target_organization public.organizations%rowtype;
  target_workspace public.communications_workspaces%rowtype;
  target_form public.website_forms%rowtype;
  match_count integer;
begin
  select count(*) into match_count
  from public.client_websites website
  where website.slug = 'roots-and-relics-be7315'
     or lower(trim(website.name)) = 'roots and relics';
  if match_count = 0 then
    raise notice 'Roots & Relics website is absent; skipping customer seed in this data-free environment.';
    return;
  end if;
  if match_count <> 1 then
    raise exception 'Roots & Relics migration expected exactly one website, found %.', match_count;
  end if;

  select * into target_website
  from public.client_websites website
  where website.slug = 'roots-and-relics-be7315'
     or lower(trim(website.name)) = 'roots and relics'
  limit 1;

  select count(*) into match_count
  from public.website_members website_member
  where website_member.website_id = target_website.id
    and website_member.role = 'owner'
    and website_member.status = 'active';
  if match_count <> 1 then
    raise exception 'Roots & Relics migration expected exactly one active website owner, found %.', match_count;
  end if;

  select website_member.user_id, profile.full_name, profile.email
  into target_owner_user_id, target_owner_name, target_owner_email
  from public.website_members website_member
  left join public.profiles profile on profile.id = website_member.user_id
  where website_member.website_id = target_website.id
    and website_member.role = 'owner'
    and website_member.status = 'active'
  limit 1;

  if target_owner_user_id is null
     or not (
       lower(coalesce(target_owner_name, '')) like 'jennifer%'
       or lower(coalesce(target_owner_email, '')) = 'rootsandrelics.greenhouse@gmail.com'
     ) then
    raise exception 'Roots & Relics active owner could not be unambiguously identified as Jennifer.';
  end if;
  if target_owner_email is null
     or target_owner_email !~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$' then
    raise exception 'Roots & Relics owner must have a valid support email.';
  end if;

  select count(*) into match_count
  from public.organizations organization_record
  where organization_record.slug = 'roots-and-relics'
     or lower(trim(organization_record.name)) = 'roots & relics';
  if match_count > 1 then
    raise exception 'Roots & Relics migration found multiple possible organizations.';
  end if;

  if match_count = 0 then
    insert into public.organizations (name, slug, owner_user_id)
    values ('Roots & Relics', 'roots-and-relics', target_owner_user_id)
    returning * into target_organization;
  else
    select * into target_organization
    from public.organizations organization_record
    where organization_record.slug = 'roots-and-relics'
       or lower(trim(organization_record.name)) = 'roots & relics'
    limit 1;
    if target_organization.owner_user_id <> target_owner_user_id then
      raise exception 'Existing Roots & Relics organization has a different owner.';
    end if;
  end if;

  insert into public.organization_memberships (organization_id, user_id, role, created_by)
  values (target_organization.id, target_owner_user_id, 'account_admin', target_owner_user_id)
  on conflict (organization_id, user_id) do update
  set role = 'account_admin', updated_at = now();

  if target_website.organization_id is not null
     and target_website.organization_id <> target_organization.id then
    raise exception 'Roots & Relics website is already linked to another organization.';
  end if;
  update public.client_websites
  set organization_id = target_organization.id, updated_at = now()
  where id = target_website.id;

  insert into public.organization_product_entitlements (
    organization_id, product_key, status, portal_enabled, source, starts_at, metadata
  ) values (
    target_organization.id, 'communications', 'active', true, 'manual', now(),
    jsonb_build_object('pilot', true, 'workspace_slug', 'roots-and-relics')
  )
  on conflict (organization_id, product_key) do update
  set status = 'active', portal_enabled = true, source = 'manual', ends_at = null,
      metadata = excluded.metadata, updated_at = now();

  insert into public.communications_workspaces (
    organization_id, slug, program_name, sender_name, website_url,
    privacy_policy_url, program_terms_url, support_email,
    expected_message_frequency, status
  ) values (
    target_organization.id,
    'roots-and-relics',
    'Roots & Relics Updates',
    'Roots & Relics',
    'https://www.rootsandrelicsgreenhouse.com/',
    'https://www.rootsandrelicsgreenhouse.com/privacy',
    'https://n3xra.com/nexra-communications/terms/?workspace=roots-and-relics',
    target_owner_email,
    'Message frequency varies based on the updates you select.',
    'active'
  )
  on conflict (slug) do update
  set program_name = excluded.program_name,
      sender_name = excluded.sender_name,
      website_url = excluded.website_url,
      privacy_policy_url = excluded.privacy_policy_url,
      program_terms_url = excluded.program_terms_url,
      support_email = excluded.support_email,
      expected_message_frequency = excluded.expected_message_frequency,
      updated_at = now()
  returning * into target_workspace;

  if target_workspace.organization_id <> target_organization.id then
    raise exception 'Existing Roots & Relics Communications workspace belongs to another organization.';
  end if;

  insert into public.communications_workspace_websites (workspace_id, website_id, organization_id, status)
  values (target_workspace.id, target_website.id, target_organization.id, 'active')
  on conflict (workspace_id, website_id) do update set status = 'active';

  insert into public.communications_channels (workspace_id, channel, status)
  values
    (target_workspace.id, 'sms', 'pending_setup'),
    (target_workspace.id, 'email', 'pending_verification')
  on conflict (workspace_id, channel) do update
  set status = excluded.status, updated_at = now();

  insert into public.communications_topics (workspace_id, slug, name, description, sort_order)
  values
    (target_workspace.id, 'general-updates', 'General updates', 'Store news and important Roots & Relics announcements.', 10),
    (target_workspace.id, 'plants-and-products', 'Plants and products', 'Availability and seasonal greenhouse updates.', 20),
    (target_workspace.id, 'events-and-workshops', 'Events and workshops', 'Upcoming events, workshops, and community activities.', 30)
  on conflict (workspace_id, slug) do update
  set name = excluded.name, description = excluded.description,
      sort_order = excluded.sort_order, active = true, updated_at = now();

  insert into public.website_forms (
    organization_id, website_id, communications_workspace_id, name, form_type,
    status, success_message, allowed_origins, active_consent_configuration
  ) values (
    target_organization.id,
    target_website.id,
    target_workspace.id,
    'Roots & Relics subscriber signup',
    'subscription',
    'active',
    'Your Roots & Relics preferences are saved.',
    array[
      'https://n3xra.com',
      'https://www.n3xra.com',
      'https://rootsandrelicsgreenhouse.com',
      'https://www.rootsandrelicsgreenhouse.com'
    ],
    jsonb_build_object(
      'sms', jsonb_build_object(
        'version', 'roots-and-relics-sms-2026-08-14',
        'disclosure', 'By selecting text messages and submitting, I agree to receive recurring automated informational text messages from Roots & Relics. Message frequency varies based on the updates you select. Message and data rates may apply. Reply STOP to opt out or HELP for help. Consent is not a condition of purchase.',
        'checkbox_label', 'Text messages'
      ),
      'email', jsonb_build_object(
        'version', 'roots-and-relics-email-2026-08-14',
        'disclosure', 'By selecting email and submitting, I agree to receive email updates from Roots & Relics. I can unsubscribe at any time.',
        'checkbox_label', 'Email updates'
      )
    )
  )
  on conflict (communications_workspace_id, name) do update
  set website_id = excluded.website_id,
      organization_id = excluded.organization_id,
      status = excluded.status,
      success_message = excluded.success_message,
      allowed_origins = excluded.allowed_origins,
      active_consent_configuration = excluded.active_consent_configuration,
      updated_at = now()
  returning * into target_form;

  insert into public.website_form_fields (
    form_id, field_key, field_type, label, placeholder, required, sort_order, contact_field_mapping
  ) values
    (target_form.id, 'full_name', 'text', 'Name', null, false, 10, 'full_name'),
    (target_form.id, 'phone', 'phone', 'Mobile phone', '(541) 555-0138', false, 20, 'phone_e164'),
    (target_form.id, 'email', 'email', 'Email address', null, false, 30, 'email')
  on conflict (form_id, field_key) do update
  set field_type = excluded.field_type, label = excluded.label,
      placeholder = excluded.placeholder, required = excluded.required,
      sort_order = excluded.sort_order, contact_field_mapping = excluded.contact_field_mapping,
      updated_at = now();

  insert into public.website_form_actions (form_id, action_type, sort_order)
  values
    (target_form.id, 'save_submission', 10),
    (target_form.id, 'upsert_communications_subscriber', 20),
    (target_form.id, 'subscribe_email', 30),
    (target_form.id, 'subscribe_sms', 40),
    (target_form.id, 'record_consent', 50),
    (target_form.id, 'save_topics', 60)
  on conflict (form_id, action_type) do update
  set status = 'active', sort_order = excluded.sort_order, updated_at = now();

  insert into public.communications_signup_sources (
    organization_id, website_id, workspace_id, form_id, source_type, name, slug, status
  ) values
    (target_organization.id, target_website.id, target_workspace.id, target_form.id,
      'hosted_signup', 'Hosted subscriber signup', 'hosted-signup', 'active'),
    (target_organization.id, target_website.id, target_workspace.id, target_form.id,
      'website_embed', 'Roots & Relics website signup', 'website-signup', 'active'),
    (target_organization.id, target_website.id, target_workspace.id, target_form.id,
      'qr_campaign', 'Primary signup QR code', 'primary-qr', 'active')
  on conflict (form_id, slug) do update
  set source_type = excluded.source_type, name = excluded.name, status = 'active', updated_at = now();
end;
$$;
