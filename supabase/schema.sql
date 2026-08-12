create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.founding_partner_applications (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text,
  organization text,
  website text,
  audience_source text not null,
  interested_products jsonb not null default '[]'::jsonb,
  referral_plan text not null,
  payout_country text,
  consent boolean not null default false,
  status text not null default 'submitted',
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint founding_partner_applications_email_check check (email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint founding_partner_applications_products_array_check check (jsonb_typeof(interested_products) = 'array'),
  constraint founding_partner_applications_metadata_object_check check (jsonb_typeof(metadata) = 'object'),
  constraint founding_partner_applications_status_check
    check (status in ('submitted', 'reviewing', 'approved', 'rejected', 'waitlisted'))
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  subscription_tier text not null default 'free',
  account_status text not null default 'active',
  document_limit integer not null default 25,
  storage_limit_mb integer not null default 1024,
  user_limit integer not null default 1,
  public_embed_enabled boolean not null default false,
  public_embed_token text unique default encode(gen_random_bytes(12), 'hex'),
  transcript_preview_enabled boolean not null default false,
  keyword_search_enabled boolean not null default true,
  file_preview_cards_enabled boolean not null default true,
  hosted_public_portal_enabled boolean not null default false,
  branded_primary_color text,
  branded_accent_color text,
  logo_storage_path text,
  records_ai_context text,
  records_ai_response_style text,
  records_ai_memory text,
  records_default_minutes_style text not null default 'standard',
  records_speaker_detection_enabled boolean not null default true,
  records_admin_only_meetings_enabled boolean not null default false,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  cancel_at_period_end boolean not null default false,
  subscription_current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_subscription_tier_check
    check (subscription_tier in ('free', 'starter', 'organization')),
  constraint organizations_account_status_check
    check (account_status in ('active', 'trialing', 'past_due', 'canceled', 'suspended')),
  constraint organizations_records_default_minutes_style_check
    check (records_default_minutes_style in ('brief', 'standard', 'detailed'))
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer',
  permissions jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  constraint organization_memberships_role_check
    check (role in ('account_admin', 'editor', 'viewer'))
);

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null unique,
  role text not null default 'viewer',
  max_uses integer not null default 1,
  redeemed_uses integer not null default 0,
  expires_at timestamptz,
  is_disabled boolean not null default false,
  recipient_email text,
  recipient_name text,
  source_contact_id uuid,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint organization_invites_role_check
    check (role in ('account_admin', 'editor', 'viewer')),
  constraint organization_invites_max_uses_check
    check (max_uses > 0),
  constraint organization_invites_redeemed_uses_check
    check (redeemed_uses >= 0 and redeemed_uses <= max_uses),
  constraint organization_invites_recipient_email_check
    check (
      recipient_email is null
      or recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    )
);

create table if not exists public.records_demo_workspace_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null unique references public.organizations (id) on delete cascade,
  code_hash text not null unique,
  code_last_four text not null,
  recipient_email text,
  status text not null default 'pending',
  created_by_user_id uuid not null references auth.users (id) on delete restrict,
  claimed_by_user_id uuid references auth.users (id) on delete set null,
  expires_at timestamptz,
  claimed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint records_demo_workspace_claims_status_check
    check (status in ('pending', 'claimed', 'revoked', 'expired')),
  constraint records_demo_workspace_claims_email_check
    check (
      recipient_email is null
      or recipient_email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'
    ),
  constraint records_demo_workspace_claims_code_last_four_check
    check (length(code_last_four) = 4)
);

create table if not exists public.organization_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  full_name text not null,
  email text not null,
  notes text,
  linked_user_id uuid references auth.users (id) on delete set null,
  created_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_contacts_email_check check (email ~* '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$'),
  constraint organization_contacts_full_name_check check (length(trim(full_name)) > 0),
  unique (organization_id, email)
);

alter table public.organization_invites
  drop constraint if exists organization_invites_source_contact_id_fkey;

alter table public.organization_invites
  add constraint organization_invites_source_contact_id_fkey
  foreign key (source_contact_id)
  references public.organization_contacts (id)
  on delete set null;

create index if not exists organization_contacts_linked_user_id_idx
  on public.organization_contacts (linked_user_id);

create unique index if not exists organization_contacts_organization_email_ci_uidx
  on public.organization_contacts (organization_id, lower(trim(email)));

create index if not exists organization_invites_recipient_email_idx
  on public.organization_invites (organization_id, lower(trim(recipient_email)))
  where recipient_email is not null;

create index if not exists organization_invites_source_contact_id_idx
  on public.organization_invites (source_contact_id)
  where source_contact_id is not null;

create index if not exists records_demo_workspace_claims_status_created_idx
  on public.records_demo_workspace_claims (status, created_at desc);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  uploaded_by_user_id uuid references auth.users (id) on delete set null,
  title text not null,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  year text,
  month text,
  is_public boolean not null default false,
  admin_only boolean not null default false,
  status text not null default 'uploaded',
  processing_error text,
  processing_stage text,
  processing_progress smallint not null default 0,
  processing_started_at timestamptz,
  processing_updated_at timestamptz,
  processing_completed_at timestamptz,
  extracted_text text,
  records_ai_note text,
  search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(original_filename, '') || ' ' || coalesce(extracted_text, '') || ' ' || coalesce(records_ai_note, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_status_check check (status in ('uploaded', 'processing', 'ready', 'failed'))
);

create table if not exists public.app_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  source_document_id uuid references public.documents (id) on delete set null,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  content_json jsonb not null default '{"type":"records_document","version":1,"blocks":[]}'::jsonb,
  plain_text text,
  document_kind text not null default 'document',
  status text not null default 'draft',
  last_sent_at timestamptz,
  search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(plain_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_documents_content_json_object_check check (jsonb_typeof(content_json) = 'object'),
  constraint app_documents_document_kind_check check (document_kind in ('document', 'template')),
  constraint app_documents_status_check check (status in ('draft', 'final', 'archived'))
);

create table if not exists public.document_share_links (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.app_documents (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid references auth.users (id) on delete set null,
  token_hash text not null unique,
  label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.meeting_recordings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  document_id uuid references public.documents (id) on delete set null,
  selected_template_id uuid references public.app_documents (id) on delete set null,
  admin_only boolean not null default false,
  title text not null,
  status text not null default 'created',
  transcript_status text not null default 'not_started',
  ai_review_status text not null default 'not_started',
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  storage_path text unique,
  storage_bucket text,
  audio_mime_type text,
  file_size bigint,
  processing_error text,
  transcript_text text,
  transcript_generated_at timestamptz,
  notes_content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  notes_plain_text text,
  notes_updated_at timestamptz,
  ai_review_json jsonb not null default '{}'::jsonb,
  ai_reviewed_at timestamptz,
  minutes_style text,
  ai_draft_document_id uuid references public.app_documents (id) on delete set null,
  final_document_id uuid references public.app_documents (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_recordings_status_check
    check (status in ('created', 'recording', 'interrupted', 'recorded', 'uploading', 'finalizing', 'uploaded', 'transcribing', 'ready', 'failed')),
  constraint meeting_recordings_transcript_status_check
    check (transcript_status in ('not_started', 'queued', 'processing', 'ready', 'failed')),
  constraint meeting_recordings_ai_review_status_check
    check (ai_review_status in ('not_started', 'processing', 'ready', 'failed')),
  constraint meeting_recordings_notes_content_json_object_check
    check (jsonb_typeof(notes_content_json) = 'object'),
  constraint meeting_recordings_ai_review_json_object_check
    check (jsonb_typeof(ai_review_json) = 'object'),
  constraint meeting_recordings_minutes_style_check
    check (minutes_style is null or minutes_style in ('brief', 'standard', 'detailed')),
  constraint meeting_recordings_duration_check
    check (duration_seconds is null or duration_seconds >= 0),
  constraint meeting_recordings_processing_stage_check
    check (processing_stage is null or processing_stage in ('uploading', 'assembling', 'transcribing', 'complete', 'failed')),
  constraint meeting_recordings_processing_progress_check
    check (processing_progress between 0 and 100)
);

alter table public.meeting_recordings add column if not exists processing_stage text;
alter table public.meeting_recordings add column if not exists processing_progress smallint not null default 0;
alter table public.meeting_recordings add column if not exists processing_started_at timestamptz;
alter table public.meeting_recordings add column if not exists processing_updated_at timestamptz;
alter table public.meeting_recordings add column if not exists processing_completed_at timestamptz;
alter table public.meeting_recordings drop constraint if exists meeting_recordings_processing_stage_check;
alter table public.meeting_recordings add constraint meeting_recordings_processing_stage_check
  check (processing_stage is null or processing_stage in ('uploading', 'assembling', 'transcribing', 'complete', 'failed'));
alter table public.meeting_recordings drop constraint if exists meeting_recordings_processing_progress_check;
alter table public.meeting_recordings add constraint meeting_recordings_processing_progress_check
  check (processing_progress between 0 and 100);

create table if not exists public.meeting_recording_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_recording_id uuid not null references public.meeting_recordings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  capture_session_id uuid not null,
  sequence_number integer not null check (sequence_number >= 0),
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null check (file_size > 0),
  checksum_sha256 text,
  captured_started_at timestamptz not null,
  captured_ended_at timestamptz not null,
  status text not null default 'uploaded' check (status in ('uploaded', 'assembled')),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_recording_id, sequence_number),
  check (captured_ended_at >= captured_started_at)
);

create table if not exists public.meeting_recording_interruptions (
  id uuid primary key default gen_random_uuid(),
  meeting_recording_id uuid not null references public.meeting_recordings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  interruption_number integer not null check (interruption_number > 0),
  reason text not null default 'microphone_interrupted',
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_recording_id, interruption_number),
  check (ended_at is null or ended_at >= started_at)
);

create index if not exists meeting_recording_chunks_recording_sequence_idx on public.meeting_recording_chunks (meeting_recording_id, sequence_number);
create index if not exists meeting_recording_chunks_organization_id_idx on public.meeting_recording_chunks (organization_id);
create index if not exists meeting_recording_chunks_created_by_user_id_idx on public.meeting_recording_chunks (created_by_user_id);
create index if not exists meeting_recording_chunks_capture_session_id_idx on public.meeting_recording_chunks (capture_session_id);
create index if not exists meeting_recording_chunks_expiry_idx on public.meeting_recording_chunks (expires_at);
create index if not exists meeting_recording_interruptions_recording_idx on public.meeting_recording_interruptions (meeting_recording_id, interruption_number);
create index if not exists meeting_recording_interruptions_organization_id_idx on public.meeting_recording_interruptions (organization_id);
create index if not exists meeting_recording_interruptions_created_by_user_id_idx on public.meeting_recording_interruptions (created_by_user_id);

