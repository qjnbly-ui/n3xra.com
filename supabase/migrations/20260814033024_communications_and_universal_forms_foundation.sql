-- Shared, multi-tenant website forms and N3XRA Communications foundation.
-- Public ingestion is server-only. Customer portal reads are organization-scoped by RLS.

create unique index if not exists client_websites_id_organization_uidx
  on public.client_websites (id, organization_id);
create unique index if not exists organization_contacts_id_organization_uidx
  on public.organization_contacts (id, organization_id);

create table public.communications_number_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete set null,
  website_id uuid,
  requester_user_id uuid references auth.users (id) on delete set null,
  organization_name text not null,
  website_url text not null,
  primary_contact_name text not null,
  primary_contact_email text not null,
  primary_contact_phone text,
  preferred_area_code text,
  intended_use text not null,
  estimated_subscriber_count integer,
  estimated_monthly_message_volume integer,
  requested_topics text[] not null default '{}'::text[],
  requested_keyword text,
  requested_channels text[] not null,
  example_messages text not null,
  privacy_policy_url text not null,
  terms_url text not null,
  status text not null default 'submitted',
  ip_hash text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (website_id, organization_id)
    references public.client_websites (id, organization_id) on delete set null,
  constraint communications_number_requests_website_owner_check
    check (website_id is null or organization_id is not null),
  constraint communications_number_requests_email_check
    check (primary_contact_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint communications_number_requests_urls_check
    check (website_url ~* '^https?://' and privacy_policy_url ~* '^https?://' and terms_url ~* '^https?://'),
  constraint communications_number_requests_channels_check
    check (requested_channels <@ array['sms', 'email']::text[] and cardinality(requested_channels) > 0),
  constraint communications_number_requests_area_code_check
    check (preferred_area_code is null or preferred_area_code ~ '^[0-9]{3}$'),
  constraint communications_number_requests_keyword_check
    check (requested_keyword is null or requested_keyword ~ '^[A-Z0-9]{2,20}$'),
  constraint communications_number_requests_estimates_check
    check (
      (estimated_subscriber_count is null or estimated_subscriber_count >= 0)
      and (estimated_monthly_message_volume is null or estimated_monthly_message_volume >= 0)
    ),
  constraint communications_number_requests_status_check
    check (status in ('submitted', 'reviewing', 'approved', 'declined', 'workspace_created')),
  constraint communications_number_requests_ip_hash_check
    check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
);

create table public.communications_workspaces (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null unique,
  program_name text not null,
  sender_name text not null,
  website_url text not null,
  privacy_policy_url text not null,
  program_terms_url text not null,
  support_email text not null,
  support_phone text,
  expected_message_frequency text not null default 'Message frequency varies.',
  status text not null default 'setup',
  included_sms_segments integer not null default 500,
  sms_overage_cents integer not null default 3,
  mms_unit_cents integer not null default 8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  constraint communications_workspaces_slug_check
    check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint communications_workspaces_urls_check
    check (website_url ~* '^https?://' and privacy_policy_url ~* '^https?://' and program_terms_url ~* '^https?://'),
  constraint communications_workspaces_support_email_check
    check (support_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint communications_workspaces_support_phone_check
    check (support_phone is null or support_phone ~ '^\+[1-9][0-9]{7,14}$'),
  constraint communications_workspaces_status_check
    check (status in ('setup', 'carrier_pending', 'active', 'paused', 'canceled')),
  constraint communications_workspaces_pricing_check
    check (included_sms_segments >= 0 and sms_overage_cents >= 0 and mms_unit_cents >= 0)
);

create table public.communications_workspace_websites (
  workspace_id uuid not null,
  website_id uuid not null,
  organization_id uuid not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  primary key (workspace_id, website_id),
  foreign key (workspace_id, organization_id)
    references public.communications_workspaces (id, organization_id) on delete cascade,
  foreign key (website_id, organization_id)
    references public.client_websites (id, organization_id) on delete cascade,
  constraint communications_workspace_websites_status_check
    check (status in ('active', 'paused', 'removed'))
);

create table public.communications_channels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  channel text not null,
  status text not null default 'pending_setup',
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, channel),
  constraint communications_channels_channel_check check (channel in ('sms', 'email')),
  constraint communications_channels_status_check
    check (status in ('pending_setup', 'pending_verification', 'active', 'paused', 'disabled')),
  constraint communications_channels_configuration_check check (jsonb_typeof(configuration) = 'object')
);

