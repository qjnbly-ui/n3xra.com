alter table public.client_websites
add column if not exists portal_enabled boolean not null default false,
add column if not exists portal_theme_id text not null default 'classic';

alter table public.client_websites
drop constraint if exists client_websites_portal_theme_id_check;

alter table public.client_websites
add constraint client_websites_portal_theme_id_check
check (portal_theme_id ~ '^[a-z][a-z0-9_-]{1,49}$');

alter table public.website_domains
add column if not exists domain_purpose text not null default 'website';

alter table public.website_domains
drop constraint if exists website_domains_purpose_check;

alter table public.website_domains
add constraint website_domains_purpose_check
check (domain_purpose in ('website', 'portal', 'customer_account'));

create unique index if not exists website_domains_unique_portal_hostname_idx
on public.website_domains (lower(domain_name))
where domain_purpose = 'portal' and status in ('active', 'pending');

alter table public.website_assets
drop constraint if exists website_assets_website_id_id_unique;

alter table public.website_assets
add constraint website_assets_website_id_id_unique unique (website_id, id);

create table if not exists public.website_portal_branding (
  website_id uuid primary key references public.client_websites (id) on delete cascade,
  logo_asset_id uuid references public.website_assets (id) on delete set null,
  favicon_asset_id uuid references public.website_assets (id) on delete set null,
  primary_color text not null default '#17231b',
  accent_color text not null default '#b77946',
  heading_font text not null default 'Fraunces',
  body_font text not null default 'Manrope',
  powered_by_label text not null default 'Powered by N3XRA',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_portal_branding_primary_color_check check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint website_portal_branding_accent_color_check check (accent_color ~ '^#[0-9A-Fa-f]{6}$'),
  constraint website_portal_branding_heading_font_check check (char_length(trim(heading_font)) between 1 and 100),
  constraint website_portal_branding_body_font_check check (char_length(trim(body_font)) between 1 and 100),
  constraint website_portal_branding_powered_by_check check (char_length(powered_by_label) <= 100)
);

alter table public.website_portal_branding
drop constraint if exists website_portal_branding_logo_same_website_fkey,
drop constraint if exists website_portal_branding_favicon_same_website_fkey;

alter table public.website_portal_branding
add constraint website_portal_branding_logo_same_website_fkey
foreign key (website_id, logo_asset_id) references public.website_assets (website_id, id) on delete set null (logo_asset_id),
add constraint website_portal_branding_favicon_same_website_fkey
foreign key (website_id, favicon_asset_id) references public.website_assets (website_id, id) on delete set null (favicon_asset_id);

create table if not exists public.website_portal_features (
  website_id uuid not null references public.client_websites (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (website_id, feature_key),
  constraint website_portal_features_key_check check (feature_key in (
    'overview', 'progress', 'files_assets', 'services', 'billing', 'support'
  ))
);

create index if not exists website_portal_branding_logo_asset_idx
on public.website_portal_branding (logo_asset_id);

create index if not exists website_portal_branding_favicon_asset_idx
on public.website_portal_branding (favicon_asset_id);

drop trigger if exists website_portal_branding_set_updated_at on public.website_portal_branding;
create trigger website_portal_branding_set_updated_at
before update on public.website_portal_branding
for each row execute function public.set_updated_at();

drop trigger if exists website_portal_features_set_updated_at on public.website_portal_features;
create trigger website_portal_features_set_updated_at
before update on public.website_portal_features
for each row execute function public.set_updated_at();

alter table public.website_portal_branding enable row level security;
alter table public.website_portal_features enable row level security;

revoke all on public.website_portal_branding from anon;
revoke all on public.website_portal_features from anon;
grant select, insert, update, delete on public.website_portal_branding to authenticated;
grant select, insert, update, delete on public.website_portal_features to authenticated;
grant all on public.website_portal_branding to service_role;
grant all on public.website_portal_features to service_role;

drop policy if exists "website_portal_branding_select" on public.website_portal_branding;
create policy "website_portal_branding_select"
on public.website_portal_branding for select to authenticated
using ((select public.can_view_client_website(website_id)));

drop policy if exists "website_portal_branding_admin_insert" on public.website_portal_branding;
create policy "website_portal_branding_admin_insert"
on public.website_portal_branding for insert to authenticated
with check ((select public.is_platform_admin()));

drop policy if exists "website_portal_branding_admin_update" on public.website_portal_branding;
create policy "website_portal_branding_admin_update"
on public.website_portal_branding for update to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

drop policy if exists "website_portal_branding_admin_delete" on public.website_portal_branding;
create policy "website_portal_branding_admin_delete"
on public.website_portal_branding for delete to authenticated
using ((select public.is_platform_admin()));

drop policy if exists "website_portal_features_select" on public.website_portal_features;
create policy "website_portal_features_select"
on public.website_portal_features for select to authenticated
using ((select public.can_view_client_website(website_id)));

drop policy if exists "website_portal_features_admin_insert" on public.website_portal_features;
create policy "website_portal_features_admin_insert"
on public.website_portal_features for insert to authenticated
with check ((select public.is_platform_admin()));

drop policy if exists "website_portal_features_admin_update" on public.website_portal_features;
create policy "website_portal_features_admin_update"
on public.website_portal_features for update to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

drop policy if exists "website_portal_features_admin_delete" on public.website_portal_features;
create policy "website_portal_features_admin_delete"
on public.website_portal_features for delete to authenticated
using ((select public.is_platform_admin()));

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
  select
    cw.id,
    cw.name,
    cw.slug,
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
  from public.website_domains wd
  join public.client_websites cw on cw.id = wd.website_id
  left join public.website_portal_branding wpb on wpb.website_id = cw.id
  where lower(wd.domain_name) = lower(trim(trailing '.' from portal_hostname))
    and wd.domain_purpose = 'portal'
    and wd.status = 'active'
    and cw.portal_enabled
    and cw.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_website_portal(text) from public;
grant execute on function public.resolve_website_portal(text) to anon, authenticated;

insert into public.website_portal_branding (website_id)
select id from public.client_websites
on conflict (website_id) do nothing;

insert into public.website_portal_features (website_id, feature_key, enabled)
select cw.id, feature.feature_key, true
from public.client_websites cw
cross join (values
  ('overview'), ('progress'), ('files_assets'), ('services'), ('billing'), ('support')
) as feature(feature_key)
on conflict (website_id, feature_key) do nothing;
;
