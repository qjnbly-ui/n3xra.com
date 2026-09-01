-- Public file delivery is brokered by the server endpoint. Keep the underlying
-- security-definer lookup unavailable to browser roles so storage metadata is
-- never exposed directly through PostgREST.
revoke all on function public.get_public_project_card_file(text, uuid) from public, anon, authenticated;
grant execute on function public.get_public_project_card_file(text, uuid) to service_role;

-- Cover foreign-key maintenance and the direct folder lookups used by the file
-- library. The organization-prefixed indexes remain for tenant-scoped lists.
create index if not exists organization_file_folders_parent_idx
on public.organization_file_folders (parent_id);

create index if not exists organization_file_folders_created_by_idx
on public.organization_file_folders (created_by_user_id);

create index if not exists organization_files_folder_idx
on public.organization_files (folder_id);

create index if not exists organization_files_created_by_idx
on public.organization_files (created_by_user_id);

create index if not exists organization_files_updated_by_idx
on public.organization_files (updated_by_user_id);
