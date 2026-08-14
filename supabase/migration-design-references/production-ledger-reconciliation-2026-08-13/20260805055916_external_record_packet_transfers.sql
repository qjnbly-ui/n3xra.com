create table public.record_packet_transfer_requests (
  id uuid primary key default gen_random_uuid(),
  recording_id uuid not null references public.meeting_recordings (id) on delete cascade,
  source_organization_id uuid not null references public.organizations (id) on delete cascade,
  recipient_email text not null,
  recipient_organization_name text,
  token_hash text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  accepted_by_user_id uuid references auth.users (id) on delete set null,
  target_organization_id uuid references public.organizations (id) on delete set null,
  accepted_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint record_packet_transfer_requests_email_check
    check (recipient_email = lower(trim(recipient_email)) and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'),
  constraint record_packet_transfer_requests_status_check
    check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  constraint record_packet_transfer_requests_acceptance_check check (
    (status = 'accepted' and accepted_by_user_id is not null and target_organization_id is not null and accepted_at is not null)
    or status <> 'accepted'
  )
);

create unique index record_packet_transfer_requests_one_pending_recording_idx
on public.record_packet_transfer_requests (recording_id)
where status = 'pending';

create index record_packet_transfer_requests_source_idx
on public.record_packet_transfer_requests (source_organization_id, created_at desc);

create index record_packet_transfer_requests_recipient_idx
on public.record_packet_transfer_requests (recipient_email, created_at desc);

drop trigger if exists record_packet_transfer_requests_set_updated_at on public.record_packet_transfer_requests;
create trigger record_packet_transfer_requests_set_updated_at
before update on public.record_packet_transfer_requests
for each row execute procedure public.set_updated_at();

alter table public.record_packet_transfer_requests enable row level security;

revoke all on table public.record_packet_transfer_requests from public, anon, authenticated;
grant select, insert, update, delete on table public.record_packet_transfer_requests to service_role;

create or replace function public.complete_external_record_packet_transfer(
  input_transfer_request_id uuid,
  input_target_organization_id uuid,
  input_accepting_user_id uuid,
  input_recording_storage_path text default null,
  input_transcript_storage_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  transfer_request public.record_packet_transfer_requests%rowtype;
  source_recording public.meeting_recordings%rowtype;
  source_transcript public.documents%rowtype;
  source_organization_name text;
  target_organization_name text;
  accepting_user_email text;
  packet_document_ids uuid[] := array[]::uuid[];
  transfer_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role authorization required.';
  end if;

  select *
    into transfer_request
    from public.record_packet_transfer_requests
   where id = input_transfer_request_id
   for update;

  if not found then
    raise exception 'Transfer invitation not found.';
  end if;
  if transfer_request.status <> 'pending' then
    raise exception 'This transfer invitation is no longer pending.';
  end if;
  if transfer_request.expires_at <= now() then
    update public.record_packet_transfer_requests
       set status = 'expired'
     where id = transfer_request.id;
    raise exception 'This transfer invitation has expired.';
  end if;

  select lower(trim(email))
    into accepting_user_email
    from auth.users
   where id = input_accepting_user_id;

  if accepting_user_email is null or accepting_user_email <> transfer_request.recipient_email then
    raise exception 'Sign in with the email address that received this invitation.';
  end if;

  if not exists (
    select 1
      from public.organization_memberships membership
     where membership.organization_id = input_target_organization_id
       and membership.user_id = input_accepting_user_id
       and membership.role = 'account_admin'
  ) then
    raise exception 'Account administrator access is required in the destination workspace.';
  end if;

  select name
    into target_organization_name
    from public.organizations
   where id = input_target_organization_id
     and subscription_tier = 'organization'
     and account_status in ('active', 'trialing');

  if target_organization_name is null then
    raise exception 'The destination must be an active Organization workspace.';
  end if;

  select *
    into source_recording
    from public.meeting_recordings
   where id = transfer_request.recording_id
     and organization_id = transfer_request.source_organization_id
   for update;

  if not found then
    raise exception 'The record packet is no longer available in the sending workspace.';
  end if;
  if source_recording.organization_id = input_target_organization_id then
    raise exception 'Choose a different destination workspace.';
  end if;
  if source_recording.status in ('recording', 'interrupted', 'uploading', 'finalizing', 'transcribing')
     or source_recording.transcript_status in ('queued', 'processing')
     or source_recording.ai_review_status = 'processing' then
    raise exception 'Finish active recording and processing before accepting this record packet.';
  end if;
  if source_recording.storage_path is not null and (
    nullif(trim(input_recording_storage_path), '') is null
    or input_recording_storage_path not like input_target_organization_id::text || '/%'
  ) then
    raise exception 'The destination recording path is invalid.';
  end if;

  if source_recording.document_id is not null then
    select *
      into source_transcript
      from public.documents
     where id = source_recording.document_id
       and organization_id = source_recording.organization_id;
    if not found then
      raise exception 'The packet transcript file could not be loaded.';
    end if;
    if nullif(trim(input_transcript_storage_path), '') is null
       or input_transcript_storage_path not like input_target_organization_id::text || '/%' then
      raise exception 'The destination transcript path is invalid.';
    end if;
  end if;

  select coalesce(array_agg(distinct packet_document_id), array[]::uuid[])
    into packet_document_ids
    from (
      select source_recording.ai_draft_document_id as packet_document_id
      union all
      select source_recording.final_document_id
      union all
      select reference.app_document_id
        from public.meeting_recording_references reference
       where reference.meeting_recording_id = source_recording.id
    ) packet_documents
   where packet_document_id is not null;

  if exists (
    select 1
      from public.meeting_recordings other_recording
     where other_recording.id <> source_recording.id
       and (
         other_recording.ai_draft_document_id = any(packet_document_ids)
         or other_recording.final_document_id = any(packet_document_ids)
       )
  ) or exists (
    select 1
      from public.meeting_recording_references other_reference
     where other_reference.meeting_recording_id <> source_recording.id
       and other_reference.app_document_id = any(packet_document_ids)
  ) then
    raise exception 'A generated packet document is linked to another record and cannot be transferred safely.';
  end if;

  select name into source_organization_name
    from public.organizations
   where id = source_recording.organization_id;

  delete from public.document_share_links
   where document_id = any(packet_document_ids);

  if source_recording.document_id is not null then
    update public.documents
       set organization_id = input_target_organization_id,
           user_id = input_accepting_user_id,
           uploaded_by_user_id = input_accepting_user_id,
           storage_path = input_transcript_storage_path,
           is_public = false,
           updated_at = now()
     where id = source_recording.document_id;
  end if;

  if cardinality(packet_document_ids) > 0 then
    update public.app_documents
       set organization_id = input_target_organization_id,
           created_by_user_id = input_accepting_user_id,
           is_public = false,
           last_sent_at = null,
           updated_at = now()
     where id = any(packet_document_ids);
  end if;

  transfer_metadata := coalesce(source_recording.metadata, '{}'::jsonb) || jsonb_build_object(
    'lastTransfer', jsonb_build_object(
      'fromOrganizationId', source_recording.organization_id,
      'fromOrganizationName', source_organization_name,
      'toOrganizationId', input_target_organization_id,
      'toOrganizationName', target_organization_name,
      'transferredByUserId', input_accepting_user_id,
      'transferRequestId', transfer_request.id,
      'transferredAt', now()
    )
  );

  if transfer_metadata #>> '{phoneMeeting,storagePath}' is not null then
    transfer_metadata := jsonb_set(
      transfer_metadata,
      '{phoneMeeting,storagePath}',
      to_jsonb(regexp_replace(
        transfer_metadata #>> '{phoneMeeting,storagePath}',
        '^' || source_recording.organization_id::text || '/',
        input_target_organization_id::text || '/'
      )),
      false
    );
  end if;

  update public.meeting_recordings
     set organization_id = input_target_organization_id,
         created_by_user_id = input_accepting_user_id,
         selected_template_id = null,
         storage_path = input_recording_storage_path,
         metadata = transfer_metadata,
         updated_at = now()
   where id = source_recording.id;

  update public.meeting_recording_interruptions
     set organization_id = input_target_organization_id
   where meeting_recording_id = source_recording.id;

  delete from public.meeting_recording_chunks
   where meeting_recording_id = source_recording.id;

  update public.phone_meeting_sessions
     set meeting_recording_id = null
   where meeting_recording_id = source_recording.id;

  update public.record_packet_transfer_requests
     set status = 'accepted',
         accepted_by_user_id = input_accepting_user_id,
         target_organization_id = input_target_organization_id,
         accepted_at = now()
   where id = transfer_request.id;

  insert into public.records_activity_log (
    organization_id, actor_user_id, action_type, target_type, target_id, target_label, summary, metadata
  ) values
  (
    source_recording.organization_id,
    input_accepting_user_id,
    'record_transfer',
    'record_packet',
    source_recording.id::text,
    source_recording.title,
    'Transferred a record packet to ' || target_organization_name || '.',
    jsonb_build_object('direction', 'out', 'transferRequestId', transfer_request.id, 'otherOrganizationId', input_target_organization_id, 'otherOrganizationName', target_organization_name)
  ),
  (
    input_target_organization_id,
    input_accepting_user_id,
    'record_transfer',
    'record_packet',
    source_recording.id::text,
    source_recording.title,
    'Accepted a record packet from ' || source_organization_name || '.',
    jsonb_build_object('direction', 'in', 'transferRequestId', transfer_request.id, 'otherOrganizationId', source_recording.organization_id, 'otherOrganizationName', source_organization_name)
  );

  return jsonb_build_object(
    'recording_id', source_recording.id,
    'title', source_recording.title,
    'source_organization_id', source_recording.organization_id,
    'source_organization_name', source_organization_name,
    'target_organization_id', input_target_organization_id,
    'target_organization_name', target_organization_name,
    'source_recording_storage_path', source_recording.storage_path,
    'source_transcript_storage_path', source_transcript.storage_path,
    'recording_storage_path', input_recording_storage_path,
    'transcript_storage_path', input_transcript_storage_path
  );
end;
$$;

revoke all on function public.complete_external_record_packet_transfer(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.complete_external_record_packet_transfer(uuid, uuid, uuid, text, text) to service_role;
