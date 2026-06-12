drop policy if exists "organization_contacts_select_policy" on public.organization_contacts;
create policy "organization_contacts_select_policy"
on public.organization_contacts
for select
using (
  public.can_manage_members(organization_id)
  or public.can_manage_documents(organization_id)
);