create table public.communications_numbers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  phone_e164 text not null unique,
  provider text not null default 'twilio',
  provider_phone_sid text,
  messaging_service_sid text,
  status text not null default 'provisioning',
  carrier_registration_status text not null default 'not_submitted',
  texting_activated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_numbers_phone_check check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint communications_numbers_provider_check check (provider in ('twilio')),
  constraint communications_numbers_status_check check (status in ('provisioning', 'active', 'paused', 'released')),
  constraint communications_numbers_registration_check
    check (carrier_registration_status in ('not_submitted', 'submitted', 'pending', 'approved', 'rejected'))
);

create table public.communications_sending_domains (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  domain text not null,
  provider text,
  provider_domain_id text,
  status text not null default 'pending_verification',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, domain),
  constraint communications_sending_domains_domain_check
    check (domain ~* '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:[.][a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$'),
  constraint communications_sending_domains_status_check
    check (status in ('pending_verification', 'verified', 'failed', 'disabled'))
);

create table public.communications_topics (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  constraint communications_topics_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint communications_topics_sort_check check (sort_order between 0 and 10000)
);

create table public.communications_keywords (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  number_id uuid references public.communications_numbers (id) on delete cascade,
  keyword text not null,
  topic_id uuid references public.communications_topics (id) on delete set null,
  source_id uuid,
  active boolean not null default true,
  welcome_message text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_keywords_keyword_check check (keyword ~ '^[A-Z0-9]{2,20}$')
);

create unique index communications_keywords_number_keyword_uidx
  on public.communications_keywords (workspace_id, coalesce(number_id, '00000000-0000-0000-0000-000000000000'::uuid), upper(keyword));

create table public.communications_subscribers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  organization_contact_id uuid references public.organization_contacts (id) on delete set null,
  full_name text,
  phone_e164 text,
  email text,
  sms_status text not null default 'not_requested',
  email_status text not null default 'not_requested',
  joined_at timestamptz not null default now(),
  last_interaction_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_subscribers_contact_check check (phone_e164 is not null or email is not null),
  constraint communications_subscribers_phone_check check (phone_e164 is null or phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint communications_subscribers_email_check
    check (email is null or email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint communications_subscribers_sms_status_check
    check (sms_status in ('not_requested', 'subscribed', 'unsubscribed')),
  constraint communications_subscribers_email_status_check
    check (email_status in ('not_requested', 'subscribed', 'unsubscribed'))
);

create unique index communications_subscribers_workspace_phone_uidx
  on public.communications_subscribers (workspace_id, phone_e164) where phone_e164 is not null;
create unique index communications_subscribers_workspace_email_uidx
  on public.communications_subscribers (workspace_id, lower(email)) where email is not null;

create table public.communications_subscriber_topics (
  subscriber_id uuid not null references public.communications_subscribers (id) on delete cascade,
  topic_id uuid not null references public.communications_topics (id) on delete cascade,
  selected_at timestamptz not null default now(),
  primary key (subscriber_id, topic_id)
);

create table public.website_forms (
  id uuid primary key default gen_random_uuid(),
  public_id uuid not null unique default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id uuid not null,
  communications_workspace_id uuid,
  name text not null,
  form_type text not null,
  status text not null default 'draft',
  success_message text not null default 'Thank you. Your submission has been received.',
  allowed_origins text[] not null,
  active_consent_configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (website_id, organization_id)
    references public.client_websites (id, organization_id) on delete cascade,
  foreign key (communications_workspace_id, organization_id)
    references public.communications_workspaces (id, organization_id) on delete cascade,
  unique (communications_workspace_id, name),
  constraint website_forms_type_check
    check (form_type in ('general', 'contact', 'subscription', 'lead', 'rsvp', 'application')),
  constraint website_forms_status_check check (status in ('draft', 'active', 'paused', 'archived')),
  constraint website_forms_allowed_origins_check check (cardinality(allowed_origins) > 0),
  constraint website_forms_consent_configuration_check check (jsonb_typeof(active_consent_configuration) = 'object')
);

create table public.website_form_fields (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.website_forms (id) on delete cascade,
  field_key text not null,
  field_type text not null,
  label text not null,
  placeholder text,
  required boolean not null default false,
  sort_order integer not null default 100,
  choices jsonb not null default '[]'::jsonb,
  validation_configuration jsonb not null default '{}'::jsonb,
  contact_field_mapping text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, field_key),
  constraint website_form_fields_key_check check (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  constraint website_form_fields_type_check
    check (field_type in ('text', 'textarea', 'email', 'phone', 'number', 'url', 'date', 'checkbox', 'radio', 'select', 'hidden')),
  constraint website_form_fields_sort_check check (sort_order between 0 and 10000),
  constraint website_form_fields_choices_check check (jsonb_typeof(choices) = 'array'),
  constraint website_form_fields_validation_check check (jsonb_typeof(validation_configuration) = 'object'),
  constraint website_form_fields_mapping_check
    check (contact_field_mapping is null or contact_field_mapping in ('full_name', 'email', 'phone_e164'))
);

create table public.website_form_actions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.website_forms (id) on delete cascade,
  action_type text not null,
  status text not null default 'active',
  sort_order integer not null default 100,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (form_id, action_type),
  constraint website_form_actions_type_check
    check (action_type in (
      'save_submission', 'upsert_communications_subscriber', 'subscribe_email', 'subscribe_sms',
      'record_consent', 'save_topics', 'notify_organization', 'queue_autoresponder', 'call_external_webhook'
    )),
  constraint website_form_actions_status_check check (status in ('active', 'paused', 'disabled')),
  constraint website_form_actions_sort_check check (sort_order between 0 and 10000),
  constraint website_form_actions_configuration_check check (jsonb_typeof(configuration) = 'object')
);

