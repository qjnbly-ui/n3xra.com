create table public.contact_card_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  display_name text not null,
  headline text not null default '',
  company_name text not null default '',
  bio text not null default '',
  email text,
  phone_e164 text,
  website_url text,
  location_text text not null default '',
  links jsonb not null default '[]'::jsonb,
  profile_image_path text,
  company_logo_path text,
  background_image_path text,
  section_order text[] not null default array['about', 'contact', 'links']::text[],
  accent_color text not null default '#2f7d68',
  show_n3xra_branding boolean not null default true,
  status text not null default 'draft' check (status in ('draft', 'published', 'paused')),
  physical_card_status text not null default 'not_requested' check (physical_card_status in ('not_requested', 'requested', 'processing', 'shipped')),
  physical_card_requested_at timestamptz,
  shipping_name text not null default '',
  shipping_address_line_1 text not null default '',
  shipping_address_line_2 text not null default '',
  shipping_city text not null default '',
  shipping_region text not null default '',
  shipping_postal_code text not null default '',
  shipping_country text not null default 'United States',
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_card_profiles_slug_check check (slug = lower(slug) and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' and length(slug) between 2 and 64),
  constraint contact_card_profiles_display_name_check check (length(btrim(display_name)) between 1 and 180),
  constraint contact_card_profiles_email_check check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint contact_card_profiles_phone_check check (phone_e164 is null or phone_e164 ~ E'^\\+[1-9][0-9]{7,14}$'),
  constraint contact_card_profiles_website_check check (website_url is null or website_url ~* '^https?://'),
  constraint contact_card_profiles_links_check check (jsonb_typeof(links) = 'array' and jsonb_array_length(links) <= 12),
  constraint contact_card_profiles_section_order_check check (
    cardinality(section_order) = 3
    and section_order <@ array['about', 'contact', 'links']::text[]
    and section_order @> array['about', 'contact', 'links']::text[]
  ),
  constraint contact_card_profiles_profile_image_path_check check (
    profile_image_path is null or profile_image_path ~ ('^' || owner_user_id::text || '/' || id::text || '/profile\.(jpg|png|webp)$')
  ),
  constraint contact_card_profiles_company_logo_path_check check (
    company_logo_path is null or company_logo_path ~ ('^' || owner_user_id::text || '/' || id::text || '/logo\.(jpg|png|webp)$')
  ),
  constraint contact_card_profiles_background_image_path_check check (
    background_image_path is null or background_image_path ~ ('^' || owner_user_id::text || '/' || id::text || '/background\.(jpg|png|webp)$')
  ),
  constraint contact_card_profiles_accent_check check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  constraint contact_card_profiles_shipping_check check (
    physical_card_status = 'not_requested'
    or (
      length(btrim(shipping_name)) between 1 and 180
      and length(btrim(shipping_address_line_1)) between 1 and 240
      and length(btrim(shipping_city)) between 1 and 120
      and length(btrim(shipping_region)) between 1 and 120
      and length(btrim(shipping_postal_code)) between 1 and 32
      and length(btrim(shipping_country)) between 1 and 120
    )
  )
);

create unique index contact_card_profiles_slug_unique_idx on public.contact_card_profiles (lower(slug));
create unique index contact_card_profiles_owner_unique_idx on public.contact_card_profiles (owner_user_id);
create index contact_card_profiles_public_slug_idx on public.contact_card_profiles (slug) where status = 'published';

drop trigger if exists contact_card_profiles_set_updated_at on public.contact_card_profiles;
create trigger contact_card_profiles_set_updated_at
before update on public.contact_card_profiles
for each row execute function public.set_updated_at();

