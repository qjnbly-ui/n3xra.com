create or replace function public.can_manage_templates(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or public.organization_role(target_organization_id) = 'account_admin';
$$;

drop policy if exists "app_documents_insert_policy" on public.app_documents;
create policy "app_documents_insert_policy"
on public.app_documents
for insert
with check (
  created_by_user_id = auth.uid()
  and (
    (document_kind = 'document' and public.can_manage_documents(organization_id))
    or (document_kind = 'template' and public.can_manage_templates(organization_id))
  )
);

drop policy if exists "app_documents_update_policy" on public.app_documents;
create policy "app_documents_update_policy"
on public.app_documents
for update
using (
  (document_kind = 'document' and public.can_manage_documents(organization_id))
  or (document_kind = 'template' and public.can_manage_templates(organization_id))
)
with check (
  (document_kind = 'document' and public.can_manage_documents(organization_id))
  or (document_kind = 'template' and public.can_manage_templates(organization_id))
);

drop policy if exists "app_documents_delete_policy" on public.app_documents;
create policy "app_documents_delete_policy"
on public.app_documents
for delete
using (
  (document_kind = 'document' and public.can_manage_documents(organization_id))
  or (document_kind = 'template' and public.can_manage_templates(organization_id))
);