create table public.communications_signup_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id uuid not null,
  workspace_id uuid references public.communications_workspaces (id) on delete cascade,
  form_id uuid not null references public.website_forms (id) on delete cascade,
  source_type text not null,
  name text not null,
  slug text not null,
  public_token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (website_id, organization_id)
    references public.client_websites (id, organization_id) on delete cascade,
  foreign key (workspace_id, organization_id)
    references public.communications_workspaces (id, organization_id) on delete cascade,
  unique (form_id, slug),
  constraint communications_signup_sources_type_check
    check (source_type in ('website_embed', 'hosted_signup', 'qr_campaign', 'sms_keyword', 'manual_entry', 'import')),
  constraint communications_signup_sources_slug_check check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint communications_signup_sources_status_check check (status in ('active', 'paused', 'archived')),
  constraint communications_signup_sources_metadata_check check (jsonb_typeof(metadata) = 'object')
);

alter table public.communications_keywords
  add constraint communications_keywords_source_id_fkey
  foreign key (source_id) references public.communications_signup_sources (id) on delete set null;

create table public.website_form_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  website_id uuid not null,
  form_id uuid not null references public.website_forms (id) on delete cascade,
  workspace_id uuid references public.communications_workspaces (id) on delete set null,
  subscriber_id uuid references public.communications_subscribers (id) on delete set null,
  contact_id uuid references public.organization_contacts (id) on delete set null,
  idempotency_key text not null,
  original_values jsonb not null,
  verified_signup_source_id uuid not null references public.communications_signup_sources (id) on delete restrict,
  source_page text not null,
  request_origin text not null,
  request_ip_hash text,
  processing_status text not null default 'received',
  submitted_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (form_id, idempotency_key),
  foreign key (website_id, organization_id)
    references public.client_websites (id, organization_id) on delete cascade,
  constraint website_form_submissions_values_check check (jsonb_typeof(original_values) = 'object'),
  constraint website_form_submissions_status_check
    check (processing_status in ('received', 'processing', 'processed', 'failed')),
  constraint website_form_submissions_ip_hash_check
    check (request_ip_hash is null or request_ip_hash ~ '^[0-9a-f]{64}$'),
  constraint website_form_submissions_idempotency_check check (length(idempotency_key) between 16 and 200)
);

