insert into public.n3xra_product_catalog (
  product_key, name, description, portal_path, icon_key,
  client_portal_available, status, sort_order
)
values (
  'files_assets',
  'Files & Assets',
  'One secure home for files used across your N3XRA products.',
  '/client-portal/files/',
  'files-assets',
  true,
  'active',
  30
)
on conflict (product_key) do update
set name = excluded.name,
    description = excluded.description,
    portal_path = excluded.portal_path,
    icon_key = excluded.icon_key,
    client_portal_available = excluded.client_portal_available,
    status = excluded.status,
    sort_order = excluded.sort_order,
    updated_at = now();

create table public.organization_file_folders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  parent_id uuid references public.organization_file_folders(id) on delete cascade,
  name text not null,
  source_product text not null default 'files_assets'
    check (source_product in ('files_assets', 'websites', 'project_cards')),
  source_entity_id uuid,
  shared_with_n3xra boolean not null default false,
  is_system boolean not null default false,
  created_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_file_folders_name_check
    check (length(btrim(name)) between 1 and 120 and name !~ '[/\\]')
);

create unique index organization_file_folders_unique_name_idx
on public.organization_file_folders (
  organization_id,
  coalesce(parent_id::text, ''),
  lower(name)
);

create index organization_file_folders_org_parent_idx
on public.organization_file_folders (organization_id, parent_id, name);

create index organization_file_folders_source_idx
on public.organization_file_folders (organization_id, source_product, source_entity_id)
where source_entity_id is not null;

create unique index organization_file_folders_unique_source_idx
on public.organization_file_folders (organization_id, source_product, source_entity_id)
where source_entity_id is not null;

create table public.organization_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  folder_id uuid references public.organization_file_folders(id) on delete set null,
  display_name text not null,
  original_filename text not null,
  source_kind text not null default 'upload'
    check (source_kind in ('upload', 'external_reference')),
  provider text not null default 'n3xra'
    check (provider in ('n3xra', 'google_drive', 'microsoft_onedrive', 'dropbox', 'external_url')),
  provider_file_id text,
  external_url text,
  storage_bucket text,
  storage_path text,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  shared_with_n3xra boolean not null default false,
  created_by_user_id uuid not null references auth.users(id),
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_files_name_check
    check (length(btrim(display_name)) between 1 and 180 and length(btrim(original_filename)) between 1 and 255),
  constraint organization_files_external_url_check
    check (external_url is null or external_url ~* '^https://[^[:space:]]+$'),
  constraint organization_files_storage_path_check
    check (
      storage_path is null
      or (
        storage_path !~ '(^|/)\.\.(/|$)'
        and storage_path !~ '^/'
        and length(storage_path) between 3 and 600
      )
    ),
  constraint organization_files_source_check
    check (
      (source_kind = 'upload' and provider = 'n3xra' and storage_bucket is not null and storage_path is not null and external_url is null)
      or
      (source_kind = 'external_reference' and provider <> 'n3xra' and external_url is not null and storage_bucket is null and storage_path is null)
    )
);

create unique index organization_files_storage_unique_idx
on public.organization_files (storage_bucket, storage_path)
where storage_path is not null;

create index organization_files_org_folder_updated_idx
on public.organization_files (organization_id, folder_id, updated_at desc);

create index organization_files_org_created_idx
on public.organization_files (organization_id, created_at desc);

create index organization_files_admin_shared_idx
on public.organization_files (organization_id, shared_with_n3xra, updated_at desc)
where shared_with_n3xra;

create trigger organization_file_folders_set_updated_at
before update on public.organization_file_folders
for each row execute function public.set_updated_at();

create trigger organization_files_set_updated_at
before update on public.organization_files
for each row execute function public.set_updated_at();

create or replace function public.can_view_organization_files(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1 from public.organizations organization
        where organization.id = target_organization_id
          and organization.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = (select auth.uid())
      )
    );
$$;

