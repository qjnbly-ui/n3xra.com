create table if not exists public.n3xra_files (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.n3xra_file_access (
  file_id uuid not null references public.n3xra_files (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  granted_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (file_id, user_id)
);

create index if not exists n3xra_file_access_user_idx on public.n3xra_file_access (user_id);

alter table public.n3xra_files enable row level security;
alter table public.n3xra_file_access enable row level security;

drop policy if exists "n3xra_files_admin_select" on public.n3xra_files;
create policy "n3xra_files_admin_select" on public.n3xra_files
for select to authenticated
using (public.is_platform_admin());

drop policy if exists "n3xra_file_access_admin_select" on public.n3xra_file_access;
create policy "n3xra_file_access_admin_select" on public.n3xra_file_access
for select to authenticated
using (public.is_platform_admin());

insert into storage.buckets (id, name, public)
values ('n3xra-files', 'n3xra-files', false)
on conflict (id) do update set public = false;

drop policy if exists "n3xra_files_storage_admin_insert" on storage.objects;
create policy "n3xra_files_storage_admin_insert" on storage.objects
for insert to authenticated
with check (bucket_id = 'n3xra-files' and public.is_platform_admin());

drop policy if exists "n3xra_files_storage_admin_update" on storage.objects;
create policy "n3xra_files_storage_admin_update" on storage.objects
for update to authenticated
using (bucket_id = 'n3xra-files' and public.is_platform_admin())
with check (bucket_id = 'n3xra-files' and public.is_platform_admin());

drop policy if exists "n3xra_files_storage_admin_delete" on storage.objects;
create policy "n3xra_files_storage_admin_delete" on storage.objects
for delete to authenticated
using (bucket_id = 'n3xra-files' and public.is_platform_admin());