create table public.communications_consent_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  subscriber_id uuid not null references public.communications_subscribers (id) on delete cascade,
  channel text not null,
  event_type text not null,
  consent_method text not null,
  verified_signup_source_id uuid references public.communications_signup_sources (id) on delete restrict,
  disclosure_version text not null,
  disclosure_text text not null,
  checkbox_label text not null,
  program_name text not null,
  sender_name text not null,
  message_frequency text not null,
  privacy_policy_url text not null,
  messaging_terms_url text not null,
  topic_ids uuid[] not null default '{}'::uuid[],
  form_submission_id uuid references public.website_form_submissions (id) on delete restrict,
  source_page text not null,
  ip_hash text,
  user_agent text,
  provider_reference text,
  consent_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint communications_consent_events_channel_check check (channel in ('sms', 'email')),
  constraint communications_consent_events_type_check
    check (event_type in ('subscribe', 'unsubscribe', 'resubscribe', 'preference_update')),
  constraint communications_consent_events_method_check
    check (consent_method in ('website_embed', 'hosted_signup', 'qr_campaign', 'sms_keyword', 'manual_entry', 'import')),
  constraint communications_consent_events_urls_check
    check (privacy_policy_url ~* '^https?://' and messaging_terms_url ~* '^https?://'),
  constraint communications_consent_events_ip_hash_check
    check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$'),
  constraint communications_consent_events_snapshot_check check (jsonb_typeof(consent_snapshot) = 'object')
);

create table public.communications_message_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.communications_workspaces (id) on delete cascade,
  subscriber_id uuid references public.communications_subscribers (id) on delete set null,
  channel text not null,
  direction text not null,
  status text not null,
  provider_message_id text,
  from_address text,
  to_address text,
  body_preview text,
  sms_segment_count integer not null default 0,
  billable_units integer not null default 0,
  estimated_cost_cents integer not null default 0,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint communications_message_events_channel_check check (channel in ('sms', 'mms', 'email')),
  constraint communications_message_events_direction_check check (direction in ('inbound', 'outbound')),
  constraint communications_message_events_status_check
    check (status in ('queued', 'sent', 'delivered', 'failed', 'received')),
  constraint communications_message_events_usage_check
    check (sms_segment_count >= 0 and billable_units >= 0 and estimated_cost_cents >= 0)
);

create unique index communications_message_events_provider_message_uidx
  on public.communications_message_events (provider_message_id) where provider_message_id is not null;

create table public.website_form_action_queue (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  submission_id uuid not null references public.website_form_submissions (id) on delete cascade,
  form_action_id uuid not null references public.website_form_actions (id) on delete cascade,
  status text not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (submission_id, form_action_id),
  constraint website_form_action_queue_status_check
    check (status in ('pending', 'processing', 'completed', 'failed', 'canceled')),
  constraint website_form_action_queue_attempts_check check (attempts >= 0)
);

