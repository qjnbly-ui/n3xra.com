alter table public.website_asset_versions
  add column if not exists cdn_size_bytes bigint,
  add column if not exists cdn_mime_type text,
  add column if not exists cdn_width integer,
  add column if not exists cdn_height integer,
  add column if not exists cdn_optimized boolean not null default false,
  add column if not exists cdn_processed_at timestamptz;

alter table public.website_asset_versions
  drop constraint if exists website_asset_versions_cdn_size_check,
  add constraint website_asset_versions_cdn_size_check
    check (cdn_size_bytes is null or cdn_size_bytes >= 0),
  drop constraint if exists website_asset_versions_cdn_width_check,
  add constraint website_asset_versions_cdn_width_check
    check (cdn_width is null or cdn_width > 0),
  drop constraint if exists website_asset_versions_cdn_height_check,
  add constraint website_asset_versions_cdn_height_check
    check (cdn_height is null or cdn_height > 0);

comment on column public.website_asset_versions.cdn_size_bytes is
  'Size of the public CDN object. The private original remains represented by size_bytes.';
comment on column public.website_asset_versions.cdn_mime_type is
  'MIME type served by the stable public CDN URL.';
comment on column public.website_asset_versions.cdn_optimized is
  'True when the public CDN object is smaller or resized from the private original.';
comment on column public.website_asset_versions.cdn_processed_at is
  'Most recent time an admin prepared or refreshed the public CDN object.';;