create or replace function public.can_manage_organization_files(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      exists (
        select 1 from public.organizations organization
        where organization.id = target_organization_id
          and organization.owner_user_id = (select auth.uid())
      )
      or exists (
        select 1 from public.organization_memberships membership
        where membership.organization_id = target_organization_id
          and membership.user_id = (select auth.uid())
          and membership.role in ('account_admin', 'editor')
      )
    );
$$;

revoke all on function public.can_view_organization_files(uuid) from public, anon;
revoke all on function public.can_manage_organization_files(uuid) from public, anon;
grant execute on function public.can_view_organization_files(uuid) to authenticated;
grant execute on function public.can_manage_organization_files(uuid) to authenticated;

create or replace function private.guard_organization_file_folder_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.parent_id is not null and not exists (
    select 1 from public.organization_file_folders parent
    where parent.id = new.parent_id and parent.organization_id = new.organization_id
  ) then
    raise exception 'Folder and parent must belong to the same organization.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.source_product is distinct from old.source_product
    or new.source_entity_id is distinct from old.source_entity_id
    or (old.is_system and not new.is_system)
  ) then
    raise exception 'System folder identity cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function private.guard_organization_file_write()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.folder_id is not null and not exists (
    select 1 from public.organization_file_folders folder
    where folder.id = new.folder_id and folder.organization_id = new.organization_id
  ) then
    raise exception 'File and folder must belong to the same organization.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.source_kind is distinct from old.source_kind
    or new.provider is distinct from old.provider
    or new.storage_bucket is distinct from old.storage_bucket
    or new.storage_path is distinct from old.storage_path
    or new.created_by_user_id is distinct from old.created_by_user_id
  ) then
    raise exception 'Move or replace this file through the file service.' using errcode = '42501';
  end if;
  new.updated_by_user_id = (select auth.uid());
  return new;
end;
$$;

create trigger organization_file_folders_guard_write
before insert or update on public.organization_file_folders
for each row execute function private.guard_organization_file_folder_write();

create trigger organization_files_guard_write
before insert or update on public.organization_files
for each row execute function private.guard_organization_file_write();

revoke all on function private.guard_organization_file_folder_write() from public, anon, authenticated;
revoke all on function private.guard_organization_file_write() from public, anon, authenticated;

alter table public.organization_file_folders enable row level security;
alter table public.organization_files enable row level security;

revoke all on public.organization_file_folders from public, anon, authenticated;
revoke all on public.organization_files from public, anon, authenticated;
grant select, insert, update, delete on public.organization_file_folders to authenticated;
grant select, insert, update, delete on public.organization_files to authenticated;
grant all on public.organization_file_folders to service_role;
grant all on public.organization_files to service_role;

create policy organization_file_folders_member_select
on public.organization_file_folders for select to authenticated
using ((select public.can_view_organization_files(organization_id)));

create policy organization_file_folders_editor_insert
on public.organization_file_folders for insert to authenticated
with check (
  (select public.can_manage_organization_files(organization_id))
  and created_by_user_id = (select auth.uid())
  and source_product = 'files_assets'
  and not is_system
  and not shared_with_n3xra
);

create policy organization_file_folders_editor_update
on public.organization_file_folders for update to authenticated
using ((select public.can_manage_organization_files(organization_id)) and not is_system)
with check ((select public.can_manage_organization_files(organization_id)) and not is_system);

create policy organization_file_folders_editor_delete
on public.organization_file_folders for delete to authenticated
using ((select public.can_manage_organization_files(organization_id)) and not is_system);

create policy organization_files_member_select
on public.organization_files for select to authenticated
using (
  (select public.can_view_organization_files(organization_id))
  or ((select public.is_platform_admin()) and shared_with_n3xra)
);

create policy organization_files_editor_insert
on public.organization_files for insert to authenticated
with check (
  (select public.can_manage_organization_files(organization_id))
  and created_by_user_id = (select auth.uid())
);

create policy organization_files_editor_update
on public.organization_files for update to authenticated
using ((select public.can_manage_organization_files(organization_id)))
with check ((select public.can_manage_organization_files(organization_id)));