create index communications_number_requests_created_idx on public.communications_number_requests (created_at desc);
create index communications_number_requests_organization_idx on public.communications_number_requests (organization_id) where organization_id is not null;
create index communications_number_requests_website_organization_idx on public.communications_number_requests (website_id, organization_id) where website_id is not null;
create index communications_number_requests_requester_idx on public.communications_number_requests (requester_user_id) where requester_user_id is not null;
create index communications_number_requests_reviewer_idx on public.communications_number_requests (reviewed_by) where reviewed_by is not null;
create index communications_workspaces_organization_idx on public.communications_workspaces (organization_id);
create index communications_workspace_websites_workspace_organization_idx on public.communications_workspace_websites (workspace_id, organization_id);
create index communications_workspace_websites_website_organization_idx on public.communications_workspace_websites (website_id, organization_id);
create index communications_channels_workspace_idx on public.communications_channels (workspace_id, channel, status);
create index communications_numbers_workspace_idx on public.communications_numbers (workspace_id, status);
create index communications_sending_domains_workspace_idx on public.communications_sending_domains (workspace_id, status);
create index communications_topics_workspace_active_idx on public.communications_topics (workspace_id, active, sort_order);
create index communications_keywords_number_idx on public.communications_keywords (number_id) where number_id is not null;
create index communications_keywords_topic_idx on public.communications_keywords (topic_id) where topic_id is not null;
create index communications_keywords_source_idx on public.communications_keywords (source_id) where source_id is not null;
create index communications_subscribers_workspace_joined_idx on public.communications_subscribers (workspace_id, joined_at desc);
create index communications_subscribers_contact_idx on public.communications_subscribers (organization_contact_id) where organization_contact_id is not null;
create index communications_subscriber_topics_topic_idx on public.communications_subscriber_topics (topic_id);
create index communications_consent_events_workspace_created_idx on public.communications_consent_events (workspace_id, created_at desc);
create index communications_consent_events_submission_idx on public.communications_consent_events (form_submission_id);
create index communications_consent_events_subscriber_idx on public.communications_consent_events (subscriber_id);
create index communications_consent_events_verified_source_idx on public.communications_consent_events (verified_signup_source_id) where verified_signup_source_id is not null;
create index communications_message_events_workspace_occurred_idx on public.communications_message_events (workspace_id, occurred_at desc);
create index communications_message_events_subscriber_idx on public.communications_message_events (subscriber_id) where subscriber_id is not null;
create index website_forms_organization_website_idx on public.website_forms (organization_id, website_id, status);
create index website_forms_website_organization_idx on public.website_forms (website_id, organization_id);
create index website_forms_workspace_organization_idx on public.website_forms (communications_workspace_id, organization_id) where communications_workspace_id is not null;
create index website_form_fields_form_sort_idx on public.website_form_fields (form_id, sort_order);
create index website_form_actions_form_sort_idx on public.website_form_actions (form_id, sort_order);
create index communications_signup_sources_form_status_idx on public.communications_signup_sources (form_id, status);
create index communications_signup_sources_organization_idx on public.communications_signup_sources (organization_id);
create index communications_signup_sources_website_organization_idx on public.communications_signup_sources (website_id, organization_id);
create index communications_signup_sources_workspace_organization_idx on public.communications_signup_sources (workspace_id, organization_id) where workspace_id is not null;
create index website_form_submissions_organization_submitted_idx on public.website_form_submissions (organization_id, submitted_at desc);
create index website_form_submissions_workspace_submitted_idx on public.website_form_submissions (workspace_id, submitted_at desc) where workspace_id is not null;
create index website_form_submissions_ip_submitted_idx on public.website_form_submissions (request_ip_hash, submitted_at desc) where request_ip_hash is not null;
create index website_form_submissions_website_organization_idx on public.website_form_submissions (website_id, organization_id);
create index website_form_submissions_subscriber_idx on public.website_form_submissions (subscriber_id) where subscriber_id is not null;
create index website_form_submissions_contact_idx on public.website_form_submissions (contact_id) where contact_id is not null;
create index website_form_submissions_verified_source_idx on public.website_form_submissions (verified_signup_source_id);
create index website_form_action_queue_pending_idx on public.website_form_action_queue (status, available_at) where status = 'pending';
create index website_form_action_queue_organization_idx on public.website_form_action_queue (organization_id);
create index website_form_action_queue_form_action_idx on public.website_form_action_queue (form_action_id);

create trigger communications_number_requests_set_updated_at before update on public.communications_number_requests
for each row execute function public.set_updated_at();
create trigger communications_workspaces_set_updated_at before update on public.communications_workspaces
for each row execute function public.set_updated_at();
create trigger communications_channels_set_updated_at before update on public.communications_channels
for each row execute function public.set_updated_at();
create trigger communications_numbers_set_updated_at before update on public.communications_numbers
for each row execute function public.set_updated_at();
create trigger communications_sending_domains_set_updated_at before update on public.communications_sending_domains
for each row execute function public.set_updated_at();
create trigger communications_topics_set_updated_at before update on public.communications_topics
for each row execute function public.set_updated_at();
create trigger communications_keywords_set_updated_at before update on public.communications_keywords
for each row execute function public.set_updated_at();
create trigger communications_subscribers_set_updated_at before update on public.communications_subscribers
for each row execute function public.set_updated_at();
create trigger website_forms_set_updated_at before update on public.website_forms
for each row execute function public.set_updated_at();
create trigger website_form_fields_set_updated_at before update on public.website_form_fields
for each row execute function public.set_updated_at();
create trigger website_form_actions_set_updated_at before update on public.website_form_actions
for each row execute function public.set_updated_at();
create trigger communications_signup_sources_set_updated_at before update on public.communications_signup_sources
for each row execute function public.set_updated_at();
create trigger website_form_action_queue_set_updated_at before update on public.website_form_action_queue
for each row execute function public.set_updated_at();

