alter table public.website_onboarding_files
add column if not exists asset_version_id uuid
references public.website_asset_versions (id)
on delete set null;

create unique index if not exists website_onboarding_files_asset_version_idx
on public.website_onboarding_files (asset_version_id)
where asset_version_id is not null;

drop policy if exists "website_asset_versions_insert" on public.website_asset_versions;
create policy "website_asset_versions_insert"
on public.website_asset_versions
for insert
to authenticated
with check (
  storage_bucket = 'website-assets-private'
  and uploaded_by_user_id = (select auth.uid())
  and (
    status in ('draft', 'pending_review')
    or (
      status = 'approved'
      and (select public.is_platform_admin())
      and approved_by_user_id = (select auth.uid())
      and approved_at is not null
    )
  )
  and exists (
    select 1
    from public.website_assets asset
    where asset.id = website_asset_versions.asset_id
      and public.can_edit_client_website(asset.website_id)
  )
);

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'website-assets-private';

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml'
]
where id = 'website-assets-public';

update storage.buckets
set allowed_mime_types = array[
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'text/plain',
  'text/csv',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]
where id = 'website-onboarding-private';
;
