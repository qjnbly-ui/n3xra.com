-- Best-effort migration from the original single-user schema to the
-- organization-based multi-tenant schema.
--
-- Recommended order:
-- 1. Back up your database and storage bucket first.
-- 2. Run this migration.
-- 3. Run supabase/schema.sql to apply the final policies/functions.

create extension if not exists pgcrypto;

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;

create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  subscription_tier text not null default 'free',
  account_status text not null default 'active',
  document_limit integer not null default 25,
  storage_limit_mb integer not null default 512,
  user_limit integer not null default 2,
  public_embed_enabled boolean not null default false,
  public_embed_token text unique default encode(gen_random_bytes(12), 'hex'),
  transcript_preview_enabled boolean not null default false,
  keyword_search_enabled boolean not null default true,
  file_preview_cards_enabled boolean not null default true,
  hosted_public_portal_enabled boolean not null default false,
  branded_primary_color text,
  branded_accent_color text,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_price_id text,
  subscription_current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'viewer',
  permissions jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table if not exists public.organization_invites (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  code text not null unique,
  role text not null default 'viewer',
  max_uses integer not null default 1,
  redeemed_uses integer not null default 0,
  expires_at timestamptz,
  is_disabled boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.documents add column if not exists organization_id uuid references public.organizations (id) on delete cascade;
alter table public.documents add column if not exists uploaded_by_user_id uuid references auth.users (id) on delete set null;
alter table public.documents add column if not exists is_public boolean not null default false;

insert into public.platform_admins (user_id, email)
select id, email
from public.profiles
where lower(coalesce(email, '')) = 'quentin@quentinnichols.com'
on conflict (user_id) do update set email = excluded.email;

insert into public.organizations (
  name,
  slug,
  owner_user_id,
  subscription_tier,
  account_status,
  document_limit,
  storage_limit_mb,
  user_limit,
  public_embed_enabled,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_price_id,
  subscription_current_period_end
)
select
  coalesce(nullif(trim(p.organization_name), ''), split_part(coalesce(p.email, 'library'), '@', 1) || ' library'),
  lower(regexp_replace(coalesce(nullif(trim(p.organization_name), ''), split_part(coalesce(p.email, 'library'), '@', 1) || ' library') || '-' || substr(p.id::text, 1, 8), '[^a-zA-Z0-9]+', '-', 'g')),
  p.id,
  coalesce(p.subscription_tier, 'free'),
  coalesce(p.account_status, 'active'),
  coalesce(p.document_limit, case when p.subscription_tier = 'organization' then 2500 when p.subscription_tier = 'starter' then 250 else 25 end),
  case when p.subscription_tier = 'organization' then 20480 when p.subscription_tier = 'starter' then 4096 else 512 end,
  case when p.subscription_tier = 'organization' then 20 when p.subscription_tier = 'starter' then 6 else 2 end,
  false,
  p.stripe_customer_id,
  p.stripe_subscription_id,
  p.stripe_price_id,
  p.subscription_current_period_end
from public.profiles p
where not exists (
  select 1
  from public.organizations o
  where o.owner_user_id = p.id
);

insert into public.organization_memberships (organization_id, user_id, role, created_by)
select o.id, o.owner_user_id, 'account_owner', o.owner_user_id
from public.organizations o
where not exists (
  select 1
  from public.organization_memberships om
  where om.organization_id = o.id
    and om.user_id = o.owner_user_id
);

create temporary table temp_document_paths as
select
  d.id,
  d.user_id as old_user_id,
  d.storage_path as old_storage_path,
  o.id as organization_id,
  o.id::text || substring(d.storage_path from position('/' in d.storage_path)) as new_storage_path
from public.documents d
join public.organizations o on o.owner_user_id = d.user_id
where d.organization_id is null
  and d.storage_path like '%/%';

update storage.objects
set name = temp_document_paths.new_storage_path
from temp_document_paths
where storage.objects.bucket_id = 'documents'
  and storage.objects.name = temp_document_paths.old_storage_path;

update public.documents d
set
  organization_id = temp_document_paths.organization_id,
  uploaded_by_user_id = coalesce(d.uploaded_by_user_id, temp_document_paths.old_user_id),
  storage_path = temp_document_paths.new_storage_path
from temp_document_paths
where d.id = temp_document_paths.id;

drop table temp_document_paths;

update public.documents d
set
  organization_id = o.id,
  uploaded_by_user_id = coalesce(d.uploaded_by_user_id, d.user_id)
from public.organizations o
where d.organization_id is null
  and o.owner_user_id = d.user_id;