create or replace function private.validate_communications_subscriber_contact_link()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  workspace_organization_id uuid;
  contact_organization_id uuid;
begin
  if new.organization_contact_id is null then
    return new;
  end if;
  select organization_id into workspace_organization_id
  from public.communications_workspaces where id = new.workspace_id;
  select organization_id into contact_organization_id
  from public.organization_contacts where id = new.organization_contact_id;
  if workspace_organization_id is null or contact_organization_id is null
     or workspace_organization_id <> contact_organization_id then
    raise exception 'Communications subscriber contact belongs to another organization.';
  end if;
  return new;
end;
$$;

revoke all on function private.validate_communications_subscriber_contact_link() from public, anon, authenticated;

create trigger communications_subscribers_validate_contact_link
before insert or update of workspace_id, organization_contact_id on public.communications_subscribers
for each row execute function private.validate_communications_subscriber_contact_link();

create or replace function private.prevent_communications_consent_mutation()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  raise exception 'Communications consent events are append-only.';
end;
$$;

revoke all on function private.prevent_communications_consent_mutation() from public, anon, authenticated;

create trigger communications_consent_events_append_only
before update or delete on public.communications_consent_events
for each row execute function private.prevent_communications_consent_mutation();

insert into public.n3xra_product_catalog (
  product_key, name, description, portal_path, icon_key,
  client_portal_available, status, sort_order
) values (
  'communications',
  'Communications',
  'Permission-based email and text subscriber programs for organizations.',
  '/client-portal/communications/',
  'communications',
  true,
  'active',
  30
)
on conflict (product_key) do update
set name = excluded.name,
    description = excluded.description,
    portal_path = excluded.portal_path,
    icon_key = excluded.icon_key,
    client_portal_available = excluded.client_portal_available,
    status = excluded.status,
    sort_order = excluded.sort_order,
    updated_at = now();

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

  if normalized_origin = '' or not (normalized_origin = any(target_form.allowed_origins)) then
    raise exception 'Submission origin is not allowed.';
  end if;
  if normalized_source_page <> normalized_origin
     and normalized_source_page not like normalized_origin || '/%' then
    raise exception 'Submission source page is not allowed.';
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
    where id = target_form.communications_workspace_id and status = 'active'
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
          and channel_setting.status = 'active'
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

create view public.communications_workspace_metrics
with (security_invoker = true)
as
select
  workspace.id as workspace_id,
  (select count(*) from public.communications_subscribers subscriber
    where subscriber.workspace_id = workspace.id)::bigint as total_subscribers,
  (select count(*) from public.communications_subscribers subscriber
    where subscriber.workspace_id = workspace.id and subscriber.sms_status = 'subscribed')::bigint as sms_subscribers,
  (select count(*) from public.communications_subscribers subscriber
    where subscriber.workspace_id = workspace.id and subscriber.email_status = 'subscribed')::bigint as email_subscribers,
  (select count(*) from public.communications_topics topic
    where topic.workspace_id = workspace.id and topic.active)::bigint as active_topics,
  (select count(*) from public.communications_consent_events consent
    where consent.workspace_id = workspace.id)::bigint as consent_events,
  (select count(*) from public.communications_message_events message
    where message.workspace_id = workspace.id)::bigint as message_events,
  (select coalesce(sum(message.sms_segment_count), 0)
    from public.communications_message_events message
    where message.workspace_id = workspace.id
      and message.direction = 'outbound'
      and message.channel = 'sms'
      and message.occurred_at >= date_trunc('month', now()))::bigint as sms_segments_current_month
from public.communications_workspaces workspace
;

