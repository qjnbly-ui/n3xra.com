-- These legacy Records policies require a signed-in user. Explicit role scoping
-- keeps them out of anonymous Storage operations for unrelated products.
alter policy "storage_select_organization_assets_policy"
on storage.objects to authenticated;

alter policy "storage_insert_organization_assets_policy"
on storage.objects to authenticated;

alter policy "storage_update_organization_assets_policy"
on storage.objects to authenticated;

alter policy "storage_delete_organization_assets_policy"
on storage.objects to authenticated;

alter policy "storage_select_own_documents"
on storage.objects to authenticated;

alter policy "storage_insert_own_documents"
on storage.objects to authenticated;

alter policy "storage_update_own_documents"
on storage.objects to authenticated;

alter policy "storage_delete_own_documents"
on storage.objects to authenticated;;
