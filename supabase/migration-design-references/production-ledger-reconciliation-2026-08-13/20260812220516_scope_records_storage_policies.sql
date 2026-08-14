-- Records storage policies call helper functions that are intentionally unavailable
-- to anon. Keep those policies out of anonymous requests so uploads to unrelated
-- buckets (including careers-files) cannot fail while PostgreSQL evaluates RLS.
alter policy "storage_select_documents_policy"
on storage.objects to authenticated;

alter policy "storage_insert_documents_policy"
on storage.objects to authenticated;

alter policy "storage_update_documents_policy"
on storage.objects to authenticated;

alter policy "storage_delete_documents_policy"
on storage.objects to authenticated;

alter policy "storage_select_meeting_recordings_policy"
on storage.objects to authenticated;

alter policy "storage_insert_meeting_recordings_policy"
on storage.objects to authenticated;

alter policy "storage_update_meeting_recordings_policy"
on storage.objects to authenticated;

alter policy "storage_delete_meeting_recordings_policy"
on storage.objects to authenticated;

-- Preserve the anonymous public-record download path without invoking any private
-- Records permission helper.
drop policy if exists "storage_select_public_documents_policy" on storage.objects;
create policy "storage_select_public_documents_policy"
on storage.objects
for select
to anon
using (
  bucket_id = 'documents'
  and exists (
    select 1
    from public.documents as document
    join public.organizations as organization
      on organization.id = document.organization_id
    where document.storage_path = storage.objects.name
      and document.is_public = true
      and organization.public_embed_enabled = true
  )
);
