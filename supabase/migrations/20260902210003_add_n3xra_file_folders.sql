create table if not exists public.n3xra_file_folders (
  id uuid primary key default gen_random_uuid(),
  path text not null,
  created_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint n3xra_file_folders_path_length check (char_length(path) between 1 and 180),
  constraint n3xra_file_folders_path_shape check (
    path = btrim(path)
    and path !~ '(^/|/$|//)'
    and path !~ '[[:cntrl:]]'
    and path !~ E'\\\\'
    and path !~ '(^|/)\.{1,2}(/|$)'
  )
);

create unique index if not exists n3xra_file_folders_path_lower_key
  on public.n3xra_file_folders (lower(path));

create index if not exists n3xra_file_folders_created_by_idx
  on public.n3xra_file_folders (created_by);

alter table public.n3xra_file_folders enable row level security;

drop policy if exists "n3xra_file_folders_admin_select" on public.n3xra_file_folders;
create policy "n3xra_file_folders_admin_select" on public.n3xra_file_folders
for select to authenticated
using (public.is_platform_admin());
