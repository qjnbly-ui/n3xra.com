alter table public.organization_file_folders
  drop constraint if exists organization_file_folders_source_product_check;

alter table public.organization_file_folders
  add constraint organization_file_folders_source_product_check
  check (source_product in ('files_assets', 'websites', 'project_cards', 'maps'));

alter table public.map_feature_photos
  add column if not exists organization_file_id uuid
    references public.organization_files(id) on delete cascade;

create unique index if not exists map_feature_photos_organization_file_idx
on public.map_feature_photos (organization_file_id)
where organization_file_id is not null;

create or replace function private.link_map_photo_to_organization_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  maps_root_id uuid;
  asset_folder_id uuid;
  linked_file_id uuid := gen_random_uuid();
  asset_title text;
  original_name text;
begin
  if (select auth.uid()) is null
     or (
       public.organization_product_role(new.organization_id, 'maps') not in ('account_admin', 'editor')
       and not (select public.is_platform_admin())
     ) then
    raise exception 'Maps editor access is required.' using errcode = '42501';
  end if;

  select feature.title
  into asset_title
  from public.map_features feature
  where feature.id = new.feature_id
    and feature.organization_id = new.organization_id;

  if asset_title is null then
    raise exception 'Mapped item not found.' using errcode = 'P0002';
  end if;

  insert into public.organization_file_folders (
    organization_id, parent_id, name, source_product, source_entity_id,
    shared_with_n3xra, is_system, created_by_user_id
  ) values (
    new.organization_id, null, 'Maps', 'maps', new.organization_id,
    false, true, new.created_by_user_id
  )
  on conflict (organization_id, source_product, source_entity_id)
    where source_entity_id is not null
  do nothing;

  select folder.id
  into maps_root_id
  from public.organization_file_folders folder
  where folder.organization_id = new.organization_id
    and folder.source_product = 'maps'
    and folder.source_entity_id = new.organization_id;

  insert into public.organization_file_folders (
    organization_id, parent_id, name, source_product, source_entity_id,
    shared_with_n3xra, is_system, created_by_user_id
  ) values (
    new.organization_id,
    maps_root_id,
    left(asset_title, 105) || ' · ' || left(new.feature_id::text, 8),
    'maps',
    new.feature_id,
    false,
    true,
    new.created_by_user_id
  )
  on conflict (organization_id, source_product, source_entity_id)
    where source_entity_id is not null
  do nothing;

  select folder.id
  into asset_folder_id
  from public.organization_file_folders folder
  where folder.organization_id = new.organization_id
    and folder.source_product = 'maps'
    and folder.source_entity_id = new.feature_id;

  original_name := coalesce(nullif(btrim(new.caption), ''), split_part(new.storage_path, '/', 3), 'Map photo');

  insert into public.organization_files (
    id, organization_id, folder_id, display_name, original_filename,
    source_kind, provider, storage_bucket, storage_path, mime_type,
    size_bytes, shared_with_n3xra, created_by_user_id
  ) values (
    linked_file_id,
    new.organization_id,
    asset_folder_id,
    left(coalesce(nullif(regexp_replace(original_name, '\.[^.]+$', ''), ''), 'Map photo'), 180),
    left(original_name, 255),
    'upload',
    'n3xra',
    'maps-asset-photos',
    new.storage_path,
    new.mime_type,
    new.size_bytes,
    false,
    new.created_by_user_id
  );

  new.organization_file_id := linked_file_id;
  return new;
end;
$$;

create or replace function private.unlink_map_photo_from_organization_files()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.organization_file_id is not null then
    delete from public.organization_files file
    where file.id = old.organization_file_id
      and file.organization_id = old.organization_id;
  end if;
  return old;
end;
$$;

drop trigger if exists map_feature_photos_link_organization_file on public.map_feature_photos;
create trigger map_feature_photos_link_organization_file
before insert on public.map_feature_photos
for each row execute function private.link_map_photo_to_organization_files();

drop trigger if exists map_feature_photos_unlink_organization_file on public.map_feature_photos;
create trigger map_feature_photos_unlink_organization_file
after delete on public.map_feature_photos
for each row execute function private.unlink_map_photo_from_organization_files();

revoke all on function private.link_map_photo_to_organization_files() from public, anon, authenticated;
revoke all on function private.unlink_map_photo_from_organization_files() from public, anon, authenticated;
