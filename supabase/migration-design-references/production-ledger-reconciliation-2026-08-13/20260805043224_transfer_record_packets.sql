alter table public.documents
add column if not exists user_id uuid references auth.users (id) on delete set null;

alter table public.records_activity_log
drop constraint if exists records_activity_log_action_type_check;

alter table public.records_activity_log
add constraint records_activity_log_action_type_check check (
  action_type in (
    'upload',
    'delete',
    'visibility_change',
    'invite_sent',
    'invite_redeemed',
    'ai_search_used',
    'billing_change',
    'record_transfer'
  )
);

create or replace function public.transfer_record_packet(
  input_recording_id uuid,
  input_target_organization_id uuid,
  input_recording_storage_path text default null,
  input_transcript_storage_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_recording public.meeting_recordings%rowtype;
  source_transcript public.documents%rowtype;
  source_app_document public.app_documents%rowtype;
  reference_row record;
  source_organization_name text;
  target_organization_name text;
  new_transcript_id uuid;
  new_ai_draft_id uuid;
  new_final_document_id uuid;
  new_reference_document_id uuid;
  source_app_document_id uuid;
  source_app_document_ids uuid[] := array[]::uuid[];
  transfer_metadata jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required.';
  end if;

  select *
    into source_recording
    from public.meeting_recordings
   where id = input_recording_id
   for update;

  if not found then
    raise exception 'Record packet not found.';
  end if;

  if source_recording.organization_id = input_target_organization_id then
    raise exception 'Choose a different destination workspace.';
  end if;

  if public.organization_role(source_recording.organization_id) <> 'account_admin'
     or public.organization_role(input_target_organization_id) <> 'account_admin' then
    raise exception 'Account administrator access is required in both workspaces.';
  end if;

  select name
    into source_organization_name
    from public.organizations
   where id = source_recording.organization_id;

  select name
    into target_organization_name
    from public.organizations
   where id = input_target_organization_id
     and subscription_tier = 'organization'
     and account_status in ('active', 'trialing');

  if target_organization_name is null then
    raise exception 'The destination must be an active Organization workspace.';
  end if;

  if source_recording.status in ('recording', 'interrupted', 'uploading', 'finalizing', 'transcribing')
     or source_recording.transcript_status in ('queued', 'processing')
     or source_recording.ai_review_status = 'processing' then
    raise exception 'Finish active recording and processing before moving this record packet.';
  end if;

  if source_recording.storage_path is not null and (
    nullif(trim(input_recording_storage_path), '') is null
    or input_recording_storage_path not like input_target_organization_id::text || '/%'
  ) then
    raise exception 'The destination recording path is invalid.';
  end if;

  if source_recording.document_id is not null and (
    nullif(trim(input_transcript_storage_path), '') is null
    or input_transcript_storage_path not like input_target_organization_id::text || '/%'
  ) then
    raise exception 'The destination transcript path is invalid.';
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

    insert into public.documents (
      organization_id,
      user_id,
      uploaded_by_user_id,
      title,
      original_filename,
      storage_path,
      mime_type,
      file_size,
      year,
      month,
      is_public,
      status,
      processing_error,
      extracted_text,
      records_ai_note
    ) values (
      input_target_organization_id,
      auth.uid(),
      auth.uid(),
      source_transcript.title,
      source_transcript.original_filename,
      input_transcript_storage_path,
      source_transcript.mime_type,
      source_transcript.file_size,
      source_transcript.year,
      source_transcript.month,
      false,
      source_transcript.status,
      source_transcript.processing_error,
      source_transcript.extracted_text,
      source_transcript.records_ai_note
    ) returning id into new_transcript_id;
  end if;

  if source_recording.ai_draft_document_id is not null then
    source_app_document_ids := array_append(source_app_document_ids, source_recording.ai_draft_document_id);
  end if;
  if source_recording.final_document_id is not null
     and source_recording.final_document_id <> all(source_app_document_ids) then
    source_app_document_ids := array_append(source_app_document_ids, source_recording.final_document_id);
  end if;

  if exists (
    select 1
      from public.meeting_recordings other_recording
     where other_recording.id <> source_recording.id
       and (
         other_recording.ai_draft_document_id = any(source_app_document_ids)
         or other_recording.final_document_id = any(source_app_document_ids)
       )
  ) or exists (
    select 1
      from public.meeting_recording_references other_reference
     where other_reference.meeting_recording_id <> source_recording.id
       and other_reference.app_document_id = any(source_app_document_ids)
  ) then
    raise exception 'A generated packet document is linked to another record and cannot be moved safely.';
  end if;

  foreach source_app_document_id in array source_app_document_ids loop
    select *
      into source_app_document
      from public.app_documents
     where id = source_app_document_id
       and organization_id = source_recording.organization_id;

    if not found then
      raise exception 'A generated packet document could not be loaded.';
    end if;

    insert into public.app_documents (
      organization_id,
      source_document_id,
      created_by_user_id,
      title,
      content_json,
      plain_text,
      document_kind,
      status,
      last_sent_at,
      year,
      month,
      is_public,
      records_ai_note
    ) values (
      input_target_organization_id,
      case when source_app_document.source_document_id = source_recording.document_id then new_transcript_id else null end,
      auth.uid(),
      source_app_document.title,
      source_app_document.content_json,
      source_app_document.plain_text,
      'document',
      source_app_document.status,
      null,
      source_app_document.year,
      source_app_document.month,
      false,
      source_app_document.records_ai_note
    ) returning id into new_reference_document_id;

    if source_app_document.id = source_recording.ai_draft_document_id then
      new_ai_draft_id := new_reference_document_id;
    end if;
    if source_app_document.id = source_recording.final_document_id then
      new_final_document_id := new_reference_document_id;
    end if;
  end loop;

  for reference_row in
    select reference.id as reference_id, reference.app_document_id, document.*
      from public.meeting_recording_references reference
      join public.app_documents document on document.id = reference.app_document_id
     where reference.meeting_recording_id = source_recording.id
     order by reference.sort_order, reference.created_at
  loop
    if reference_row.app_document_id = source_recording.ai_draft_document_id then
      new_reference_document_id := new_ai_draft_id;
    elsif reference_row.app_document_id = source_recording.final_document_id then
      new_reference_document_id := new_final_document_id;
    else
      insert into public.app_documents (
        organization_id,
        source_document_id,
        created_by_user_id,
        title,
        content_json,
        plain_text,
        document_kind,
        status,
        last_sent_at,
        year,
        month,
        is_public,
        records_ai_note
      ) values (
        input_target_organization_id,
        case when reference_row.source_document_id = source_recording.document_id then new_transcript_id else null end,
        auth.uid(),
        reference_row.title,
        reference_row.content_json,
        reference_row.plain_text,
        'document',
        reference_row.status,
        null,
        reference_row.year,
        reference_row.month,
        false,
        reference_row.records_ai_note
      ) returning id into new_reference_document_id;
    end if;

    update public.meeting_recording_references
       set app_document_id = new_reference_document_id
     where id = reference_row.reference_id;
  end loop;

  transfer_metadata := coalesce(source_recording.metadata, '{}'::jsonb) || jsonb_build_object(
    'lastTransfer', jsonb_build_object(
      'fromOrganizationId', source_recording.organization_id,
      'fromOrganizationName', source_organization_name,
      'toOrganizationId', input_target_organization_id,
      'toOrganizationName', target_organization_name,
      'transferredByUserId', auth.uid(),
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
         document_id = new_transcript_id,
         selected_template_id = null,
         storage_path = input_recording_storage_path,
         ai_draft_document_id = new_ai_draft_id,
         final_document_id = new_final_document_id,
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

  if cardinality(source_app_document_ids) > 0 then
    delete from public.app_documents
     where id = any(source_app_document_ids)
       and organization_id = source_recording.organization_id;
  end if;

  if source_recording.document_id is not null then
    delete from public.documents
     where id = source_recording.document_id
       and organization_id = source_recording.organization_id;
  end if;

  insert into public.records_activity_log (
    organization_id, actor_user_id, action_type, target_type, target_id, target_label, summary, metadata
  ) values
  (
    source_recording.organization_id,
    auth.uid(),
    'record_transfer',
    'record_packet',
    source_recording.id::text,
    source_recording.title,
    'Moved a record packet to ' || target_organization_name || '.',
    jsonb_build_object('direction', 'out', 'otherOrganizationId', input_target_organization_id, 'otherOrganizationName', target_organization_name)
  ),
  (
    input_target_organization_id,
    auth.uid(),
    'record_transfer',
    'record_packet',
    source_recording.id::text,
    source_recording.title,
    'Received a record packet from ' || source_organization_name || '.',
    jsonb_build_object('direction', 'in', 'otherOrganizationId', source_recording.organization_id, 'otherOrganizationName', source_organization_name)
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

revoke all on function public.transfer_record_packet(uuid, uuid, text, text) from public, anon;
grant execute on function public.transfer_record_packet(uuid, uuid, text, text) to authenticated;
