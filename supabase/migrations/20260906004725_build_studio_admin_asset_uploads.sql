-- Admin-selected Build Studio files are automatically approved and published.
-- Preserve existing RLS and formats; support 50 MB originals and downloads.
update storage.buckets
set file_size_limit = greatest(coalesce(file_size_limit, 52428800), 52428800)
where id in ('website-assets-private', 'website-assets-public');
update storage.buckets
set allowed_mime_types = array(
  select distinct mime from unnest(allowed_mime_types || array[
    'application/pdf', 'text/plain', 'text/csv', 'application/zip',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]) as mime
)
where id = 'website-assets-public' and allowed_mime_types is not null;
