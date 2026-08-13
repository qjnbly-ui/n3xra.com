-- Production migration version: 20260813052805.
-- Bridge the existing website workspace to the broader N3XRA organization model
-- without changing any existing website_members permissions. Organization linkage
-- is intentionally nullable until an administrator confirms the correct account.
alter table public.client_websites
add column if not exists organization_id uuid references public.organizations (id) on delete set null,
add column if not exists portal_slug text;

update public.client_websites
set portal_slug = slug
where portal_slug is null;

alter table public.client_websites
alter column portal_slug set not null;

alter table public.client_websites
drop constraint if exists client_websites_portal_slug_check;

alter table public.client_websites
add constraint client_websites_portal_slug_check
check (portal_slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$');

create unique index if not exists client_websites_portal_slug_idx
on public.client_websites (portal_slug);

create index if not exists client_websites_organization_id_idx
on public.client_websites (organization_id)
where organization_id is not null;

comment on column public.client_websites.organization_id is
'Optional parent N3XRA organization. Website membership remains the required website authorization boundary.';

comment on column public.client_websites.portal_slug is
'Stable tenant slug used for {portal_slug}.portal.n3xra.com.';

-- Extend the existing public portal discovery function so a portal can resolve
-- from the shared wildcard domain without creating one website_domains row per
-- customer. Custom domains remain supported as optional aliases.
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
    and cw.status = 'active'
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