create or replace function public.guard_contact_card_customer_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce((select public.is_platform_admin()), false) is false then
    if new.owner_user_id is distinct from old.owner_user_id
      or new.created_by_user_id is distinct from old.created_by_user_id then
      raise exception 'Contact card ownership cannot be changed.';
    end if;
    if new.physical_card_status not in ('not_requested', 'requested') then
      raise exception 'Only N3XRA can update card fulfillment status.';
    end if;
    new.updated_by_user_id = (select auth.uid());
    if old.physical_card_status in ('processing', 'shipped')
      and new.physical_card_status is distinct from old.physical_card_status then
      raise exception 'This card request is already being fulfilled.';
    end if;
    if new.physical_card_status = 'requested' and old.physical_card_status is distinct from 'requested' then
      new.physical_card_requested_at = now();
    elsif new.physical_card_status = 'requested' then
      new.physical_card_requested_at = old.physical_card_requested_at;
    elsif new.physical_card_status = 'not_requested' then
      new.physical_card_requested_at = null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_card_profiles_guard_customer_updates on public.contact_card_profiles;
create trigger contact_card_profiles_guard_customer_updates
before update on public.contact_card_profiles
for each row execute function public.guard_contact_card_customer_updates();

revoke all on function public.guard_contact_card_customer_updates() from public, anon, authenticated;

alter table public.contact_card_profiles enable row level security;

create policy "contact_card_profiles_owner_select"
on public.contact_card_profiles for select to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

create policy "contact_card_profiles_admin_insert"
on public.contact_card_profiles for insert to authenticated
with check (
  (select public.is_platform_admin())
  or (
    (select auth.uid()) = owner_user_id
    and (created_by_user_id is null or created_by_user_id = (select auth.uid()))
    and (updated_by_user_id is null or updated_by_user_id = (select auth.uid()))
    and physical_card_status in ('not_requested', 'requested')
    and physical_card_requested_at is null
  )
);

create policy "contact_card_profiles_owner_update"
on public.contact_card_profiles for update to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()))
with check ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

create policy "contact_card_profiles_admin_delete"
on public.contact_card_profiles for delete to authenticated
using ((select public.is_platform_admin()));

revoke all on table public.contact_card_profiles from public, anon, authenticated;
grant select, update (
  display_name,
  headline,
  company_name,
  bio,
  email,
  phone_e164,
  website_url,
  location_text,
  links,
  profile_image_path,
  company_logo_path,
  background_image_path,
  section_order,
  accent_color,
  show_n3xra_branding,
  status,
  slug,
  physical_card_status,
  physical_card_requested_at,
  shipping_name,
  shipping_address_line_1,
  shipping_address_line_2,
  shipping_city,
  shipping_region,
  shipping_postal_code,
  shipping_country,
  updated_by_user_id
) on table public.contact_card_profiles to authenticated;
grant insert, delete on table public.contact_card_profiles to authenticated;
grant all on table public.contact_card_profiles to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contact-card-media',
  'contact-card-media',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "contact_card_media_owner_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'contact-card-media'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.contact_card_profiles as card
        where card.id::text = (storage.foldername(name))[2]
          and card.owner_user_id = (select auth.uid())
      )
    )
  )
);

create policy "contact_card_media_owner_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'contact-card-media'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.contact_card_profiles as card
        where card.id::text = (storage.foldername(name))[2]
          and card.owner_user_id = (select auth.uid())
      )
    )
  )
);

create policy "contact_card_media_owner_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'contact-card-media'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.contact_card_profiles as card
        where card.id::text = (storage.foldername(name))[2]
          and card.owner_user_id = (select auth.uid())
      )
    )
  )
)
with check (
  bucket_id = 'contact-card-media'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.contact_card_profiles as card
        where card.id::text = (storage.foldername(name))[2]
          and card.owner_user_id = (select auth.uid())
      )
    )
  )
);

create policy "contact_card_media_owner_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'contact-card-media'
  and (
    (select public.is_platform_admin())
    or (
      (storage.foldername(name))[1] = (select auth.uid())::text
      and exists (
        select 1 from public.contact_card_profiles as card
        where card.id::text = (storage.foldername(name))[2]
          and card.owner_user_id = (select auth.uid())
      )
    )
  )
);

comment on table public.contact_card_profiles is
  'N3XRA-hosted digital contact cards. Public reads go through the server endpoint so ownership identifiers are never exposed.';
comment on column public.contact_card_profiles.slug is
  'Public card URL segment used by /card/:slug.';
comment on column public.contact_card_profiles.owner_user_id is
  'Existing N3XRA Auth user who may edit this card through the client portal.';
;