create view public.communications_topic_metrics
with (security_invoker = true)
as
select
  topic.workspace_id,
  topic.id as topic_id,
  (select count(*)
   from public.communications_subscriber_topics choice
   where choice.topic_id = topic.id)::bigint as subscriber_count
from public.communications_topics topic;

alter table public.communications_number_requests enable row level security;
alter table public.communications_workspaces enable row level security;
alter table public.communications_workspace_websites enable row level security;
alter table public.communications_channels enable row level security;
alter table public.communications_numbers enable row level security;
alter table public.communications_sending_domains enable row level security;
alter table public.communications_topics enable row level security;
alter table public.communications_keywords enable row level security;
alter table public.communications_subscribers enable row level security;
alter table public.communications_subscriber_topics enable row level security;
alter table public.website_forms enable row level security;
alter table public.website_form_fields enable row level security;
alter table public.website_form_actions enable row level security;
alter table public.communications_signup_sources enable row level security;
alter table public.website_form_submissions enable row level security;
alter table public.communications_consent_events enable row level security;
alter table public.communications_message_events enable row level security;
alter table public.website_form_action_queue enable row level security;

revoke all on public.communications_number_requests from public, anon, authenticated;
revoke all on public.communications_workspaces from public, anon, authenticated;
revoke all on public.communications_workspace_websites from public, anon, authenticated;
revoke all on public.communications_channels from public, anon, authenticated;
revoke all on public.communications_numbers from public, anon, authenticated;
revoke all on public.communications_sending_domains from public, anon, authenticated;
revoke all on public.communications_topics from public, anon, authenticated;
revoke all on public.communications_keywords from public, anon, authenticated;
revoke all on public.communications_subscribers from public, anon, authenticated;
revoke all on public.communications_subscriber_topics from public, anon, authenticated;
revoke all on public.website_forms from public, anon, authenticated;
revoke all on public.website_form_fields from public, anon, authenticated;
revoke all on public.website_form_actions from public, anon, authenticated;
revoke all on public.communications_signup_sources from public, anon, authenticated;
revoke all on public.website_form_submissions from public, anon, authenticated;
revoke all on public.communications_consent_events from public, anon, authenticated;
revoke all on public.communications_message_events from public, anon, authenticated;
revoke all on public.website_form_action_queue from public, anon, authenticated;
revoke all on public.communications_workspace_metrics from public, anon, authenticated;
revoke all on public.communications_topic_metrics from public, anon, authenticated;

grant all on public.communications_number_requests to service_role;
grant all on public.communications_workspaces to service_role;
grant all on public.communications_workspace_websites to service_role;
grant all on public.communications_channels to service_role;
grant all on public.communications_numbers to service_role;
grant all on public.communications_sending_domains to service_role;
grant all on public.communications_topics to service_role;
grant all on public.communications_keywords to service_role;
grant all on public.communications_subscribers to service_role;
grant all on public.communications_subscriber_topics to service_role;
grant all on public.website_forms to service_role;
grant all on public.website_form_fields to service_role;
grant all on public.website_form_actions to service_role;
grant all on public.communications_signup_sources to service_role;
grant all on public.website_form_submissions to service_role;
grant all on public.communications_consent_events to service_role;
grant all on public.communications_message_events to service_role;
grant all on public.website_form_action_queue to service_role;
grant select on public.communications_workspace_metrics to service_role;
grant select on public.communications_topic_metrics to service_role;

grant select, update on public.communications_number_requests to authenticated;
grant select on public.communications_workspaces to authenticated;
grant select on public.communications_workspace_websites to authenticated;
grant select on public.communications_channels to authenticated;
grant select (id, workspace_id, phone_e164, provider, status, carrier_registration_status, texting_activated_at, created_at, updated_at)
  on public.communications_numbers to authenticated;
grant select on public.communications_sending_domains to authenticated;
grant select on public.communications_topics to authenticated;
grant select on public.communications_keywords to authenticated;
grant select on public.communications_subscribers to authenticated;
grant select on public.communications_subscriber_topics to authenticated;
grant select on public.website_forms to authenticated;
grant select on public.website_form_fields to authenticated;
grant select on public.website_form_actions to authenticated;
grant select on public.communications_signup_sources to authenticated;
grant select on public.website_form_submissions to authenticated;
grant select on public.communications_consent_events to authenticated;
grant select on public.communications_message_events to authenticated;
grant select on public.website_form_action_queue to authenticated;
grant select on public.communications_workspace_metrics to authenticated;
grant select on public.communications_topic_metrics to authenticated;