create policy organization_files_editor_delete
on public.organization_files for delete to authenticated
using ((select public.can_manage_organization_files(organization_id)));

insert into storage.buckets (id, name, public, file_size_limit)
values ('organization-files-private', 'organization-files-private', false, 52428800)
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit;

update storage.buckets
set public = false
where id = 'project-card-resources';

create policy organization_files_private_select
on storage.objects for select to authenticated
using (
  bucket_id = 'organization-files-private'
  and (
    (
      (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
      and (select public.can_view_organization_files(((storage.foldername(name))[1])::uuid))
    )
    or (
      (select public.is_platform_admin())
      and exists (
        select 1 from public.organization_files file
        where file.storage_bucket = 'organization-files-private'
          and file.storage_path = name
          and file.shared_with_n3xra
      )
    )
  )
);

create policy organization_files_private_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'organization-files-private'
  and owner_id = (select auth.uid())::text
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (select public.can_manage_organization_files(((storage.foldername(name))[1])::uuid))
);

create policy organization_files_private_update
on storage.objects for update to authenticated
using (
  bucket_id = 'organization-files-private'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (select public.can_manage_organization_files(((storage.foldername(name))[1])::uuid))
)
with check (
  bucket_id = 'organization-files-private'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (select public.can_manage_organization_files(((storage.foldername(name))[1])::uuid))
);

create policy organization_files_private_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'organization-files-private'
  and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
  and (select public.can_manage_organization_files(((storage.foldername(name))[1])::uuid))
);

alter table public.project_card_resources
  add column organization_file_id uuid references public.organization_files(id) on delete set null,
  add column share_on_project_card boolean not null default false;

create index project_card_resources_organization_file_idx
on public.project_card_resources (organization_file_id)
where organization_file_id is not null;

insert into public.organization_file_folders (
  organization_id, name, source_product, source_entity_id,
  shared_with_n3xra, is_system, created_by_user_id
)
select
  project.organization_id,
  project.name,
  'project_cards',
  project.id,
  false,
  true,
  project.created_by_user_id
from public.project_card_projects project
on conflict do nothing;

insert into public.organization_files (
  organization_id, folder_id, display_name, original_filename,
  source_kind, provider, storage_bucket, storage_path, mime_type, size_bytes,
  shared_with_n3xra, created_by_user_id, created_at, updated_at
)
select
  project.organization_id,
  folder.id,
  resource.title,
  coalesce(nullif(resource.content->>'file_name', ''), resource.title),
  'upload',
  'n3xra',
  'project-card-resources',
  resource.storage_path,
  nullif(resource.content->>'mime_type', ''),
  case
    when coalesce(resource.content->>'file_size', '') ~ '^[0-9]+$'
      then (resource.content->>'file_size')::bigint
    else 0
  end,
  false,
  resource.created_by_user_id,
  resource.created_at,
  resource.updated_at
from public.project_card_resources resource
join public.project_card_projects project on project.id = resource.project_id
join public.organization_file_folders folder
  on folder.organization_id = project.organization_id
 and folder.source_product = 'project_cards'
 and folder.source_entity_id = project.id
where resource.storage_path is not null
on conflict do nothing;

update public.project_card_resources resource
set organization_file_id = file.id,
    share_on_project_card = resource.is_visible
from public.organization_files file
where resource.storage_path is not null
  and file.storage_bucket = 'project-card-resources'
  and file.storage_path = resource.storage_path;

update public.project_card_resources
set share_on_project_card = is_visible
where storage_path is null;

drop policy if exists "project_card_resource_upload_select" on storage.objects;
drop policy if exists "project_card_resource_upload_insert" on storage.objects;
drop policy if exists "project_card_resource_upload_update" on storage.objects;
drop policy if exists "project_card_resource_upload_delete" on storage.objects;

drop policy if exists project_card_resources_member_select on public.project_card_resources;
drop policy if exists project_card_resources_editor_insert on public.project_card_resources;
drop policy if exists project_card_resources_editor_update on public.project_card_resources;
drop policy if exists project_card_resources_editor_delete on public.project_card_resources;

