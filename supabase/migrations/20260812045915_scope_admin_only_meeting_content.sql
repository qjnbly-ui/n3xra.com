-- Keep the meeting-note row visible to organization members. The privacy
-- setting applies dynamically to the attached audio and transcript content.
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
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
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
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.document_id is not null then
    update public.documents
       set admin_only = new.admin_only,
           is_public = case when new.admin_only then false else is_public end
     where id = new.document_id
       and (
         admin_only is distinct from new.admin_only
         or (new.admin_only and is_public)
       );
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
         is_public = case
           when new.records_admin_only_meetings_enabled then false
           else document.is_public
         end
   where document.organization_id = new.id
     and exists (
       select 1
       from public.meeting_recordings as recording
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

-- Bring records created before this clarification into line with the current
-- organization setting. Turning the setting on or off later runs the trigger.
update public.meeting_recordings as recording
set admin_only = (organization.records_admin_only_meetings_enabled and recording.document_id is not null)
from public.organizations as organization
where organization.id = recording.organization_id
  and recording.admin_only is distinct from (organization.records_admin_only_meetings_enabled and recording.document_id is not null);

update public.documents as document
set admin_only = organization.records_admin_only_meetings_enabled,
    is_public = case
      when organization.records_admin_only_meetings_enabled then false
      else document.is_public
    end
from public.organizations as organization
where organization.id = document.organization_id
  and exists (
    select 1
    from public.meeting_recordings as recording
    where recording.document_id = document.id
  )
  and (
    document.admin_only is distinct from organization.records_admin_only_meetings_enabled
    or (organization.records_admin_only_meetings_enabled and document.is_public)
  );

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

  if target_organization_id is null or not coalesce(target_admin_only, false) then
    return true;
  end if;

  -- The creator may finish or recover an in-progress recording. Once its
  -- transcript document exists, the organization-wide admin-only rule applies.
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
on public.meeting_recording_chunks
as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.meeting_recordings as recording
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

-- The deployed clients read protected transcript values through
-- get_meeting_recording_private_content. Keep the rest of Meeting note details
-- selectable while removing direct browser access to the protected columns.
revoke select on public.meeting_recordings from anon, authenticated;
grant select (
  id,
  organization_id,
  created_by_user_id,
  document_id,
  title,
  status,
  transcript_status,
  started_at,
  ended_at,
  duration_seconds,
  storage_path,
  storage_bucket,
  audio_mime_type,
  file_size,
  processing_error,
  transcript_generated_at,
  metadata,
  created_at,
  updated_at,
  selected_template_id,
  notes_content_json,
  notes_plain_text,
  notes_updated_at,
  ai_review_status,
  ai_review_json,
  ai_reviewed_at,
  ai_draft_document_id,
  final_document_id,
  processing_stage,
  processing_progress,
  processing_started_at,
  processing_updated_at,
  processing_completed_at,
  minutes_style,
  speaker_identification_status,
  speaker_identification_job_id,
  speaker_identification_model,
  speaker_identification_threshold,
  speaker_identification_error,
  speaker_identified_at,
  speaker_identification_updated_at,
  admin_only
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
  select
    recording.id,
    recording.transcript_text,
    recording.transcript_timing_json,
    recording.speaker_transcript_text,
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
        select 1
        from public.organizations as organization
        where organization.id = recording.organization_id
          and organization.owner_user_id = (select auth.uid())
      )
      or public.has_records_support_scope(recording.organization_id, 'view_recordings')
    );
$$;

revoke all on function public.get_meeting_recording_private_content(uuid, uuid[]) from public, anon;
grant execute on function public.get_meeting_recording_private_content(uuid, uuid[]) to authenticated;
