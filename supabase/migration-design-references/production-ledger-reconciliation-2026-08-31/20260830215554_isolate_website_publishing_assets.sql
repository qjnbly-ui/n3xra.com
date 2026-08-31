alter table public.website_assets
  drop constraint if exists website_assets_category_check;

alter table public.website_assets
  add constraint website_assets_category_check
  check (category in ('image', 'logo', 'document', 'brand', 'social', 'journal', 'visitor_submission', 'other'));

update public.website_assets as asset
set category = 'journal'
where asset.category = 'image'
  and exists (
    select 1
    from public.website_asset_versions as version
    where version.asset_id = asset.id
      and version.change_note = 'Uploaded from Website Publishing'
  );

update public.website_assets
set category = 'visitor_submission'
where category = 'social'
  and asset_key like 'customer_story_%';
