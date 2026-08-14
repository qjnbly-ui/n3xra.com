alter table public.organizations
  add column if not exists records_admin_only_meetings_enabled boolean not null default false;

alter table public.meeting_recordings
  add column if not exists admin_only boolean not null default false;

alter table public.documents
  add column if not exists admin_only boolean not null default false;

alter table public.documents
  drop constraint if exists documents_admin_only_not_public_check,
  add constraint documents_admin_only_not_public_check
    check (not admin_only or not is_public);

comment on column public.organizations.records_admin_only_meetings_enabled is
  'When enabled, meeting recordings created afterward are restricted to account admins. Existing rows are unchanged.';

comment on column public.meeting_recordings.admin_only is
  'Creation-time visibility snapshot. True restricts the meeting row and stored audio to account admins and explicitly authorized support.';

comment on column public.documents.admin_only is
  'True restricts a generated meeting transcript document and its stored file to account admins and explicitly authorized support.';

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

drop trigger if exists apply_new_meeting_recording_visibility on public.meeting_recordings;
create trigger apply_new_meeting_recording_visibility
before insert on public.meeting_recordings
for each row execute function private.apply_new_meeting_recording_visibility();

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

drop trigger if exists protect_meeting_recording_visibility_snapshot on public.meeting_recordings;
create trigger protect_meeting_recording_visibility_snapshot
before update of admin_only on public.meeting_recordings
for each row execute function private.protect_admin_only_visibility_snapshot();

drop trigger if exists protect_transcript_visibility_snapshot on public.documents;
create trigger protect_transcript_visibility_snapshot
before update of admin_only on public.documents
for each row execute function private.protect_admin_only_visibility_snapshot();

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
  if (select auth.uid()) is null then
    return false;
  end if;

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

  if target_organization_id is null or not coalesce(target_admin_only, false) then
    return true;
  end if;

  return (
    (
      public.is_records_organization_member(target_organization_id)
      and (
        public.organization_role(target_organization_id) = 'account_admin'
        or exists (
          select 1
          from public.organizations as organization
          where organization.id = target_organization_id
            and organization.owner_user_id = (select auth.uid())
        )
      )
    )
    or public.has_records_support_scope(
      target_organization_id,
      case input_bucket_id
        when 'meeting-recordings' then 'view_recordings'
        else 'view_documents'
      end
    )
  );
end;
$$;

revoke all on function private.can_read_admin_only_records_storage_object(text, text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.can_read_admin_only_records_storage_object(text, text) to authenticated;

drop policy if exists "meeting_recordings_admin_only_select" on public.meeting_recordings;
create policy "meeting_recordings_admin_only_select"
on public.meeting_recordings
as restrictive
for select
to authenticated
using (
  not admin_only
  or (
    public.is_records_organization_member(organization_id)
    and (
      public.organization_role(organization_id) = 'account_admin'
      or exists (
        select 1
        from public.organizations as organization
        where organization.id = meeting_recordings.organization_id
          and organization.owner_user_id = (select auth.uid())
      )
    )
  )
  or public.has_records_support_scope(organization_id, 'view_recordings')
);

drop policy if exists "meeting_recordings_admin_only_insert" on public.meeting_recordings;
create policy "meeting_recordings_admin_only_insert"
on public.meeting_recordings
as restrictive
for insert
to authenticated
with check (
  not admin_only
  or public.organization_role(organization_id) = 'account_admin'
  or exists (
    select 1
    from public.organizations as organization
    where organization.id = meeting_recordings.organization_id
      and organization.owner_user_id = (select auth.uid())
  )
);

drop policy if exists "documents_admin_only_select" on public.documents;
create policy "documents_admin_only_select"
on public.documents
as restrictive
for select
to authenticated
using (
  not admin_only
  or (
    public.is_records_organization_member(organization_id)
    and (
      public.organization_role(organization_id) = 'account_admin'
      or exists (
        select 1
        from public.organizations as organization
        where organization.id = documents.organization_id
          and organization.owner_user_id = (select auth.uid())
      )
    )
  )
  or public.has_records_support_scope(organization_id, 'view_documents')
);

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
        or public.organization_role(recording.organization_id) = 'account_admin'
        or exists (
          select 1
          from public.organizations as organization
          where organization.id = recording.organization_id
            and organization.owner_user_id = (select auth.uid())
        )
        or public.has_records_support_scope(recording.organization_id, 'view_recordings')
      )
  )
);

drop policy if exists "meeting_recording_interruptions_admin_only_select" on public.meeting_recording_interruptions;
create policy "meeting_recording_interruptions_admin_only_select"
on public.meeting_recording_interruptions
as restrictive
for select to authenticated
using (
  exists (
    select 1
    from public.meeting_recordings as recording
    where recording.id = meeting_recording_interruptions.meeting_recording_id
      and recording.organization_id = meeting_recording_interruptions.organization_id
      and (
        not recording.admin_only
        or public.organization_role(recording.organization_id) = 'account_admin'
        or exists (
          select 1
          from public.organizations as organization
          where organization.id = recording.organization_id
            and organization.owner_user_id = (select auth.uid())
        )
        or public.has_records_support_scope(recording.organization_id, 'view_recordings')
      )
  )
);

drop policy if exists "storage_admin_only_records_select" on storage.objects;
create policy "storage_admin_only_records_select"
on storage.objects
as restrictive
for select
to authenticated
using (private.can_read_admin_only_records_storage_object(bucket_id, name));