create policy project_card_resources_private_member_select
on public.project_card_resources for select to authenticated
using (
  exists (
    select 1 from public.project_card_projects project
    where project.id = project_id
      and public.organization_product_role(project.organization_id, 'project_cards') is not null
  )
);

create policy project_card_resources_private_editor_insert
on public.project_card_resources for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and exists (
    select 1 from public.project_card_projects project
    where project.id = project_id
      and public.organization_product_role(project.organization_id, 'project_cards') in ('account_admin', 'editor')
  )
);

create policy project_card_resources_private_editor_update
on public.project_card_resources for update to authenticated
using (
  exists (
    select 1 from public.project_card_projects project
    where project.id = project_id
      and public.organization_product_role(project.organization_id, 'project_cards') in ('account_admin', 'editor')
  )
)
with check (
  exists (
    select 1 from public.project_card_projects project
    where project.id = project_id
      and public.organization_product_role(project.organization_id, 'project_cards') in ('account_admin', 'editor')
  )
);

create policy project_card_resources_private_editor_delete
on public.project_card_resources for delete to authenticated
using (
  exists (
    select 1 from public.project_card_projects project
    where project.id = project_id
      and public.organization_product_role(project.organization_id, 'project_cards') in ('account_admin', 'editor')
  )
);

create policy project_card_resource_private_select
on storage.objects for select to authenticated
using (
  bucket_id = 'project-card-resources'
  and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text = (storage.foldername(name))[1]
      and project.id::text = (storage.foldername(name))[2]
      and public.organization_product_role(project.organization_id, 'project_cards') is not null
  )
);

create policy project_card_resource_private_write
on storage.objects for all to authenticated
using (
  bucket_id = 'project-card-resources'
  and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text = (storage.foldername(name))[1]
      and project.id::text = (storage.foldername(name))[2]
      and public.organization_product_role(project.organization_id, 'project_cards') in ('account_admin', 'editor')
  )
)
with check (
  bucket_id = 'project-card-resources'
  and exists (
    select 1 from public.project_card_projects project
    where project.organization_id::text = (storage.foldername(name))[1]
      and project.id::text = (storage.foldername(name))[2]
      and public.organization_product_role(project.organization_id, 'project_cards') in ('account_admin', 'editor')
  )
);

