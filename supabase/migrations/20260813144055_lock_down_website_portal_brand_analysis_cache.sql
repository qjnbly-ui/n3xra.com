drop policy if exists "website_portal_brand_analysis_cache_client_deny"
on public.website_portal_brand_analysis_cache;

create policy "website_portal_brand_analysis_cache_client_deny"
on public.website_portal_brand_analysis_cache
for all
to anon, authenticated
using (false)
with check (false);;