-- Internal foundation for the optional Phone Meetings add-on. This only stores
-- configuration and audit data; Twilio credentials remain server-side secrets.
create table if not exists public.organization_phone_meeting_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  feature_enabled boolean not null default false,
  activation_status text not null default 'not_configured',
  primary_phone_number text,
  twilio_subaccount_sid text,
  twilio_phone_number_sid text,
  recording_notice_enabled boolean not null default true,
  recording_notice_text text not null default 'This call may be recorded for meeting notes.',
  default_retention_days integer not null default 30,
  allowed_start_roles text[] not null default array['account_admin', 'editor']::text[],
  monthly_minutes_limit integer,
  usage_billing_status text not null default 'not_configured',
  retention_cleanup_enabled boolean not null default false,
  usage_reporting_enabled boolean not null default true,
  last_retention_run_at timestamptz,
  last_usage_rollup_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organizations_phone_meeting_activation_status_check
    check (activation_status in ('not_configured', 'pending_compliance', 'ready_for_internal_test', 'active', 'suspended', 'disabled')),
  constraint organizations_phone_meeting_phone_format_check
    check (primary_phone_number is null or primary_phone_number ~ '^\+[1-9][0-9]{7,14}$'),
  constraint organizations_phone_meeting_retention_check
    check (default_retention_days between 1 and 3650),
  constraint organizations_phone_meeting_allowed_start_roles_check
    check (allowed_start_roles <@ array['account_admin', 'editor']::text[]),
  constraint organizations_phone_meeting_minutes_limit_check
    check (monthly_minutes_limit is null or monthly_minutes_limit >= 0),
  constraint organizations_phone_meeting_billing_status_check
    check (usage_billing_status in ('not_configured', 'internal_only', 'stripe_ready', 'active', 'past_due', 'suspended'))
);

create table if not exists public.phone_meeting_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  meeting_recording_id uuid unique references public.meeting_recordings (id) on delete set null,
  requested_by_user_id uuid references auth.users (id) on delete set null,
  connection_method text not null,
  status text not null default 'draft',
  twilio_call_sid text,
  twilio_conference_sid text,
  twilio_recording_sid text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer,
  billed_minutes numeric(12, 2) not null default 0,
  retention_until timestamptz,
  failure_code text,
  failure_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_meeting_sessions_connection_method_check
    check (connection_method in ('merge_line', 'dial_in', 'scheduled')),
  constraint phone_meeting_sessions_status_check
    check (status in ('draft', 'scheduled', 'connecting', 'in_progress', 'recording_ready', 'copying_to_storage', 'transcribing', 'ready', 'failed', 'canceled', 'void')),
  constraint phone_meeting_sessions_duration_check check (duration_seconds is null or duration_seconds >= 0),
  constraint phone_meeting_sessions_billed_minutes_check check (billed_minutes >= 0),
  constraint phone_meeting_sessions_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.phone_meeting_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_meeting_session_id uuid references public.phone_meeting_sessions (id) on delete set null,
  event_type text not null,
  quantity numeric(12, 2) not null,
  unit text not null default 'minute',
  source text not null default 'internal',
  stripe_usage_record_id text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint phone_meeting_usage_events_type_check
    check (event_type in ('activation', 'phone_number', 'call_minute', 'recording_minute', 'transcription_minute', 'credit', 'adjustment')),
  constraint phone_meeting_usage_events_quantity_check check (quantity >= 0),
  constraint phone_meeting_usage_events_unit_check check (unit in ('minute', 'number', 'activation', 'credit')),
  constraint phone_meeting_usage_events_source_check check (source in ('internal', 'stripe', 'twilio', 'admin_adjustment')),
  constraint phone_meeting_usage_events_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create table if not exists public.phone_meeting_retention_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  phone_meeting_session_id uuid not null references public.phone_meeting_sessions (id) on delete cascade,
  meeting_recording_id uuid references public.meeting_recordings (id) on delete set null,
  scheduled_for timestamptz not null,
  status text not null default 'pending',
  attempts integer not null default 0,
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint phone_meeting_retention_jobs_session_key unique (phone_meeting_session_id),
  constraint phone_meeting_retention_jobs_status_check
    check (status in ('pending', 'processing', 'completed', 'skipped', 'failed', 'canceled')),
  constraint phone_meeting_retention_jobs_attempts_check check (attempts >= 0),
  constraint phone_meeting_retention_jobs_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create or replace view public.phone_meeting_monthly_usage
with (security_invoker = true)
as
select
  organization_id,
  date_trunc('month', occurred_at)::date as usage_month,
  coalesce(sum(quantity) filter (where event_type = 'call_minute'), 0)::numeric(12, 2) as call_minutes,
  coalesce(sum(quantity) filter (where event_type = 'recording_minute'), 0)::numeric(12, 2) as recording_minutes,
  coalesce(sum(quantity) filter (where event_type = 'transcription_minute'), 0)::numeric(12, 2) as transcription_minutes,
  coalesce(sum(quantity) filter (where event_type = 'phone_number'), 0)::numeric(12, 2) as phone_numbers,
  coalesce(sum(quantity) filter (where event_type = 'activation'), 0)::numeric(12, 2) as activations,
  coalesce(sum(quantity) filter (where event_type = 'adjustment'), 0)::numeric(12, 2) as adjustments,
  coalesce(sum(quantity) filter (where event_type = 'credit'), 0)::numeric(12, 2) as credits,
  count(*)::integer as event_count,
  max(occurred_at) as last_event_at
from public.phone_meeting_usage_events
group by organization_id, date_trunc('month', occurred_at)::date;

create or replace function public.queue_phone_meeting_retention_job()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.retention_until is null or new.status in ('canceled', 'void') then
    update public.phone_meeting_retention_jobs
       set status = 'canceled',
           locked_at = null,
           last_error = null
     where phone_meeting_session_id = new.id
       and status in ('pending', 'processing', 'failed');
    return new;
  end if;

  insert into public.phone_meeting_retention_jobs (
    organization_id,
    phone_meeting_session_id,
    meeting_recording_id,
    scheduled_for,
    status
  )
  values (
    new.organization_id,
    new.id,
    new.meeting_recording_id,
    new.retention_until,
    'pending'
  )
  on conflict (phone_meeting_session_id) do update
    set organization_id = excluded.organization_id,
        meeting_recording_id = excluded.meeting_recording_id,
        scheduled_for = excluded.scheduled_for,
        status = case
          when public.phone_meeting_retention_jobs.status = 'completed' then 'completed'
          else 'pending'
        end,
        locked_at = null,
        last_error = null;

  return new;
end;
$$;

alter table public.organizations add column if not exists records_ai_context text;
alter table public.organizations add column if not exists records_ai_response_style text;
alter table public.organizations add column if not exists records_ai_memory text;
alter table public.organizations add column if not exists records_default_minutes_style text not null default 'standard';
alter table public.organizations add column if not exists records_speaker_detection_enabled boolean not null default true;
alter table public.organizations add column if not exists records_admin_only_meetings_enabled boolean not null default false;
alter table public.organizations add column if not exists logo_storage_path text;
alter table public.meeting_recordings add column if not exists minutes_style text;
alter table public.meeting_recordings add column if not exists admin_only boolean not null default false;
alter table public.documents add column if not exists records_ai_note text;
alter table public.documents add column if not exists admin_only boolean not null default false;
alter table public.documents drop constraint if exists documents_admin_only_not_public_check;
alter table public.documents add constraint documents_admin_only_not_public_check
  check (not admin_only or not is_public);

create table if not exists public.records_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null,
  model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  constraint records_ai_usage_events_feature_check
    check (feature in ('help', 'search', 'recording_notes')),
  constraint records_ai_usage_events_token_check
    check (prompt_tokens >= 0 and completion_tokens >= 0 and total_tokens >= 0)
);

create table if not exists public.music_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  plan text not null default 'free',
  account_status text not null default 'active',
  monthly_song_limit integer not null default 2,
  songs_used integer not null default 0,
  current_period_start timestamptz not null default date_trunc('month', now()),
  current_period_end timestamptz not null default (date_trunc('month', now()) + interval '1 month'),
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  cancel_at_period_end boolean not null default false,
  subscription_current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint music_profiles_plan_check
    check (plan in ('free', 'creator', 'studio')),
  constraint music_profiles_account_status_check
    check (account_status in ('active', 'trialing', 'past_due', 'canceled', 'suspended')),
  constraint music_profiles_monthly_song_limit_check
    check (monthly_song_limit >= 0),
  constraint music_profiles_songs_used_check
    check (songs_used >= 0)
);

alter table public.music_profiles add column if not exists stripe_customer_id text;
alter table public.music_profiles add column if not exists stripe_subscription_id text;
alter table public.music_profiles add column if not exists stripe_price_id text;
alter table public.music_profiles add column if not exists cancel_at_period_end boolean not null default false;
alter table public.music_profiles add column if not exists subscription_current_period_end timestamptz;

create table if not exists public.music_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text,
  prompt text,
  lyrics text,
  instrumental boolean not null default false,
  task_id text unique,
  status text not null default 'reserved',
  audio_url text,
  error_message text,
  sonauto_response jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  app text not null,
  review_target_type text not null,
  review_target_id uuid not null,
  user_id uuid references auth.users (id) on delete set null,
  organization_id uuid references public.organizations (id) on delete set null,
  rating smallint not null,
  review_text text not null,
  reviewer_name_snapshot text,
  organization_name_snapshot text,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reviews_app_check
    check (app in ('records', 'ai_music')),
  constraint reviews_target_type_check
    check (review_target_type in ('organization', 'profile')),
  constraint reviews_target_shape_check
    check (
      (app = 'records' and review_target_type = 'organization' and (organization_id = review_target_id or organization_id is null))
      or
      (app = 'ai_music' and review_target_type = 'profile' and organization_id is null)
    ),
  constraint reviews_rating_check
    check (rating between 1 and 5),
  constraint reviews_status_check
    check (status in ('published', 'hidden'))
);

alter table public.reviews
  drop constraint if exists reviews_target_shape_check;

alter table public.reviews
  add constraint reviews_target_shape_check
  check (
    (app = 'records' and review_target_type = 'organization' and (organization_id = review_target_id or organization_id is null))
    or
    (app = 'ai_music' and review_target_type = 'profile' and organization_id is null)
  );

