grant delete on public.website_assets to authenticated;

drop policy if exists "website_assets_delete_empty_own" on public.website_assets;
create policy "website_assets_delete_empty_own"
on public.website_assets
for delete
to authenticated
using (
  created_by_user_id = (select auth.uid())
  and public.can_edit_client_website(website_id)
  and current_version_id is null
  and not exists (
    select 1
    from public.website_asset_versions version
    where version.asset_id = website_assets.id
  )
);

drop policy if exists "website_assets_delete_admin" on public.website_assets;
create policy "website_assets_delete_admin"
on public.website_assets
for delete
to authenticated
using ((select public.is_platform_admin()));
;
