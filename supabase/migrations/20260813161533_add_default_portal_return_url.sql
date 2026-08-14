-- Every branded portal should be able to return to its public website without
-- requiring a separate portal override. Prefer the explicit live URL, then use
-- the active primary website domain already attached to the tenant.
create or replace function public.resolve_website_portal(portal_hostname text)
returns table (
  website_id uuid,
  website_name text,
  website_slug text,
  portal_theme_id text,
  branding jsonb,
  features jsonb
)
language sql
stable
security definer
set search_path = public
as $$
  with requested as (
    select lower(trim(trailing '.' from trim(portal_hostname))) as hostname
  )
  select
    cw.id,
    cw.name,
    cw.portal_slug,
    cw.portal_theme_id,
    jsonb_build_object(
      'logo_asset_id', wpb.logo_asset_id,
      'favicon_asset_id', wpb.favicon_asset_id,
      'logo_url', case
        when logo_version.status = 'published'
          and logo_version.public_url ~ '^https://[^/]+/storage/v1/object/public/website-assets-public/'
        then logo_version.public_url
        else null
      end,
      'favicon_url', case
        when favicon_version.status = 'published'
          and favicon_version.public_url ~ '^https://[^/]+/storage/v1/object/public/website-assets-public/'
        then favicon_version.public_url
        else null
      end,
      'website_url', coalesce(
        nullif(trim(cw.live_url), ''),
        (
          select 'https://' || wd.domain_name
          from public.website_domains wd
          where wd.website_id = cw.id
            and wd.domain_purpose = 'website'
            and wd.status = 'active'
          order by wd.is_primary desc, wd.created_at asc
          limit 1
        )
      ),
      'primary_color', coalesce(wpb.primary_color, '#17231b'),
      'accent_color', coalesce(wpb.accent_color, '#b77946'),
      'heading_font', coalesce(wpb.heading_font, 'Fraunces'),
      'body_font', coalesce(wpb.body_font, 'Manrope'),
      'powered_by_label', coalesce(wpb.powered_by_label, 'Powered by N3XRA')
    ),
    coalesce((
      select jsonb_object_agg(wpf.feature_key, wpf.enabled)
      from public.website_portal_features wpf
      where wpf.website_id = cw.id
    ), '{}'::jsonb)
  from public.client_websites cw
  cross join requested r
  left join public.website_portal_branding wpb on wpb.website_id = cw.id
  left join public.website_assets logo
    on logo.id = wpb.logo_asset_id
    and logo.website_id = cw.id
    and logo.status = 'active'
  left join public.website_asset_versions logo_version
    on logo_version.id = logo.current_version_id
    and logo_version.asset_id = logo.id
  left join public.website_assets favicon
    on favicon.id = wpb.favicon_asset_id
    and favicon.website_id = cw.id
    and favicon.status = 'active'
  left join public.website_asset_versions favicon_version
    on favicon_version.id = favicon.current_version_id
    and favicon_version.asset_id = favicon.id
  where cw.portal_enabled
    and cw.status in ('draft', 'active')
    and (
      r.hostname = cw.portal_slug || '.portal.n3xra.com'
      or exists (
        select 1
        from public.website_domains wd
        where wd.website_id = cw.id
          and lower(wd.domain_name) = r.hostname
          and wd.domain_purpose = 'portal'
          and wd.status = 'active'
      )
    )
  limit 1;
$$;

revoke all on function public.resolve_website_portal(text) from public;
grant execute on function public.resolve_website_portal(text) to anon, authenticated;
;