create or replace function public.ensure_project_card_file_folder(input_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_project public.project_card_projects%rowtype;
  target_folder_id uuid;
begin
  select * into target_project
  from public.project_card_projects project
  where project.id = input_project_id;

  if target_project.id is null
    or public.organization_product_role(target_project.organization_id, 'project_cards') not in ('account_admin', 'editor') then
    raise exception 'Project Card editor access is required.' using errcode = '42501';
  end if;

  insert into public.organization_product_entitlements (
    organization_id, product_key, status, portal_enabled, source, starts_at, metadata
  ) values (
    target_project.organization_id, 'files_assets', 'active', true, 'included', now(),
    jsonb_build_object('activated_by', 'project_cards')
  )
  on conflict (organization_id, product_key) do update
  set portal_enabled = true,
      status = case when public.organization_product_entitlements.status in ('paused', 'canceled') then 'active' else public.organization_product_entitlements.status end,
      metadata = public.organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now();

  insert into public.organization_file_folders (
    organization_id, name, source_product, source_entity_id,
    shared_with_n3xra, is_system, created_by_user_id
  ) values (
    target_project.organization_id, target_project.name, 'project_cards', target_project.id,
    false, true, (select auth.uid())
  )
  on conflict do nothing;

  select folder.id into target_folder_id
  from public.organization_file_folders folder
  where folder.organization_id = target_project.organization_id
    and folder.source_product = 'project_cards'
    and folder.source_entity_id = target_project.id
  limit 1;

  insert into public.organization_product_member_access (
    organization_id, product_key, user_id, role, status, granted_by
  ) values (
    target_project.organization_id, 'files_assets', (select auth.uid()),
    'editor', 'active', (select auth.uid())
  )
  on conflict (organization_id, product_key, user_id) do update
  set role = case
        when public.organization_product_member_access.role = 'account_admin' then 'account_admin'
        else 'editor'
      end,
      status = 'active',
      updated_at = now();

  return target_folder_id;
end;
$$;

revoke all on function public.ensure_project_card_file_folder(uuid) from public, anon;
grant execute on function public.ensure_project_card_file_folder(uuid) to authenticated;

create or replace function public.activate_files_assets(input_organization_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_manage_organization_files(input_organization_id) then
    raise exception 'Organization editor access is required.' using errcode = '42501';
  end if;

  insert into public.organization_product_entitlements (
    organization_id, product_key, status, portal_enabled, source, starts_at, metadata
  ) values (
    input_organization_id, 'files_assets', 'active', true, 'included', now(),
    jsonb_build_object('activated_by', 'files_assets')
  )
  on conflict (organization_id, product_key) do update
  set portal_enabled = true,
      status = case when public.organization_product_entitlements.status in ('paused', 'canceled') then 'active' else public.organization_product_entitlements.status end,
      metadata = public.organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now();

  insert into public.organization_product_member_access (
    organization_id, product_key, user_id, role, status, granted_by
  ) values (
    input_organization_id, 'files_assets', (select auth.uid()),
    case when public.organization_role(input_organization_id) = 'account_admin' then 'account_admin' else 'editor' end,
    'active', (select auth.uid())
  )
  on conflict (organization_id, product_key, user_id) do update
  set role = excluded.role, status = 'active', updated_at = now();

  return jsonb_build_object('ok', true, 'organization_id', input_organization_id, 'product_key', 'files_assets');
end;
$$;

revoke all on function public.activate_files_assets(uuid) from public, anon;
grant execute on function public.activate_files_assets(uuid) to authenticated;

insert into public.organization_product_entitlements (
  organization_id, product_key, status, portal_enabled, source, starts_at, metadata
)
select distinct candidate.organization_id, 'files_assets', 'active', true, 'included', now(), candidate.metadata
from (
  select website.organization_id,
         jsonb_build_object('activated_by', 'websites') as metadata
  from public.client_websites website
  where website.organization_id is not null
  union
  select project.organization_id,
         jsonb_build_object('activated_by', 'project_cards') as metadata
  from public.project_card_projects project
) candidate
on conflict (organization_id, product_key) do nothing;

insert into public.organization_product_member_access (
  organization_id, product_key, user_id, role, status, granted_by
)
select entitlement.organization_id,
       'files_assets',
       membership.user_id,
       membership.role,
       'active',
       organization.owner_user_id
from public.organization_product_entitlements entitlement
join public.organization_memberships membership
  on membership.organization_id = entitlement.organization_id
join public.organizations organization
  on organization.id = entitlement.organization_id
where entitlement.product_key = 'files_assets'
  and entitlement.portal_enabled
  and entitlement.status in ('trialing', 'active', 'past_due')
on conflict (organization_id, product_key, user_id) do nothing;

create or replace function private.ensure_website_files_product()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.organization_id is null then
    return new;
  end if;

  insert into public.organization_product_entitlements (
    organization_id, product_key, status, portal_enabled, source, starts_at, metadata
  ) values (
    new.organization_id, 'files_assets', 'active', true, 'included', now(),
    jsonb_build_object('activated_by', 'websites')
  )
  on conflict (organization_id, product_key) do update
  set portal_enabled = true,
      metadata = public.organization_product_entitlements.metadata || excluded.metadata,
      updated_at = now();

  return new;
end;
$$;

revoke all on function private.ensure_website_files_product() from public, anon, authenticated;

create trigger client_websites_ensure_files_product
after insert or update of organization_id on public.client_websites
for each row execute function private.ensure_website_files_product();

create or replace function public.admin_organization_file_usage()
returns table (
  organization_id uuid,
  private_file_count bigint,
  private_storage_bytes bigint,
  shared_with_n3xra_count bigint,
  website_file_count bigint,
  website_storage_bytes bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with private_usage as (
    select file.organization_id,
           count(*)::bigint as file_count,
           coalesce(sum(file.size_bytes), 0)::bigint as storage_bytes,
           count(*) filter (where file.shared_with_n3xra)::bigint as shared_count
    from public.organization_files file
    group by file.organization_id
  ), website_usage as (
    select website.organization_id,
           count(version.id)::bigint as file_count,
           coalesce(sum(version.size_bytes), 0)::bigint as storage_bytes
    from public.client_websites website
    left join public.website_assets asset on asset.website_id = website.id
    left join public.website_asset_versions version on version.asset_id = asset.id
    where website.organization_id is not null
    group by website.organization_id
  )
  select organization.id,
         coalesce(private_usage.file_count, 0),
         coalesce(private_usage.storage_bytes, 0),
         coalesce(private_usage.shared_count, 0),
         coalesce(website_usage.file_count, 0),
         coalesce(website_usage.storage_bytes, 0)
  from public.organizations organization
  left join private_usage on private_usage.organization_id = organization.id
  left join website_usage on website_usage.organization_id = organization.id
  where (select public.is_platform_admin());
$$;

revoke all on function public.admin_organization_file_usage() from public, anon, authenticated;
grant execute on function public.admin_organization_file_usage() to authenticated;

create or replace function public.get_project_card_page(input_slug text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when input_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or length(input_slug) not between 3 and 80 then null
    else (
      select jsonb_build_object(
        'slug', project.slug,
        'name', project.name,
        'description', project.description,
        'location_text', project.location_text,
        'updated_at', project.updated_at,
        'resources', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', resource.id,
              'resource_type', resource.resource_type,
              'title', resource.title,
              'detail', resource.detail,
              'content', resource.content,
              'external_url', resource.external_url,
              'has_file', resource.organization_file_id is not null or resource.storage_path is not null,
              'sort_order', resource.sort_order
            ) order by resource.sort_order, resource.created_at
          )
          from public.project_card_resources resource
          where resource.project_id = project.id
            and resource.is_visible
            and resource.share_on_project_card
        ), '[]'::jsonb)
      )
      from public.project_card_projects project
      where project.slug = input_slug
        and project.status = 'live'
        and project.access_level = 'public'
      limit 1
    )
  end;
