-- Draft websites can be explicitly activated for pre-launch portal testing.
-- Paused and archived websites remain unavailable even if portal_enabled was
-- previously set, so portal_enabled is not the only access-state safeguard.
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