create index if not exists organizations_owner_user_id_idx on public.organizations (owner_user_id);
create index if not exists organization_memberships_user_id_idx on public.organization_memberships (user_id);
create index if not exists organization_memberships_org_id_idx on public.organization_memberships (organization_id);
create index if not exists organization_invites_org_id_idx on public.organization_invites (organization_id);
create index if not exists organization_contacts_organization_id_idx on public.organization_contacts (organization_id);
create index if not exists organization_contacts_email_idx on public.organization_contacts (lower(email));
create index if not exists documents_organization_id_idx on public.documents (organization_id);
create index if not exists documents_created_at_idx on public.documents (created_at desc);
create index if not exists documents_search_tsv_idx on public.documents using gin (search_tsv);
create index if not exists app_documents_organization_id_idx on public.app_documents (organization_id);
create index if not exists app_documents_source_document_id_idx on public.app_documents (source_document_id);
create index if not exists app_documents_created_by_user_id_idx on public.app_documents (created_by_user_id);
create index if not exists app_documents_updated_at_idx on public.app_documents (updated_at desc);
create index if not exists app_documents_search_tsv_idx on public.app_documents using gin (search_tsv);
create index if not exists document_share_links_document_id_idx on public.document_share_links (document_id);
create index if not exists document_share_links_organization_id_idx on public.document_share_links (organization_id);
create index if not exists meeting_recordings_organization_id_idx on public.meeting_recordings (organization_id);
create index if not exists meeting_recordings_created_by_user_id_idx on public.meeting_recordings (created_by_user_id);
create index if not exists meeting_recordings_document_id_idx on public.meeting_recordings (document_id);
create index if not exists meeting_recordings_created_at_idx on public.meeting_recordings (created_at desc);
create index if not exists meeting_recordings_selected_template_id_idx on public.meeting_recordings (selected_template_id);
create index if not exists meeting_recordings_ai_draft_document_id_idx on public.meeting_recordings (ai_draft_document_id);
create index if not exists meeting_recordings_final_document_id_idx on public.meeting_recordings (final_document_id);
create unique index if not exists organization_phone_meeting_settings_twilio_phone_number_sid_key
  on public.organization_phone_meeting_settings (twilio_phone_number_sid)
  where twilio_phone_number_sid is not null;
create unique index if not exists organization_phone_meeting_settings_primary_phone_number_key
  on public.organization_phone_meeting_settings (primary_phone_number)
  where primary_phone_number is not null;
create unique index if not exists phone_meeting_sessions_twilio_call_sid_key
  on public.phone_meeting_sessions (twilio_call_sid)
  where twilio_call_sid is not null;
create unique index if not exists phone_meeting_sessions_twilio_recording_sid_key
  on public.phone_meeting_sessions (twilio_recording_sid)
  where twilio_recording_sid is not null;
create index if not exists phone_meeting_sessions_organization_created_idx
  on public.phone_meeting_sessions (organization_id, created_at desc);
create index if not exists phone_meeting_sessions_status_idx
  on public.phone_meeting_sessions (status, created_at desc);
create index if not exists phone_meeting_usage_events_organization_occurred_idx
  on public.phone_meeting_usage_events (organization_id, occurred_at desc);
create index if not exists phone_meeting_usage_events_session_idx
  on public.phone_meeting_usage_events (phone_meeting_session_id, occurred_at desc);
create index if not exists phone_meeting_retention_jobs_organization_scheduled_idx
  on public.phone_meeting_retention_jobs (organization_id, scheduled_for desc);
create index if not exists phone_meeting_retention_jobs_due_idx
  on public.phone_meeting_retention_jobs (scheduled_for, id)
  where status in ('pending', 'failed');
create index if not exists records_ai_usage_events_org_created_at_idx on public.records_ai_usage_events (organization_id, created_at desc);
create index if not exists records_ai_usage_events_user_created_at_idx on public.records_ai_usage_events (user_id, created_at desc);
create index if not exists music_generations_user_id_idx on public.music_generations (user_id);
create index if not exists music_generations_task_id_idx on public.music_generations (task_id);
create index if not exists music_generations_created_at_idx on public.music_generations (created_at desc);
create index if not exists profiles_stripe_customer_id_idx on public.profiles (stripe_customer_id);
create index if not exists music_profiles_stripe_customer_id_idx on public.music_profiles (stripe_customer_id);
create index if not exists music_profiles_stripe_subscription_id_idx on public.music_profiles (stripe_subscription_id);
create index if not exists music_profiles_stripe_price_id_idx on public.music_profiles (stripe_price_id);
create unique index if not exists reviews_target_unique_idx on public.reviews (app, review_target_type, review_target_id);
create index if not exists reviews_app_status_created_at_idx on public.reviews (app, status, created_at desc);
create index if not exists reviews_user_id_idx on public.reviews (user_id);
create index if not exists reviews_organization_id_idx on public.reviews (organization_id);
create index if not exists founding_partner_applications_email_idx on public.founding_partner_applications (lower(email));
create index if not exists founding_partner_applications_status_created_idx on public.founding_partner_applications (status, created_at desc);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();

  if lower(coalesce(new.email, '')) in ('quentin@n3xra.com', 'quentin@quentinnichols.com') then
    insert into public.platform_admins (user_id, email)
    values (new.id, new.email)
    on conflict (user_id) do update set email = excluded.email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.unique_org_slug(base_name text)
returns text
language plpgsql
as $$
declare
  base_slug text := nullif(public.slugify(base_name), '');
  candidate text := base_slug;
  suffix integer := 1;
begin
  if candidate is null then
    base_slug := 'library';
    candidate := 'library';
  end if;

  while exists (select 1 from public.organizations where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  return candidate;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) in ('quentin@n3xra.com', 'quentin@quentinnichols.com')
    or exists (
      select 1
      from public.platform_admins
      where user_id = auth.uid()
    );
$$;

create or replace function public.organization_role(target_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(
      (
        select case
          when om.role = 'account_owner' then 'account_admin'
          else om.role
        end
        from public.organization_memberships om
        where om.organization_id = target_organization_id
          and om.user_id = auth.uid()
        limit 1
      ),
      'viewer'
    );
$$;

create or replace function public.can_view_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organizations o
      where o.id = target_organization_id
        and o.owner_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
    );
$$;