create policy communications_number_requests_admin_select
on public.communications_number_requests for select to authenticated
using ((select public.is_platform_admin()));
create policy communications_number_requests_admin_update
on public.communications_number_requests for update to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy communications_workspaces_member_select
on public.communications_workspaces for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = communications_workspaces.organization_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_workspace_websites_member_select
on public.communications_workspace_websites for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = communications_workspace_websites.organization_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_channels_member_select
on public.communications_channels for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_channels.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_numbers_member_select
on public.communications_numbers for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_numbers.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_sending_domains_member_select
on public.communications_sending_domains for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_sending_domains.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_topics_member_select
on public.communications_topics for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_topics.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_keywords_member_select
on public.communications_keywords for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_keywords.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_subscribers_member_select
on public.communications_subscribers for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_subscribers.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_subscriber_topics_member_select
on public.communications_subscriber_topics for select to authenticated
using (
  exists (
    select 1 from public.communications_subscribers subscriber
    join public.communications_workspaces workspace on workspace.id = subscriber.workspace_id
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where subscriber.id = communications_subscriber_topics.subscriber_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy website_forms_member_select
on public.website_forms for select to authenticated
using (
  (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = website_forms.organization_id
        and membership.user_id = (select auth.uid())
    )
    and public.can_view_client_website(website_forms.website_id)
  ) or (select public.is_platform_admin())
);

create policy website_form_fields_member_select
on public.website_form_fields for select to authenticated
using (
  exists (
    select 1 from public.website_forms form
    join public.organization_memberships membership on membership.organization_id = form.organization_id
    where form.id = website_form_fields.form_id
      and membership.user_id = (select auth.uid())
      and public.can_view_client_website(form.website_id)
  ) or (select public.is_platform_admin())
);

create policy website_form_actions_member_select
on public.website_form_actions for select to authenticated
using (
  exists (
    select 1 from public.website_forms form
    join public.organization_memberships membership on membership.organization_id = form.organization_id
    where form.id = website_form_actions.form_id
      and membership.user_id = (select auth.uid())
      and public.can_view_client_website(form.website_id)
  ) or (select public.is_platform_admin())
);

create policy communications_signup_sources_member_select
on public.communications_signup_sources for select to authenticated
using (
  (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = communications_signup_sources.organization_id
        and membership.user_id = (select auth.uid())
    )
    and public.can_view_client_website(communications_signup_sources.website_id)
  ) or (select public.is_platform_admin())
);

create policy website_form_submissions_member_select
on public.website_form_submissions for select to authenticated
using (
  (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = website_form_submissions.organization_id
        and membership.user_id = (select auth.uid())
    )
    and public.can_view_client_website(website_form_submissions.website_id)
  ) or (select public.is_platform_admin())
);

create policy communications_consent_events_member_select
on public.communications_consent_events for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_consent_events.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy communications_message_events_member_select
on public.communications_message_events for select to authenticated
using (
  exists (
    select 1 from public.communications_workspaces workspace
    join public.organization_memberships membership on membership.organization_id = workspace.organization_id
    where workspace.id = communications_message_events.workspace_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

create policy website_form_action_queue_member_select
on public.website_form_action_queue for select to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = website_form_action_queue.organization_id
      and membership.user_id = (select auth.uid())
  ) or (select public.is_platform_admin())
);

comment on table public.website_forms is 'Universal N3XRA website form definitions. Public submissions are accepted only by the trusted server route.';
comment on table public.website_form_submissions is 'Immutable original form payload and verified attribution saved before any delivery action is queued.';
comment on table public.communications_consent_events is 'Append-only, channel-specific Communications consent snapshots.';
comment on function public.ingest_website_form_submission(
  uuid, text, text, text, text, jsonb, uuid[], text[], jsonb, text, text, boolean
) is 'Atomic service-role-only universal form ingestion and Communications subscription transaction.';