$$;

revoke all on function public.get_project_card_page(text) from public;
grant execute on function public.get_project_card_page(text) to anon, authenticated;

create or replace function public.get_public_project_card_file(input_slug text, input_resource_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'bucket', coalesce(file.storage_bucket, 'project-card-resources'),
    'path', coalesce(file.storage_path, resource.storage_path),
    'filename', coalesce(file.original_filename, nullif(resource.content->>'file_name', ''), resource.title),
    'mime_type', coalesce(file.mime_type, nullif(resource.content->>'mime_type', ''))
  )
  from public.project_card_projects project
  join public.project_card_resources resource on resource.project_id = project.id
  left join public.organization_files file on file.id = resource.organization_file_id
  where project.slug = input_slug
    and project.status = 'live'
    and project.access_level = 'public'
    and resource.id = input_resource_id
    and resource.is_visible
    and resource.share_on_project_card
    and coalesce(file.storage_path, resource.storage_path) is not null
  limit 1;
$$;

revoke all on function public.get_public_project_card_file(text, uuid) from public;
grant execute on function public.get_public_project_card_file(text, uuid) to anon, authenticated;
grant execute on function public.get_public_project_card_file(text, uuid) to service_role;

comment on table public.organization_files is
  'Organization-private canonical file catalog. Platform administrators do not receive row access; explicit sharing is represented by shared_with_n3xra.';
comment on function public.admin_organization_file_usage() is
  'Privacy-safe platform totals only. It intentionally returns no filenames, paths, previews, or download identifiers.';