create or replace function public.can_manage_members(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or public.organization_role(target_organization_id) = 'account_admin';
$$;

create or replace function public.can_manage_org_settings(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or public.organization_role(target_organization_id) = 'account_admin';
$$;

create or replace function public.can_manage_billing(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organizations o
      where o.id = target_organization_id
        and o.owner_user_id = auth.uid()
    );
$$;

create or replace function public.can_manage_documents(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or public.organization_role(target_organization_id) in ('account_admin', 'editor');
$$;

create or replace function public.can_manage_templates(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or public.organization_role(target_organization_id) = 'account_admin';
$$;

create or replace function public.can_manage_recordings(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.can_manage_documents(target_organization_id)
    and exists (
      select 1
      from public.organizations o
      where o.id = target_organization_id
        and o.subscription_tier = 'organization'
    );
$$;

create or replace function public.storage_object_org_id(storage_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(storage_name, '/', 1), '')::uuid;
$$;

drop function if exists public.get_public_embed_documents(uuid);

create or replace function public.get_public_embed_documents(input_organization_id uuid)
returns table (
  id uuid,
  title text,
  original_filename text,
  storage_path text,
  extracted_text text,
  year text,
  month text,
  created_at timestamptz,
  editable_document_id uuid,
  effective_title text,
  effective_original_filename text,
  effective_text text,
  has_editable_document boolean
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_organization_id is null then
    return;
  end if;

  if not exists (
    select 1
    from public.organizations o
    where o.id = input_organization_id
      and o.public_embed_enabled = true
  ) then
    return;
  end if;

  return query
  select
    d.id,
    d.title,
    d.original_filename,
    d.storage_path,
    d.extracted_text,
    d.year,
    d.month,
    d.created_at,
    ad.id as editable_document_id,
    coalesce(nullif(ad.title, ''), d.title) as effective_title,
    coalesce(
      case
        when ad.id is not null then nullif(trim(regexp_replace(coalesce(ad.title, ''), '\.[^.]+$', '')), '') || '.pdf'
        else null
      end,
      d.original_filename
    ) as effective_original_filename,
    coalesce(nullif(btrim(ad.plain_text), ''), d.extracted_text) as effective_text,
    ad.id is not null as has_editable_document
  from public.documents d
  left join lateral (
    select linked.id, linked.title, linked.plain_text, linked.status, linked.updated_at, linked.created_at
    from public.app_documents linked
    where linked.organization_id = d.organization_id
      and linked.source_document_id = d.id
      and linked.document_kind = 'document'
    order by
      (linked.status = 'final') desc,
      linked.updated_at desc nulls last,
      linked.created_at desc nulls last
    limit 1
  ) ad on true
  where d.organization_id = input_organization_id
    and d.is_public = true
  order by
    case
      when d.year ~ '^(19|20)[0-9]{2}$' then d.year::integer
      else null
    end desc nulls last,
    case lower(trim(coalesce(d.month, '')))
      when 'january' then 1
      when 'jan' then 1
      when 'february' then 2
      when 'feb' then 2
      when 'march' then 3
      when 'mar' then 3
      when 'april' then 4
      when 'apr' then 4
      when 'may' then 5
      when 'june' then 6
      when 'jun' then 6
      when 'july' then 7
      when 'jul' then 7
      when 'august' then 8
      when 'aug' then 8
      when 'september' then 9
      when 'sept' then 9
      when 'sep' then 9
      when 'october' then 10
      when 'oct' then 10
      when 'november' then 11
      when 'nov' then 11
      when 'december' then 12
      when 'dec' then 12
      else null
    end desc nulls last,
    d.created_at desc;
end;
$$;

grant execute on function public.get_public_embed_documents(uuid) to anon, authenticated;

create or replace function public.get_public_embed_config(input_organization_id uuid)
returns table (
  name text,
  branded_primary_color text,
  branded_accent_color text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if input_organization_id is null then
    return;
  end if;

  return query
  select
    o.name,
    o.branded_primary_color,
    o.branded_accent_color
  from public.organizations o
  where o.id = input_organization_id
    and o.public_embed_enabled = true;
end;
$$;

grant execute on function public.get_public_embed_config(uuid) to anon, authenticated;

create or replace function public.get_public_embed_config_by_slug(input_slug text)
returns table (
  id uuid,
  slug text,
  name text,
  branded_primary_color text,
  branded_accent_color text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(trim(input_slug), '') is null then
    return;
  end if;

  return query
  select
    o.id,
    o.slug,
    o.name,
    o.branded_primary_color,
    o.branded_accent_color
  from public.organizations o
  where o.slug = nullif(trim(input_slug), '')
    and o.public_embed_enabled = true
  limit 1;
end;
$$;

grant execute on function public.get_public_embed_config_by_slug(text) to anon, authenticated;

create or replace function public.bootstrap_organization(
  input_organization_name text default null,
  input_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := auth.jwt() ->> 'email';
  existing_membership record;
  next_org_id uuid;
  next_org_name text;
  explicit_invite_code text;
  metadata_invite_code text;
  bootstrap_org_id uuid;
  invite_result jsonb;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.profiles (id, email)
  values (current_user_id, current_email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  if lower(coalesce(current_email, '')) in ('quentin@n3xra.com', 'quentin@quentinnichols.com') then
    insert into public.platform_admins (user_id, email)
    values (current_user_id, current_email)
    on conflict (user_id) do update set email = excluded.email;
  end if;

  explicit_invite_code := nullif(trim(input_invite_code), '');
  metadata_invite_code := nullif(trim(auth.jwt() -> 'user_metadata' ->> 'invite_code'), '');

  select om.organization_id, o.name
  into existing_membership
  from public.organization_memberships om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = current_user_id
  order by om.created_at asc
  limit 1;

  if explicit_invite_code is not null then
    select public.redeem_invite_code(explicit_invite_code) into invite_result;
    bootstrap_org_id := nullif(invite_result ->> 'organization_id', '')::uuid;
    if bootstrap_org_id is null then
      raise exception 'Invite bootstrap did not return an organization.';
    end if;
  elsif existing_membership.organization_id is null and metadata_invite_code is not null then
    begin
      select public.redeem_invite_code(metadata_invite_code) into invite_result;
      bootstrap_org_id := nullif(invite_result ->> 'organization_id', '')::uuid;
    exception when others then
      bootstrap_org_id := null;
    end;
  end if;

  if bootstrap_org_id is not null then
    return jsonb_build_object('ok', true, 'active_organization_id', bootstrap_org_id);
  end if;

  if existing_membership.organization_id is null then
    next_org_name := coalesce(
      nullif(trim(input_organization_name), ''),
      nullif(trim(auth.jwt() -> 'user_metadata' ->> 'organization_name'), ''),
      'Personal'
    );

    insert into public.organizations (
      name,
      slug,
      owner_user_id
    ) values (
      next_org_name,
      public.unique_org_slug(next_org_name),
      current_user_id
    )
    returning id into next_org_id;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      created_by
    ) values (
      next_org_id,
      current_user_id,
      'account_admin',
      current_user_id
    );

    bootstrap_org_id := coalesce(bootstrap_org_id, next_org_id);
  else
    bootstrap_org_id := coalesce(bootstrap_org_id, existing_membership.organization_id);
  end if;

  return jsonb_build_object('ok', true, 'active_organization_id', bootstrap_org_id);
end;
$$;

create or replace function public.enforce_owned_organization_limit()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  owned_total integer;
  paid_owned_total integer;
  free_owned_total integer;
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if public.is_platform_admin() then
    return new;
  end if;

  if new.owner_user_id is distinct from auth.uid() then
    raise exception 'You can only create libraries for your own account.';
  end if;

  select count(*)
  into owned_total
  from public.organizations o
  where o.owner_user_id = new.owner_user_id;

  if coalesce(owned_total, 0) = 0 then
    return new;
  end if;

  select count(*)
  into paid_owned_total
  from public.organizations o
  where o.owner_user_id = new.owner_user_id
    and o.subscription_tier in ('starter', 'organization')
    and o.account_status not in ('canceled', 'suspended')
    and o.cancel_at_period_end = false;

  if coalesce(paid_owned_total, 0) = 0 then
    raise exception 'Upgrade one owned library to Starter or Organization before creating another library.';
  end if;

  select count(*)
  into free_owned_total
  from public.organizations o
  where o.owner_user_id = new.owner_user_id
    and o.subscription_tier = 'free'
    and o.account_status not in ('canceled', 'suspended');

  if coalesce(free_owned_total, 0) > 0 then
    raise exception 'Upgrade or remove your existing Free library before creating another library.';
  end if;

  return new;
end;
$$;

create or replace function public.create_owned_organization(
  input_organization_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  next_org_id uuid;
  next_org_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  next_org_name := coalesce(nullif(trim(input_organization_name), ''), 'Personal');

  insert into public.organizations (
    name,
    slug,
    owner_user_id
  ) values (
    next_org_name,
    public.unique_org_slug(next_org_name),
    current_user_id
  )
  returning id into next_org_id;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    next_org_id,
    current_user_id,
    'account_admin',
    current_user_id
  );

  return jsonb_build_object('ok', true, 'organization_id', next_org_id);
end;
$$;

grant execute on function public.create_owned_organization(text) to authenticated;
grant select, update, delete on public.founding_partner_applications to authenticated;
grant insert, select, update, delete on public.founding_partner_applications to service_role;

create or replace function public.bootstrap_music_profile()
returns public.music_profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := auth.jwt() ->> 'email';
  current_full_name text := nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), '');
  profile_record public.music_profiles%rowtype;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.profiles (id, email, full_name)
  values (current_user_id, current_email, current_full_name)
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();

  insert into public.music_profiles (user_id, display_name)
  values (current_user_id, current_full_name)
  on conflict (user_id) do nothing;

  select *
  into profile_record
  from public.music_profiles
  where user_id = current_user_id;

  if profile_record.current_period_end <= now() then
    update public.music_profiles
    set songs_used = 0,
        current_period_start = date_trunc('month', now()),
        current_period_end = date_trunc('month', now()) + interval '1 month',
        updated_at = now()
    where user_id = current_user_id
    returning * into profile_record;
  end if;

  return profile_record;
end;
$$;

grant execute on function public.bootstrap_music_profile() to authenticated;

create or replace function public.reserve_music_generation(
  input_title text default null,
  input_prompt text default null,
  input_lyrics text default null,
  input_instrumental boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  profile_record public.music_profiles%rowtype;
  next_generation_id uuid;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  perform public.bootstrap_music_profile();

  select *
  into profile_record
  from public.music_profiles
  where user_id = current_user_id
  for update;

  if profile_record.current_period_end <= now() then
    update public.music_profiles
    set songs_used = 0,
        current_period_start = date_trunc('month', now()),
        current_period_end = date_trunc('month', now()) + interval '1 month',
        updated_at = now()
    where user_id = current_user_id
    returning * into profile_record;
  end if;

  if profile_record.account_status not in ('active', 'trialing') then
    raise exception 'This AI Music account is not active.';
  end if;

  if profile_record.songs_used >= profile_record.monthly_song_limit then
    raise exception 'AI Music generation limit reached.';
  end if;

  insert into public.music_generations (
    user_id,
    title,
    prompt,
    lyrics,
    instrumental,
    status
  ) values (
    current_user_id,
    nullif(trim(input_title), ''),
    nullif(trim(input_prompt), ''),
    nullif(trim(input_lyrics), ''),
    coalesce(input_instrumental, false),
    'reserved'
  )
  returning id into next_generation_id;

  update public.music_profiles
  set songs_used = songs_used + 1,
      updated_at = now()
  where user_id = current_user_id
  returning * into profile_record;

  return jsonb_build_object(
    'generation_id', next_generation_id,
    'songs_used', profile_record.songs_used,
    'monthly_song_limit', profile_record.monthly_song_limit,
    'current_period_end', profile_record.current_period_end,
    'plan', profile_record.plan,
    'account_status', profile_record.account_status
  );
end;
$$;

grant execute on function public.reserve_music_generation(text, text, text, boolean) to authenticated;

create or replace function public.redeem_invite_code(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_user_email text;
  invite_record public.organization_invites%rowtype;
  next_member_count integer;
  target_user_limit integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select lower(trim(coalesce(profile.email, auth.jwt() ->> 'email', '')))
  into current_user_email
  from (select 1) as seed
  left join public.profiles as profile
    on profile.id = current_user_id;

  select *
  into invite_record
  from public.organization_invites
  where lower(code) = lower(trim(input_code))
  order by created_at desc
  limit 1;

  if invite_record.id is null then
    raise exception 'Invite code is invalid.';
  end if;

  if exists (
    select 1
    from public.organization_memberships
    where organization_id = invite_record.organization_id
      and user_id = current_user_id
  ) then
    update public.organization_contacts
    set linked_user_id = current_user_id
    where organization_id = invite_record.organization_id
      and current_user_email <> ''
      and lower(trim(email)) = current_user_email
      and linked_user_id is distinct from current_user_id;

    return jsonb_build_object(
      'ok', true,
      'already_member', true,
      'organization_id', invite_record.organization_id
    );
  end if;

  if invite_record.is_disabled = true
    or (invite_record.expires_at is not null and invite_record.expires_at <= now())
    or invite_record.redeemed_uses >= invite_record.max_uses then
    raise exception 'Invite code is invalid or expired.';
  end if;

  select count(*), max(o.user_limit)
  into next_member_count, target_user_limit
  from public.organization_memberships om
  join public.organizations o on o.id = invite_record.organization_id
  where om.organization_id = invite_record.organization_id;

  if coalesce(next_member_count, 0) >= coalesce(target_user_limit, 0) then
    raise exception 'This library has reached its user limit.';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    invite_record.organization_id,
    current_user_id,
    invite_record.role,
    invite_record.created_by
  );

  update public.organization_invites
  set redeemed_uses = redeemed_uses + 1
  where id = invite_record.id;

  update public.organization_contacts
  set linked_user_id = current_user_id
  where organization_id = invite_record.organization_id
    and current_user_email <> ''
    and lower(trim(email)) = current_user_email
    and linked_user_id is distinct from current_user_id;

  return jsonb_build_object('ok', true, 'organization_id', invite_record.organization_id);
end;
$$;

revoke execute on function public.redeem_invite_code(text) from public;
revoke execute on function public.redeem_invite_code(text) from anon;
grant execute on function public.redeem_invite_code(text) to authenticated;

create schema if not exists private;

create or replace function private.apply_new_meeting_recording_visibility()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  select coalesce(organization.records_admin_only_meetings_enabled, false)
  into new.admin_only
  from public.organizations as organization
  where organization.id = new.organization_id;

  new.admin_only := coalesce(new.admin_only, false);
  return new;
end;
$$;

revoke all on function private.apply_new_meeting_recording_visibility() from public, anon, authenticated;

create or replace function private.protect_admin_only_visibility_snapshot()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.admin_only is distinct from old.admin_only
     and current_user not in ('postgres', 'service_role') then
    raise exception 'Meeting-record visibility is fixed when the record is created.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_admin_only_visibility_snapshot() from public, anon, authenticated;

create or replace function private.can_read_admin_only_records_storage_object(
  input_bucket_id text,
  input_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_admin_only boolean;
begin
  if (select auth.uid()) is null then return false; end if;

  if input_bucket_id = 'meeting-recordings' then
    select recording.organization_id, recording.admin_only
    into target_organization_id, target_admin_only
    from public.meeting_recordings as recording
    where recording.organization_id = public.storage_object_org_id(input_name)
      and recording.id::text = split_part(input_name, '/', 2)
    limit 1;
  elsif input_bucket_id = 'documents' then
    select document.organization_id, document.admin_only
    into target_organization_id, target_admin_only
    from public.documents as document
    where document.storage_path = input_name
    limit 1;
  else
    return true;
  end if;

  if target_organization_id is null or not coalesce(target_admin_only, false) then return true; end if;

  return (
    (
      public.is_records_organization_member(target_organization_id)
      and (
        public.organization_role(target_organization_id) = 'account_admin'
        or exists (
          select 1 from public.organizations as organization
          where organization.id = target_organization_id
            and organization.owner_user_id = (select auth.uid())
        )
      )
    )
    or public.has_records_support_scope(
      target_organization_id,
      case input_bucket_id when 'meeting-recordings' then 'view_recordings' else 'view_documents' end
    )
  );
end;
$$;

revoke all on function private.can_read_admin_only_records_storage_object(text, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_read_admin_only_records_storage_object(text, text) to authenticated;

create or replace function private.claim_records_demo_workspace(
  input_code_hash text,
  input_claimant_user_id uuid,
  input_claimant_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  claim_record public.records_demo_workspace_claims%rowtype;
  organization_record public.organizations%rowtype;
  normalized_email text := lower(trim(coalesce(input_claimant_email, '')));
begin
  if input_claimant_user_id is null or nullif(trim(input_code_hash), '') is null then
    raise exception 'A valid claim code and account are required.';
  end if;

  if not exists (
    select 1
    from auth.users
    where id = input_claimant_user_id
      and lower(trim(coalesce(email, ''))) = normalized_email
  ) then
    raise exception 'The signed-in account could not be verified.';
  end if;

  select *
  into claim_record
  from public.records_demo_workspace_claims
  where code_hash = trim(input_code_hash)
  for update;

  if claim_record.id is not null
    and claim_record.status = 'claimed'
    and claim_record.claimed_by_user_id = input_claimant_user_id then
    return jsonb_build_object(
      'ok', true,
      'already_claimed', true,
      'organization_id', claim_record.organization_id
    );
  end if;

  if claim_record.id is null or claim_record.status <> 'pending' then
    raise exception 'This demo claim code is invalid or has already been used.';
  end if;

  if claim_record.expires_at is not null and claim_record.expires_at <= now() then
    update public.records_demo_workspace_claims
    set status = 'expired', updated_at = now()
    where id = claim_record.id;
    return jsonb_build_object(
      'ok', false,
      'error', 'This demo claim code has expired.'
    );
  end if;

  if claim_record.recipient_email is not null
    and lower(trim(claim_record.recipient_email)) <> normalized_email then
    raise exception 'This demo workspace was prepared for a different email address.';
  end if;

  select *
  into organization_record
  from public.organizations
  where id = claim_record.organization_id
  for update;

  if organization_record.id is null
    or organization_record.owner_user_id <> claim_record.created_by_user_id then
    raise exception 'This demo workspace is no longer available to claim.';
  end if;

  delete from public.organization_memberships
  where organization_id = claim_record.organization_id
    and user_id = claim_record.created_by_user_id
    and user_id <> input_claimant_user_id;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    claim_record.organization_id,
    input_claimant_user_id,
    'account_admin',
    claim_record.created_by_user_id
  )
  on conflict (organization_id, user_id) do update
    set role = 'account_admin',
        updated_at = now();

  update public.organizations
  set owner_user_id = input_claimant_user_id,
      updated_at = now()
  where id = claim_record.organization_id;

  update public.records_demo_workspace_claims
  set status = 'claimed',
      claimed_by_user_id = input_claimant_user_id,
      claimed_at = now(),
      updated_at = now()
  where id = claim_record.id;

  return jsonb_build_object(
    'ok', true,
    'organization_id', claim_record.organization_id,
    'organization_name', organization_record.name
  );
end;
$$;

revoke all on function private.claim_records_demo_workspace(text, uuid, text) from public, anon, authenticated;
grant usage on schema private to service_role;
grant execute on function private.claim_records_demo_workspace(text, uuid, text) to service_role;

create or replace function public.claim_records_demo_workspace(
  input_code_hash text,
  input_claimant_user_id uuid,
  input_claimant_email text
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.claim_records_demo_workspace(
    input_code_hash,
    input_claimant_user_id,
    input_claimant_email
  );
$$;

revoke all on function public.claim_records_demo_workspace(text, uuid, text) from public, anon, authenticated;
grant execute on function public.claim_records_demo_workspace(text, uuid, text) to service_role;

create or replace function public.create_organization_invite(
  input_organization_id uuid,
  input_role text default 'viewer',
  input_max_uses integer default 1,
  input_expires_at timestamptz default null
)
returns table (
  id uuid,
  code text,
  role text,
  max_uses integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_members(input_organization_id) then
    raise exception 'Not allowed to manage invite codes for this library.';
  end if;

  if exists (
    select 1
    from public.organizations o
    where o.id = input_organization_id
      and o.subscription_tier = 'free'
  ) then
    raise exception 'Invite codes are not available on the Free plan.';
  end if;

  return query
  insert into public.organization_invites (
    organization_id,
    code,
    role,
    max_uses,
    expires_at,
    created_by
  ) values (
    input_organization_id,
    upper(encode(extensions.gen_random_bytes(5), 'hex')),
    input_role,
    greatest(coalesce(input_max_uses, 1), 1),
    input_expires_at,
    auth.uid()
  )
  returning organization_invites.id, organization_invites.code, organization_invites.role, organization_invites.max_uses, organization_invites.expires_at;
end;
$$;

create or replace function public.update_membership_role(
  input_membership_id uuid,
  input_role text
)
returns public.organization_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
begin
  select *
  into membership_record
  from public.organization_memberships
  where id = input_membership_id;

  if membership_record.id is null then
    raise exception 'Membership not found.';
  end if;

  if not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Not allowed to update this membership.';
  end if;

  if input_role = 'account_owner' then
    raise exception 'Use explicit ownership transfer for account owner changes.';
  end if;

  update public.organization_memberships
  set role = input_role,
      updated_at = now()
  where id = input_membership_id
  returning * into membership_record;

  return membership_record;
end;
$$;

create or replace function public.remove_organization_member(
  input_membership_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
  organization_owner uuid;
begin
  select *
  into membership_record
  from public.organization_memberships
  where id = input_membership_id;

  if membership_record.id is null then
    raise exception 'Membership not found.';
  end if;

  if not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Not allowed to remove this member.';
  end if;

  select owner_user_id
  into organization_owner
  from public.organizations
  where id = membership_record.organization_id;

  if membership_record.user_id = organization_owner then
    raise exception 'Transfer ownership before removing the owner.';
  end if;

  if membership_record.user_id = auth.uid() then
    raise exception 'You cannot remove your own membership from this screen.';
  end if;

  delete from public.organization_memberships
  where id = membership_record.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.enforce_membership_owner_role()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.role = 'account_owner' then
    new.role := 'account_admin';
  end if;

  return new;
end;
$$;

create or replace function public.platform_set_organization_owner(
  input_organization_id uuid,
  input_user_id uuid
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  org_record public.organizations%rowtype;
  previous_owner uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required.';
  end if;

  select * into org_record
  from public.organizations
  where id = input_organization_id;

  if org_record.id is null then
    raise exception 'Organization not found.';
  end if;

  previous_owner := org_record.owner_user_id;

  insert into public.organization_memberships (organization_id, user_id, role, created_by)
  values (input_organization_id, input_user_id, 'account_admin', auth.uid())
  on conflict (organization_id, user_id) do update
    set role = 'account_admin',
        updated_at = now();

  update public.organization_memberships
  set role = 'account_admin',
      updated_at = now()
  where organization_id = input_organization_id
    and user_id = previous_owner
    and previous_owner <> input_user_id;

  update public.organizations
  set owner_user_id = input_user_id,
      updated_at = now()
  where id = input_organization_id
  returning * into org_record;

  return org_record;
end;
$$;

create or replace function public.protect_organization_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') then
    return new;
  end if;

  if not public.can_manage_billing(old.id) then
    if new.subscription_tier is distinct from old.subscription_tier
      or new.account_status is distinct from old.account_status
      or new.document_limit is distinct from old.document_limit
      or new.storage_limit_mb is distinct from old.storage_limit_mb
      or new.user_limit is distinct from old.user_limit
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_price_id is distinct from old.stripe_price_id
      or new.cancel_at_period_end is distinct from old.cancel_at_period_end
      or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
      raise exception 'Billing fields require account owner or platform admin access.';
    end if;
  end if;

  if not public.can_manage_org_settings(old.id) then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.public_embed_enabled is distinct from old.public_embed_enabled
      or new.public_embed_token is distinct from old.public_embed_token
      or new.transcript_preview_enabled is distinct from old.transcript_preview_enabled
      or new.keyword_search_enabled is distinct from old.keyword_search_enabled
      or new.file_preview_cards_enabled is distinct from old.file_preview_cards_enabled
      or new.hosted_public_portal_enabled is distinct from old.hosted_public_portal_enabled
      or new.branded_primary_color is distinct from old.branded_primary_color
      or new.branded_accent_color is distinct from old.branded_accent_color
      or new.logo_storage_path is distinct from old.logo_storage_path then
      raise exception 'Library settings require admin access.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.protect_profile_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') or public.is_platform_admin() then
    return new;
  end if;

  if new.stripe_customer_id is distinct from old.stripe_customer_id then
    raise exception 'Stripe customer fields require service access.';
  end if;

  return new;
end;
$$;

create or replace function public.protect_music_profile_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' or current_user in ('postgres', 'supabase_admin', 'service_role') or public.is_platform_admin() then
    return new;
  end if;

  if new.plan is distinct from old.plan
    or new.account_status is distinct from old.account_status
    or new.monthly_song_limit is distinct from old.monthly_song_limit
    or new.stripe_customer_id is distinct from old.stripe_customer_id
    or new.stripe_subscription_id is distinct from old.stripe_subscription_id
    or new.stripe_price_id is distinct from old.stripe_price_id
    or new.cancel_at_period_end is distinct from old.cancel_at_period_end
    or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
    raise exception 'AI Music billing fields require service access.';
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists profiles_protect_billing_fields on public.profiles;
create trigger profiles_protect_billing_fields
before update on public.profiles
for each row execute procedure public.protect_profile_billing_fields();

drop trigger if exists set_founding_partner_applications_updated_at on public.founding_partner_applications;
create trigger set_founding_partner_applications_updated_at
before update on public.founding_partner_applications
for each row execute procedure public.set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

drop trigger if exists organizations_enforce_owned_limit on public.organizations;
create trigger organizations_enforce_owned_limit
before insert on public.organizations
for each row execute procedure public.enforce_owned_organization_limit();

drop trigger if exists organization_memberships_set_updated_at on public.organization_memberships;
create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row execute procedure public.set_updated_at();

drop trigger if exists organization_memberships_enforce_owner_role on public.organization_memberships;
create trigger organization_memberships_enforce_owner_role
before insert or update on public.organization_memberships
for each row execute procedure public.enforce_membership_owner_role();

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row execute procedure public.set_updated_at();

drop trigger if exists app_documents_set_updated_at on public.app_documents;
create trigger app_documents_set_updated_at
before update on public.app_documents
for each row execute procedure public.set_updated_at();

drop trigger if exists organization_contacts_set_updated_at on public.organization_contacts;
create trigger organization_contacts_set_updated_at
before update on public.organization_contacts
for each row execute procedure public.set_updated_at();

drop trigger if exists meeting_recordings_set_updated_at on public.meeting_recordings;
create trigger meeting_recordings_set_updated_at
before update on public.meeting_recordings
for each row execute procedure public.set_updated_at();

drop trigger if exists apply_new_meeting_recording_visibility on public.meeting_recordings;
create trigger apply_new_meeting_recording_visibility
before insert on public.meeting_recordings
for each row execute function private.apply_new_meeting_recording_visibility();

drop trigger if exists protect_meeting_recording_visibility_snapshot on public.meeting_recordings;
create trigger protect_meeting_recording_visibility_snapshot
before update of admin_only on public.meeting_recordings
for each row execute function private.protect_admin_only_visibility_snapshot();

drop trigger if exists protect_transcript_visibility_snapshot on public.documents;
create trigger protect_transcript_visibility_snapshot
before update of admin_only on public.documents
for each row execute function private.protect_admin_only_visibility_snapshot();

drop trigger if exists meeting_recording_chunks_set_updated_at on public.meeting_recording_chunks;
create trigger meeting_recording_chunks_set_updated_at
before update on public.meeting_recording_chunks
for each row execute procedure public.set_updated_at();

drop trigger if exists meeting_recording_interruptions_set_updated_at on public.meeting_recording_interruptions;
create trigger meeting_recording_interruptions_set_updated_at
before update on public.meeting_recording_interruptions
for each row execute procedure public.set_updated_at();

drop trigger if exists organization_phone_meeting_settings_set_updated_at on public.organization_phone_meeting_settings;
create trigger organization_phone_meeting_settings_set_updated_at
before update on public.organization_phone_meeting_settings
for each row execute procedure public.set_updated_at();

drop trigger if exists phone_meeting_sessions_set_updated_at on public.phone_meeting_sessions;
create trigger phone_meeting_sessions_set_updated_at
before update on public.phone_meeting_sessions
for each row execute procedure public.set_updated_at();

drop trigger if exists phone_meeting_retention_jobs_set_updated_at on public.phone_meeting_retention_jobs;
create trigger phone_meeting_retention_jobs_set_updated_at
before update on public.phone_meeting_retention_jobs
for each row execute procedure public.set_updated_at();

drop trigger if exists phone_meeting_sessions_queue_retention_job on public.phone_meeting_sessions;
create trigger phone_meeting_sessions_queue_retention_job
after insert or update of retention_until, status
on public.phone_meeting_sessions
for each row execute function public.queue_phone_meeting_retention_job();

drop trigger if exists music_profiles_set_updated_at on public.music_profiles;
create trigger music_profiles_set_updated_at
before update on public.music_profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists music_profiles_protect_billing_fields on public.music_profiles;
create trigger music_profiles_protect_billing_fields
before update on public.music_profiles
for each row execute procedure public.protect_music_profile_billing_fields();

drop trigger if exists music_generations_set_updated_at on public.music_generations;
create trigger music_generations_set_updated_at
before update on public.music_generations
for each row execute procedure public.set_updated_at();

drop trigger if exists reviews_set_updated_at on public.reviews;
create trigger reviews_set_updated_at
before update on public.reviews
for each row execute procedure public.set_updated_at();

drop trigger if exists organizations_protect_billing_fields on public.organizations;
create trigger organizations_protect_billing_fields
before update on public.organizations
for each row execute procedure public.protect_organization_billing_fields();

update public.organization_memberships om
set role = case
  when om.role = 'account_owner' then 'account_admin'
  else om.role
end
from public.organizations o
where o.id = om.organization_id
  and om.role = 'account_owner';

alter table public.organization_memberships
  drop constraint if exists organization_memberships_role_check;

alter table public.organization_memberships
  add constraint organization_memberships_role_check
  check (role in ('account_admin', 'editor', 'viewer'));

update public.organization_memberships
set role = 'viewer'
where role = 'guest';

alter table public.organization_invites
  drop constraint if exists organization_invites_role_check;

alter table public.organization_invites
  add constraint organization_invites_role_check
  check (role in ('account_admin', 'editor', 'viewer'));

update public.organization_invites
set role = 'viewer'
where role = 'guest';

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.founding_partner_applications enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invites enable row level security;
alter table public.records_demo_workspace_claims enable row level security;
revoke all on table public.records_demo_workspace_claims from anon, authenticated;
grant all on table public.records_demo_workspace_claims to service_role;
alter table public.organization_contacts enable row level security;
alter table public.documents enable row level security;
alter table public.app_documents enable row level security;
alter table public.document_share_links enable row level security;
alter table public.meeting_recordings enable row level security;
alter table public.meeting_recording_chunks enable row level security;
alter table public.meeting_recording_interruptions enable row level security;
alter table public.organization_phone_meeting_settings enable row level security;
alter table public.phone_meeting_sessions enable row level security;
alter table public.phone_meeting_usage_events enable row level security;
alter table public.phone_meeting_retention_jobs enable row level security;
alter table public.records_ai_usage_events enable row level security;
alter table public.music_profiles enable row level security;
alter table public.music_generations enable row level security;
alter table public.reviews enable row level security;

drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy"
on public.profiles
for select
using (
  auth.uid() = id
  or public.is_platform_admin()
  or exists (
    select 1
    from public.organization_memberships self_om
    join public.organization_memberships target_om
      on target_om.organization_id = self_om.organization_id
    where self_om.user_id = auth.uid()
      and target_om.user_id = profiles.id
  )
);

drop policy if exists "profiles_update_policy" on public.profiles;
create policy "profiles_update_policy"
on public.profiles
for update
using (auth.uid() = id or public.is_platform_admin())
with check (auth.uid() = id or public.is_platform_admin());

drop policy if exists "music_profiles_select_policy" on public.music_profiles;
create policy "music_profiles_select_policy"
on public.music_profiles
for select
using (auth.uid() = user_id or public.is_platform_admin());

drop policy if exists "music_generations_select_policy" on public.music_generations;
create policy "music_generations_select_policy"
on public.music_generations
for select
using (auth.uid() = user_id or public.is_platform_admin());

drop policy if exists "reviews_select_policy" on public.reviews;
create policy "reviews_select_policy"
on public.reviews
for select
using (
  public.is_platform_admin()
  or (
    app = 'records'
    and organization_id is not null
    and public.can_view_organization(organization_id)
  )
  or (
    app = 'ai_music'
    and user_id = auth.uid()
  )
);

drop policy if exists "reviews_insert_policy" on public.reviews;
create policy "reviews_insert_policy"
on public.reviews
for insert
with check (
  (
    app = 'records'
    and review_target_type = 'organization'
    and organization_id = review_target_id
    and user_id = auth.uid()
    and public.can_manage_org_settings(organization_id)
  )
  or (
    app = 'ai_music'
    and review_target_type = 'profile'
    and review_target_id = auth.uid()
    and user_id = auth.uid()
    and organization_id is null
  )
  or public.is_platform_admin()
);

drop policy if exists "reviews_update_policy" on public.reviews;
create policy "reviews_update_policy"
on public.reviews
for update
using (
  public.is_platform_admin()
  or (
    app = 'records'
    and organization_id is not null
    and public.can_manage_org_settings(organization_id)
  )
  or (
    app = 'ai_music'
    and user_id = auth.uid()
  )
)
with check (
  public.is_platform_admin()
  or (
    app = 'records'
    and review_target_type = 'organization'
    and organization_id = review_target_id
    and public.can_manage_org_settings(organization_id)
  )
  or (
    app = 'ai_music'
    and review_target_type = 'profile'
    and review_target_id = auth.uid()
    and user_id = auth.uid()
    and organization_id is null
  )
);

drop policy if exists "platform_admins_select_policy" on public.platform_admins;
create policy "platform_admins_select_policy"
on public.platform_admins
for select
using (public.is_platform_admin());

drop policy if exists "founding_partner_applications_select_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_select_policy"
on public.founding_partner_applications
for select
using (public.is_platform_admin());

drop policy if exists "founding_partner_applications_insert_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_insert_policy"
on public.founding_partner_applications
for insert
with check (public.is_platform_admin());

drop policy if exists "founding_partner_applications_update_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_update_policy"
on public.founding_partner_applications
for update
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "founding_partner_applications_delete_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_delete_policy"
on public.founding_partner_applications
for delete
using (public.is_platform_admin());

drop policy if exists "organizations_select_policy" on public.organizations;
create policy "organizations_select_policy"
on public.organizations
for select
using (public.can_view_organization(id));

drop policy if exists "organizations_insert_policy" on public.organizations;
create policy "organizations_insert_policy"
on public.organizations
for insert
with check (auth.uid() = owner_user_id or public.is_platform_admin());

drop policy if exists "organizations_update_policy" on public.organizations;
create policy "organizations_update_policy"
on public.organizations
for update
using (public.can_manage_org_settings(id) or public.can_manage_billing(id))
with check (public.can_manage_org_settings(id) or public.can_manage_billing(id));

drop policy if exists "organization_memberships_select_policy" on public.organization_memberships;
create policy "organization_memberships_select_policy"
on public.organization_memberships
for select
using (public.can_view_organization(organization_id));

drop policy if exists "organization_memberships_insert_policy" on public.organization_memberships;
create policy "organization_memberships_insert_policy"
on public.organization_memberships
for insert
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_memberships_update_policy" on public.organization_memberships;
create policy "organization_memberships_update_policy"
on public.organization_memberships
for update
using (public.can_manage_members(organization_id))
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_invites_select_policy" on public.organization_invites;
create policy "organization_invites_select_policy"
on public.organization_invites
for select
using (public.can_manage_members(organization_id));

drop policy if exists "organization_invites_manage_policy" on public.organization_invites;
create policy "organization_invites_manage_policy"
on public.organization_invites
for all
using (public.can_manage_members(organization_id))
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_contacts_select_policy" on public.organization_contacts;
create policy "organization_contacts_select_policy"
on public.organization_contacts
for select
using (
  public.can_manage_members(organization_id)
  or public.can_manage_documents(organization_id)
);

drop policy if exists "organization_contacts_insert_policy" on public.organization_contacts;
create policy "organization_contacts_insert_policy"
on public.organization_contacts
for insert
with check (
  public.can_manage_members(organization_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists "organization_contacts_update_policy" on public.organization_contacts;
create policy "organization_contacts_update_policy"
on public.organization_contacts
for update
using (public.can_manage_members(organization_id))
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_contacts_delete_policy" on public.organization_contacts;
create policy "organization_contacts_delete_policy"
on public.organization_contacts
for delete
using (public.can_manage_members(organization_id));

drop policy if exists "documents_select_policy" on public.documents;
create policy "documents_select_policy"
on public.documents
for select
using (
  public.can_view_organization(organization_id)
  or (
    is_public = true
    and exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.public_embed_enabled = true
    )
  )
);

drop policy if exists "documents_insert_policy" on public.documents;
create policy "documents_insert_policy"
on public.documents
for insert
with check (
  public.can_manage_documents(organization_id)
  and uploaded_by_user_id = auth.uid()
);

drop policy if exists "documents_update_policy" on public.documents;
create policy "documents_update_policy"
on public.documents
for update
using (public.can_manage_documents(organization_id))
with check (public.can_manage_documents(organization_id));

drop policy if exists "documents_delete_policy" on public.documents;
create policy "documents_delete_policy"
on public.documents
for delete
using (public.can_manage_documents(organization_id));

drop policy if exists "app_documents_select_policy" on public.app_documents;
create policy "app_documents_select_policy"
on public.app_documents
for select
using (public.can_view_organization(organization_id));

drop policy if exists "app_documents_insert_policy" on public.app_documents;
create policy "app_documents_insert_policy"
on public.app_documents
for insert
with check (
  created_by_user_id = auth.uid()
  and (
    (document_kind = 'document' and public.can_manage_documents(organization_id))
    or (document_kind = 'template' and public.can_manage_templates(organization_id))
  )
);

drop policy if exists "app_documents_update_policy" on public.app_documents;
create policy "app_documents_update_policy"
on public.app_documents
for update
using (
  (document_kind = 'document' and public.can_manage_documents(organization_id))
  or (document_kind = 'template' and public.can_manage_templates(organization_id))
)
with check (
  (document_kind = 'document' and public.can_manage_documents(organization_id))
  or (document_kind = 'template' and public.can_manage_templates(organization_id))
);

drop policy if exists "app_documents_delete_policy" on public.app_documents;
create policy "app_documents_delete_policy"
on public.app_documents
for delete
using (
  (document_kind = 'document' and public.can_manage_documents(organization_id))
  or (document_kind = 'template' and public.can_manage_templates(organization_id))
);

drop policy if exists "meeting_recordings_select_policy" on public.meeting_recordings;
create policy "meeting_recordings_select_policy"
on public.meeting_recordings
for select
using (public.can_view_organization(organization_id));

drop policy if exists "meeting_recordings_insert_policy" on public.meeting_recordings;
create policy "meeting_recordings_insert_policy"
on public.meeting_recordings
for insert
with check (
  public.can_manage_recordings(organization_id)
  and created_by_user_id = auth.uid()
);

drop policy if exists "meeting_recordings_update_policy" on public.meeting_recordings;
create policy "meeting_recordings_update_policy"
on public.meeting_recordings
for update
using (public.can_manage_recordings(organization_id))
with check (public.can_manage_recordings(organization_id));

drop policy if exists "meeting_recordings_delete_policy" on public.meeting_recordings;
create policy "meeting_recordings_delete_policy"
on public.meeting_recordings
for delete
using (public.can_manage_recordings(organization_id));

create policy "meeting_recording_chunks_select_policy" on public.meeting_recording_chunks
for select to authenticated using (public.can_view_organization(organization_id));
create policy "meeting_recording_chunks_insert_policy" on public.meeting_recording_chunks
for insert to authenticated with check (
  created_by_user_id = (select auth.uid()) and public.can_manage_recordings(organization_id)
  and exists (select 1 from public.meeting_recordings mr where mr.id = meeting_recording_id and mr.organization_id = organization_id)
);
create policy "meeting_recording_chunks_update_policy" on public.meeting_recording_chunks
for update to authenticated using (public.can_manage_recordings(organization_id)) with check (public.can_manage_recordings(organization_id));
create policy "meeting_recording_chunks_delete_policy" on public.meeting_recording_chunks
for delete to authenticated using (public.can_manage_recordings(organization_id));

create policy "meeting_recording_interruptions_select_policy" on public.meeting_recording_interruptions
for select to authenticated using (public.can_view_organization(organization_id));
create policy "meeting_recording_interruptions_insert_policy" on public.meeting_recording_interruptions
for insert to authenticated with check (
  created_by_user_id = (select auth.uid()) and public.can_manage_recordings(organization_id)
  and exists (select 1 from public.meeting_recordings mr where mr.id = meeting_recording_id and mr.organization_id = organization_id)
);
create policy "meeting_recording_interruptions_update_policy" on public.meeting_recording_interruptions
for update to authenticated using (public.can_manage_recordings(organization_id)) with check (public.can_manage_recordings(organization_id));
create policy "meeting_recording_interruptions_delete_policy" on public.meeting_recording_interruptions
for delete to authenticated using (public.can_manage_recordings(organization_id));

drop policy if exists "organization_phone_meeting_settings_select_policy" on public.organization_phone_meeting_settings;
create policy "organization_phone_meeting_settings_select_policy"
on public.organization_phone_meeting_settings
for select to authenticated
using (public.can_view_organization(organization_id));

drop policy if exists "organization_phone_meeting_settings_insert_policy" on public.organization_phone_meeting_settings;
create policy "organization_phone_meeting_settings_insert_policy"
on public.organization_phone_meeting_settings
for insert to authenticated
with check (public.is_platform_admin());

drop policy if exists "organization_phone_meeting_settings_update_policy" on public.organization_phone_meeting_settings;
create policy "organization_phone_meeting_settings_update_policy"
on public.organization_phone_meeting_settings
for update to authenticated
using (public.is_platform_admin())
with check (public.is_platform_admin());

drop policy if exists "phone_meeting_sessions_select_policy" on public.phone_meeting_sessions;
create policy "phone_meeting_sessions_select_policy"
on public.phone_meeting_sessions
for select to authenticated
using (public.can_view_organization(organization_id));

drop policy if exists "phone_meeting_usage_events_select_policy" on public.phone_meeting_usage_events;
create policy "phone_meeting_usage_events_select_policy"
on public.phone_meeting_usage_events
for select to authenticated
using (public.can_view_organization(organization_id));

drop policy if exists "phone_meeting_retention_jobs_select_policy" on public.phone_meeting_retention_jobs;
create policy "phone_meeting_retention_jobs_select_policy"
on public.phone_meeting_retention_jobs
for select to authenticated
using ((select public.can_view_organization(organization_id)));

drop policy if exists "records_ai_usage_events_select_policy" on public.records_ai_usage_events;
create policy "records_ai_usage_events_select_policy"
on public.records_ai_usage_events
for select
using (public.can_view_organization(organization_id));

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('meeting-recordings', 'meeting-recordings', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('organization-assets', 'organization-assets', false)
on conflict (id) do nothing;

drop policy if exists "storage_select_documents_policy" on storage.objects;
create policy "storage_select_documents_policy"
on storage.objects
for select
using (
  bucket_id = 'documents'
  and (
    public.can_view_organization(public.storage_object_org_id(name))
    or exists (
      select 1
      from public.documents d
      join public.organizations o on o.id = d.organization_id
      where d.storage_path = name
        and d.is_public = true
        and o.public_embed_enabled = true
    )
  )
);

drop policy if exists "storage_insert_documents_policy" on storage.objects;
create policy "storage_insert_documents_policy"
on storage.objects
for insert
with check (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
);

drop policy if exists "storage_update_documents_policy" on storage.objects;
create policy "storage_update_documents_policy"
on storage.objects
for update
using (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
)
with check (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
);

drop policy if exists "storage_delete_documents_policy" on storage.objects;
create policy "storage_delete_documents_policy"
on storage.objects
for delete
using (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
);

drop policy if exists "storage_select_organization_assets_policy" on storage.objects;
create policy "storage_select_organization_assets_policy"
on storage.objects
for select
using (
  bucket_id = 'organization-assets'
  and public.can_view_organization(public.storage_object_org_id(name))
);

drop policy if exists "storage_insert_organization_assets_policy" on storage.objects;
create policy "storage_insert_organization_assets_policy"
on storage.objects
for insert
with check (
  bucket_id = 'organization-assets'
  and public.can_manage_org_settings(public.storage_object_org_id(name))
);

drop policy if exists "storage_update_organization_assets_policy" on storage.objects;
create policy "storage_update_organization_assets_policy"
on storage.objects
for update
using (
  bucket_id = 'organization-assets'
  and public.can_manage_org_settings(public.storage_object_org_id(name))
)
with check (
  bucket_id = 'organization-assets'
  and public.can_manage_org_settings(public.storage_object_org_id(name))
);

drop policy if exists "storage_delete_organization_assets_policy" on storage.objects;
create policy "storage_delete_organization_assets_policy"
on storage.objects
for delete
using (
  bucket_id = 'organization-assets'
  and public.can_manage_org_settings(public.storage_object_org_id(name))
);

drop policy if exists "storage_select_meeting_recordings_policy" on storage.objects;
create policy "storage_select_meeting_recordings_policy"
on storage.objects
for select
using (
  bucket_id = 'meeting-recordings'
  and public.can_view_organization(public.storage_object_org_id(name))
);

drop policy if exists "storage_insert_meeting_recordings_policy" on storage.objects;
create policy "storage_insert_meeting_recordings_policy"
on storage.objects
for insert
with check (
  bucket_id = 'meeting-recordings'
  and public.can_manage_recordings(public.storage_object_org_id(name))
);

drop policy if exists "storage_update_meeting_recordings_policy" on storage.objects;
create policy "storage_update_meeting_recordings_policy"
on storage.objects
for update
using (
  bucket_id = 'meeting-recordings'
  and public.can_manage_recordings(public.storage_object_org_id(name))
)
with check (
  bucket_id = 'meeting-recordings'
  and public.can_manage_recordings(public.storage_object_org_id(name))
);

drop policy if exists "storage_delete_meeting_recordings_policy" on storage.objects;
create policy "storage_delete_meeting_recordings_policy"
on storage.objects
for delete
using (
  bucket_id = 'meeting-recordings'
  and public.can_manage_recordings(public.storage_object_org_id(name))
);

-- Privacy snapshots narrow existing access policies without replacing them.
drop policy if exists "meeting_recordings_admin_only_select" on public.meeting_recordings;
create policy "meeting_recordings_admin_only_select" on public.meeting_recordings
as restrictive for select to authenticated using (
  not admin_only
  or (
    public.is_records_organization_member(organization_id)
    and (
      public.organization_role(organization_id) = 'account_admin'
      or exists (
        select 1 from public.organizations as organization
        where organization.id = meeting_recordings.organization_id
          and organization.owner_user_id = (select auth.uid())
      )
    )
  )
  or public.has_records_support_scope(organization_id, 'view_recordings')
);

drop policy if exists "meeting_recordings_admin_only_insert" on public.meeting_recordings;
create policy "meeting_recordings_admin_only_insert" on public.meeting_recordings
as restrictive for insert to authenticated with check (
  not admin_only
  or public.organization_role(organization_id) = 'account_admin'
  or exists (
    select 1 from public.organizations as organization
    where organization.id = meeting_recordings.organization_id
      and organization.owner_user_id = (select auth.uid())
  )
);

drop policy if exists "documents_admin_only_select" on public.documents;
create policy "documents_admin_only_select" on public.documents
as restrictive for select to authenticated using (
  not admin_only
  or (
    public.is_records_organization_member(organization_id)
    and (
      public.organization_role(organization_id) = 'account_admin'
      or exists (
        select 1 from public.organizations as organization
        where organization.id = documents.organization_id
          and organization.owner_user_id = (select auth.uid())
      )
    )
  )
  or public.has_records_support_scope(organization_id, 'view_documents')
);

drop policy if exists "meeting_recording_chunks_admin_only_select" on public.meeting_recording_chunks;
create policy "meeting_recording_chunks_admin_only_select" on public.meeting_recording_chunks
as restrictive for select to authenticated using (
  exists (
    select 1 from public.meeting_recordings as recording
    where recording.id = meeting_recording_chunks.meeting_recording_id
      and recording.organization_id = meeting_recording_chunks.organization_id
      and (
        not recording.admin_only
        or public.organization_role(recording.organization_id) = 'account_admin'
        or exists (
          select 1 from public.organizations as organization
          where organization.id = recording.organization_id
            and organization.owner_user_id = (select auth.uid())
        )
        or public.has_records_support_scope(recording.organization_id, 'view_recordings')
      )
  )
);

drop policy if exists "meeting_recording_interruptions_admin_only_select" on public.meeting_recording_interruptions;
create policy "meeting_recording_interruptions_admin_only_select" on public.meeting_recording_interruptions
as restrictive for select to authenticated using (
  exists (
    select 1 from public.meeting_recordings as recording
    where recording.id = meeting_recording_interruptions.meeting_recording_id
      and recording.organization_id = meeting_recording_interruptions.organization_id
      and (
        not recording.admin_only
        or public.organization_role(recording.organization_id) = 'account_admin'
        or exists (
          select 1 from public.organizations as organization
          where organization.id = recording.organization_id
            and organization.owner_user_id = (select auth.uid())
        )
        or public.has_records_support_scope(recording.organization_id, 'view_recordings')
      )
  )
);

drop policy if exists "storage_admin_only_records_select" on storage.objects;
create policy "storage_admin_only_records_select" on storage.objects
as restrictive for select to authenticated
using (private.can_read_admin_only_records_storage_object(bucket_id, name));

-- Meeting content privacy is dynamic: meeting-note detail rows remain visible,
-- while audio objects, transcript documents, and raw transcript columns are
-- restricted whenever the organization setting is enabled.
drop policy if exists "meeting_recordings_admin_only_select" on public.meeting_recordings;
drop policy if exists "meeting_recordings_admin_only_insert" on public.meeting_recordings;
drop policy if exists "meeting_recording_interruptions_admin_only_select" on public.meeting_recording_interruptions;

drop trigger if exists protect_meeting_recording_visibility_snapshot on public.meeting_recordings;
drop trigger if exists protect_transcript_visibility_snapshot on public.documents;
drop function if exists private.protect_admin_only_visibility_snapshot();

comment on column public.organizations.records_admin_only_meetings_enabled is
  'When enabled, all meeting audio and transcript content is restricted to account admins. Meeting-note detail rows remain visible.';
comment on column public.meeting_recordings.admin_only is
  'Organization privacy mirror activated after the transcript document exists; it protects content without hiding the meeting-note detail row.';

create or replace function private.apply_new_meeting_recording_visibility()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  select (
    coalesce(organization.records_admin_only_meetings_enabled, false)
    and new.document_id is not null
  )
  into new.admin_only
  from public.organizations as organization
  where organization.id = new.organization_id;
  new.admin_only := coalesce(new.admin_only, false);
  return new;
end;
$$;

revoke all on function private.apply_new_meeting_recording_visibility() from public, anon, authenticated;
drop trigger if exists apply_new_meeting_recording_visibility_after_document on public.meeting_recordings;
create trigger apply_new_meeting_recording_visibility_after_document
before update of organization_id, document_id on public.meeting_recordings
for each row execute function private.apply_new_meeting_recording_visibility();

create or replace function private.sync_recording_transcript_document_privacy()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.document_id is not null then
    update public.documents
       set admin_only = new.admin_only,
           is_public = case when new.admin_only then false else is_public end
     where id = new.document_id
       and (admin_only is distinct from new.admin_only or (new.admin_only and is_public));
  end if;
  return new;
end;
$$;

revoke all on function private.sync_recording_transcript_document_privacy() from public, anon, authenticated;
drop trigger if exists sync_recording_transcript_document_privacy on public.meeting_recordings;
create trigger sync_recording_transcript_document_privacy
after insert or update of document_id, admin_only on public.meeting_recordings
for each row execute function private.sync_recording_transcript_document_privacy();

create or replace function private.sync_organization_meeting_content_privacy()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.records_admin_only_meetings_enabled is not distinct from old.records_admin_only_meetings_enabled then
    return new;
  end if;

  update public.meeting_recordings
     set admin_only = (new.records_admin_only_meetings_enabled and document_id is not null)
   where organization_id = new.id
     and admin_only is distinct from (new.records_admin_only_meetings_enabled and document_id is not null);

  update public.documents as document
     set admin_only = new.records_admin_only_meetings_enabled,
         is_public = case when new.records_admin_only_meetings_enabled then false else document.is_public end
   where document.organization_id = new.id
     and exists (
       select 1 from public.meeting_recordings as recording
       where recording.document_id = document.id
     )
     and (
       document.admin_only is distinct from new.records_admin_only_meetings_enabled
       or (new.records_admin_only_meetings_enabled and document.is_public)
     );

  return new;
end;
$$;

revoke all on function private.sync_organization_meeting_content_privacy() from public, anon, authenticated;

drop trigger if exists sync_organization_meeting_content_privacy on public.organizations;
create trigger sync_organization_meeting_content_privacy
after update of records_admin_only_meetings_enabled on public.organizations
for each row execute function private.sync_organization_meeting_content_privacy();

create or replace function private.can_read_admin_only_records_storage_object(
  input_bucket_id text,
  input_name text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_organization_id uuid;
  target_admin_only boolean;
  target_created_by_user_id uuid;
  target_document_id uuid;
begin
  if (select auth.uid()) is null then return false; end if;
  if input_bucket_id = 'meeting-recordings' then
    select recording.organization_id, recording.admin_only,
           recording.created_by_user_id, recording.document_id
      into target_organization_id, target_admin_only,
           target_created_by_user_id, target_document_id
      from public.meeting_recordings as recording
     where recording.organization_id = public.storage_object_org_id(input_name)
       and recording.id::text = split_part(input_name, '/', 2)
     limit 1;
  elsif input_bucket_id = 'documents' then
    select document.organization_id, document.admin_only
      into target_organization_id, target_admin_only
      from public.documents as document
     where document.storage_path = input_name
     limit 1;
  else
    return true;
  end if;
  if target_organization_id is null or not coalesce(target_admin_only, false) then return true; end if;
  if input_bucket_id = 'meeting-recordings'
     and target_document_id is null
     and target_created_by_user_id = (select auth.uid()) then
    return true;
  end if;
  return (
    (
      public.is_records_organization_member(target_organization_id)
      and (
        public.organization_role(target_organization_id) = 'account_admin'
        or exists (
          select 1 from public.organizations as organization
          where organization.id = target_organization_id
            and organization.owner_user_id = (select auth.uid())
        )
      )
    )
    or public.has_records_support_scope(
      target_organization_id,
      case input_bucket_id when 'meeting-recordings' then 'view_recordings' else 'view_documents' end
    )
  );
end;
$$;

revoke all on function private.can_read_admin_only_records_storage_object(text, text) from public, anon;
grant execute on function private.can_read_admin_only_records_storage_object(text, text) to authenticated;

drop policy if exists "meeting_recording_chunks_admin_only_select" on public.meeting_recording_chunks;
create policy "meeting_recording_chunks_admin_only_select"
on public.meeting_recording_chunks as restrictive for select to authenticated using (
  exists (
    select 1 from public.meeting_recordings as recording
    where recording.id = meeting_recording_chunks.meeting_recording_id
      and recording.organization_id = meeting_recording_chunks.organization_id
      and (
        not recording.admin_only
        or (recording.document_id is null and recording.created_by_user_id = (select auth.uid()))
        or public.organization_role(recording.organization_id) = 'account_admin'
        or exists (
          select 1 from public.organizations as organization
          where organization.id = recording.organization_id
            and organization.owner_user_id = (select auth.uid())
        )
        or public.has_records_support_scope(recording.organization_id, 'view_recordings')
      )
  )
);

revoke select on public.meeting_recordings from anon, authenticated;
grant select (
  id, organization_id, created_by_user_id, document_id, title, status,
  transcript_status, started_at, ended_at, duration_seconds, storage_path,
  storage_bucket, audio_mime_type, file_size, processing_error,
  transcript_generated_at, metadata, created_at, updated_at,
  selected_template_id, notes_content_json, notes_plain_text,
  notes_updated_at, ai_review_status, ai_review_json, ai_reviewed_at,
  ai_draft_document_id, final_document_id, processing_stage,
  processing_progress, processing_started_at, processing_updated_at,
  processing_completed_at, minutes_style, speaker_identification_status,
  speaker_identification_job_id, speaker_identification_model,
  speaker_identification_threshold, speaker_identification_error,
  speaker_identified_at, speaker_identification_updated_at, admin_only
) on public.meeting_recordings to anon, authenticated;

create or replace function public.get_meeting_recording_private_content(
  input_organization_id uuid,
  input_recording_ids uuid[]
)
returns table (
  id uuid,
  transcript_text text,
  transcript_timing_json jsonb,
  speaker_transcript_text text,
  speaker_identification_json jsonb
)
language sql
stable
security definer
set search_path = ''
as $$
  select recording.id, recording.transcript_text,
         recording.transcript_timing_json, recording.speaker_transcript_text,
         recording.speaker_identification_json
  from public.meeting_recordings as recording
  where (select auth.uid()) is not null
    and recording.organization_id = input_organization_id
    and recording.id = any(coalesce(input_recording_ids, array[]::uuid[]))
    and cardinality(coalesce(input_recording_ids, array[]::uuid[])) <= 250
    and (
      public.is_records_organization_member(recording.organization_id)
      or public.has_records_support_scope(recording.organization_id, 'view_recordings')
    )
    and (
      not recording.admin_only
      or (recording.document_id is null and recording.created_by_user_id = (select auth.uid()))
      or public.organization_role(recording.organization_id) = 'account_admin'
      or exists (
        select 1 from public.organizations as organization
        where organization.id = recording.organization_id
          and organization.owner_user_id = (select auth.uid())
      )
      or public.has_records_support_scope(recording.organization_id, 'view_recordings')
    );
$$;

revoke all on function public.get_meeting_recording_private_content(uuid, uuid[]) from public, anon;
grant execute on function public.get_meeting_recording_private_content(uuid, uuid[]) to authenticated;
