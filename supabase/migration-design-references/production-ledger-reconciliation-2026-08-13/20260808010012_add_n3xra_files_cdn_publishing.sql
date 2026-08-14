alter table public.n3xra_files
  add column if not exists cdn_storage_path text,
  add column if not exists cdn_url text,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users (id) on delete set null;

create unique index if not exists n3xra_files_cdn_storage_path_key
  on public.n3xra_files (cdn_storage_path)
  where cdn_storage_path is not null;

insert into storage.buckets (id, name, public)
values ('n3xra-files-public', 'n3xra-files-public', true)
on conflict (id) do update set public = true;
