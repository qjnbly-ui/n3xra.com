alter table public.map_features
  add column if not exists address text,
  add column if not exists customer_reference text;

alter table public.map_features
  drop constraint if exists map_features_address_check,
  add constraint map_features_address_check check (address is null or char_length(address) <= 500),
  drop constraint if exists map_features_customer_reference_check,
  add constraint map_features_customer_reference_check check (customer_reference is null or char_length(customer_reference) <= 160);

alter table public.map_features
  drop constraint if exists map_features_organization_id_id_unique,
  add constraint map_features_organization_id_id_unique unique (organization_id, id);

create table public.map_layer_fields (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  layer_id uuid not null,
  field_key text not null,
  label text not null,
  field_type text not null default 'text',
  options jsonb not null default '[]'::jsonb,
  is_required boolean not null default false,
  sort_order integer not null default 100,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint map_layer_fields_layer_organization_fkey
    foreign key (organization_id, layer_id)
    references public.map_layers (organization_id, id)
    on delete cascade,
  constraint map_layer_fields_key_unique unique (organization_id, layer_id, field_key),
  constraint map_layer_fields_key_check check (field_key ~ '^[a-z][a-z0-9_]{0,49}$'),
  constraint map_layer_fields_label_check check (char_length(trim(label)) between 1 and 100),
  constraint map_layer_fields_type_check check (field_type in ('text', 'number', 'date', 'boolean', 'select')),
  constraint map_layer_fields_options_check check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) <= 100),
  constraint map_layer_fields_sort_check check (sort_order between 0 and 10000)
);

create table public.map_feature_photos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  feature_id uuid not null,
  storage_path text not null unique,
  caption text,
  mime_type text not null,
  size_bytes bigint not null,
  created_by_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint map_feature_photos_feature_organization_fkey
    foreign key (organization_id, feature_id)
    references public.map_features (organization_id, id)
    on delete cascade,
  constraint map_feature_photos_path_check check (
    storage_path !~ '(^|/)\.\.(/|$)' and storage_path !~ '^/' and char_length(storage_path) between 10 and 600
  ),
  constraint map_feature_photos_caption_check check (caption is null or char_length(caption) <= 500),
  constraint map_feature_photos_mime_check check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif')),
  constraint map_feature_photos_size_check check (size_bytes between 1 and 10485760)
);

create index map_layer_fields_layer_idx
  on public.map_layer_fields (organization_id, layer_id, sort_order, label);
create index map_feature_photos_feature_idx
  on public.map_feature_photos (organization_id, feature_id, created_at desc);
create index map_features_asset_search_idx
  on public.map_features (organization_id, lower(address), lower(customer_reference))
  where archived_at is null;
create index map_features_properties_gin_idx
  on public.map_features using gin (properties jsonb_path_ops);

drop trigger if exists map_layer_fields_set_updated_at on public.map_layer_fields;
create trigger map_layer_fields_set_updated_at
before update on public.map_layer_fields
for each row execute function public.set_updated_at();

alter table public.map_layer_fields enable row level security;
alter table public.map_feature_photos enable row level security;

revoke all on public.map_layer_fields from public, anon, authenticated;
revoke all on public.map_feature_photos from public, anon, authenticated;
grant select, insert, update, delete on public.map_layer_fields to authenticated;
grant select, insert, update, delete on public.map_feature_photos to authenticated;
grant all on public.map_layer_fields to service_role;
grant all on public.map_feature_photos to service_role;

create policy "map_layer_fields_select"
on public.map_layer_fields for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_layer_fields_insert"
on public.map_layer_fields for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_layer_fields_update"
on public.map_layer_fields for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_layer_fields_delete"
on public.map_layer_fields for delete to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_feature_photos_select"
on public.map_feature_photos for select to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) is not null
  or (select public.is_platform_admin())
);

create policy "map_feature_photos_insert"
on public.map_feature_photos for insert to authenticated
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_feature_photos_update"
on public.map_feature_photos for update to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
)
with check (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

create policy "map_feature_photos_delete"
on public.map_feature_photos for delete to authenticated
using (
  (select public.organization_product_role(organization_id, 'maps')) in ('account_admin', 'editor')
  or (select public.is_platform_admin())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'maps-asset-photos',
  'maps-asset-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "maps_asset_photos_select" on storage.objects;
create policy "maps_asset_photos_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'maps-asset-photos'
  and exists (
    select 1
    from public.map_features feature
    where feature.organization_id::text = (storage.foldername(name))[1]
      and feature.id::text = (storage.foldername(name))[2]
      and (
        public.organization_product_role(feature.organization_id, 'maps') is not null
        or public.is_platform_admin()
      )
  )
);

drop policy if exists "maps_asset_photos_insert" on storage.objects;
create policy "maps_asset_photos_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'maps-asset-photos'
  and owner_id = (select auth.uid())::text
  and exists (
    select 1
    from public.map_features feature
    where feature.organization_id::text = (storage.foldername(name))[1]
      and feature.id::text = (storage.foldername(name))[2]
      and feature.archived_at is null
      and (
        public.organization_product_role(feature.organization_id, 'maps') in ('account_admin', 'editor')
        or public.is_platform_admin()
      )
  )
);

drop policy if exists "maps_asset_photos_delete" on storage.objects;
create policy "maps_asset_photos_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'maps-asset-photos'
  and exists (
    select 1
    from public.map_features feature
    where feature.organization_id::text = (storage.foldername(name))[1]
      and feature.id::text = (storage.foldername(name))[2]
      and (
        public.organization_product_role(feature.organization_id, 'maps') in ('account_admin', 'editor')
        or public.is_platform_admin()
      )
  )
);
