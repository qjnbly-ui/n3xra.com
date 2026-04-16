create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists full_name text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

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
  user_limit integer not null default 1,
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
  updated_at timestamptz not null default now(),
  constraint organizations_subscription_tier_check
    check (subscription_tier in ('free', 'starter', 'organization')),
  constraint organizations_account_status_check
    check (account_status in ('active', 'trialing', 'past_due', 'canceled', 'suspended'))
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
  unique (organization_id, user_id),
  constraint organization_memberships_role_check
    check (role in ('account_owner', 'account_admin', 'editor', 'viewer'))
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
  created_at timestamptz not null default now(),
  constraint organization_invites_role_check
    check (role in ('account_admin', 'editor', 'viewer')),
  constraint organization_invites_max_uses_check
    check (max_uses > 0),
  constraint organization_invites_redeemed_uses_check
    check (redeemed_uses >= 0 and redeemed_uses <= max_uses)
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  uploaded_by_user_id uuid references auth.users (id) on delete set null,
  title text not null,
  original_filename text not null,
  storage_path text not null unique,
  mime_type text,
  file_size bigint,
  year text,
  month text,
  is_public boolean not null default false,
  status text not null default 'uploaded',
  processing_error text,
  extracted_text text,
  search_tsv tsvector generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(original_filename, '') || ' ' || coalesce(extracted_text, '')
    )
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint documents_status_check check (status in ('uploaded', 'processing', 'ready', 'failed'))
);

create index if not exists organizations_owner_user_id_idx on public.organizations (owner_user_id);
create index if not exists organization_memberships_user_id_idx on public.organization_memberships (user_id);
create index if not exists organization_memberships_org_id_idx on public.organization_memberships (organization_id);
create index if not exists organization_invites_org_id_idx on public.organization_invites (organization_id);
create index if not exists documents_organization_id_idx on public.documents (organization_id);
create index if not exists documents_created_at_idx on public.documents (created_at desc);
create index if not exists documents_search_tsv_idx on public.documents using gin (search_tsv);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data ->> 'full_name', null))
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();

  if lower(coalesce(new.email, '')) = 'quentin@quentinnichols.com' then
    insert into public.platform_admins (user_id, email)
    values (new.id, new.email)
    on conflict (user_id) do update set email = excluded.email;
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute procedure public.handle_new_user();

create or replace function public.slugify(input text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(input, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.unique_org_slug(base_name text)
returns text
language plpgsql
as $$
declare
  base_slug text := nullif(public.slugify(base_name), '');
  candidate text := base_slug;
  suffix integer := 1;
begin
  if candidate is null then
    base_slug := 'library';
    candidate := 'library';
  end if;

  while exists (select 1 from public.organizations where slug = candidate) loop
    suffix := suffix + 1;
    candidate := base_slug || '-' || suffix::text;
  end loop;

  return candidate;
end;
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(auth.jwt() ->> 'email', '') = 'quentin@quentinnichols.com'
    or exists (
      select 1
      from public.platform_admins
      where user_id = auth.uid()
    );
$$;

create or replace function public.organization_role(target_organization_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select om.role
  from public.organization_memberships om
  where om.organization_id = target_organization_id
    and om.user_id = auth.uid()
  limit 1;
$$;

create or replace function public.can_view_organization(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
    );
$$;

create or replace function public.can_manage_members(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.role in ('account_owner', 'account_admin')
    );
$$;

create or replace function public.can_manage_org_settings(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.role in ('account_owner', 'account_admin')
    );
$$;

create or replace function public.can_manage_billing(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.role = 'account_owner'
    );
$$;

create or replace function public.can_manage_documents(target_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_platform_admin()
    or exists (
      select 1
      from public.organization_memberships om
      where om.organization_id = target_organization_id
        and om.user_id = auth.uid()
        and om.role in ('account_owner', 'account_admin', 'editor')
    );
$$;

create or replace function public.storage_object_org_id(storage_name text)
returns uuid
language sql
immutable
as $$
  select nullif(split_part(storage_name, '/', 1), '')::uuid;
$$;

create or replace function public.bootstrap_organization(
  input_organization_name text default null,
  input_invite_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := auth.jwt() ->> 'email';
  existing_membership record;
  next_org_id uuid;
  next_org_name text;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  insert into public.profiles (id, email)
  values (current_user_id, current_email)
  on conflict (id) do update
    set email = excluded.email,
        updated_at = now();

  if lower(coalesce(current_email, '')) = 'quentin@quentinnichols.com' then
    insert into public.platform_admins (user_id, email)
    values (current_user_id, current_email)
    on conflict (user_id) do update set email = excluded.email;
  end if;

  select om.organization_id, o.name
  into existing_membership
  from public.organization_memberships om
  join public.organizations o on o.id = om.organization_id
  where om.user_id = current_user_id
  order by om.created_at asc
  limit 1;

  if existing_membership.organization_id is null then
    next_org_name := coalesce(
      nullif(trim(input_organization_name), ''),
      nullif(trim(auth.jwt() -> 'user_metadata' ->> 'organization_name'), ''),
      nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
      split_part(coalesce(current_email, 'library'), '@', 1) || ' library'
    );

    insert into public.organizations (
      name,
      slug,
      owner_user_id
    ) values (
      next_org_name,
      public.unique_org_slug(next_org_name),
      current_user_id
    )
    returning id into next_org_id;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      created_by
    ) values (
      next_org_id,
      current_user_id,
      'account_owner',
      current_user_id
    );
  end if;

  if nullif(trim(input_invite_code), '') is not null then
    perform public.redeem_invite_code(input_invite_code);
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.redeem_invite_code(input_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  invite_record public.organization_invites%rowtype;
  next_member_count integer;
  target_user_limit integer;
begin
  if current_user_id is null then
    raise exception 'Authentication required.';
  end if;

  select *
  into invite_record
  from public.organization_invites
  where lower(code) = lower(trim(input_code))
    and is_disabled = false
    and (expires_at is null or expires_at > now())
    and redeemed_uses < max_uses
  order by created_at desc
  limit 1;

  if invite_record.id is null then
    raise exception 'Invite code is invalid or expired.';
  end if;

  if exists (
    select 1
    from public.organization_memberships
    where organization_id = invite_record.organization_id
      and user_id = current_user_id
  ) then
    return jsonb_build_object('ok', true, 'already_member', true, 'organization_id', invite_record.organization_id);
  end if;

  select count(*), max(o.user_limit)
  into next_member_count, target_user_limit
  from public.organization_memberships om
  join public.organizations o on o.id = invite_record.organization_id
  where om.organization_id = invite_record.organization_id;

  if coalesce(next_member_count, 0) >= coalesce(target_user_limit, 0) then
    raise exception 'This library has reached its user limit.';
  end if;

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    created_by
  ) values (
    invite_record.organization_id,
    current_user_id,
    invite_record.role,
    invite_record.created_by
  );

  update public.organization_invites
  set redeemed_uses = redeemed_uses + 1
  where id = invite_record.id;

  return jsonb_build_object('ok', true, 'organization_id', invite_record.organization_id);
end;
$$;

create or replace function public.create_organization_invite(
  input_organization_id uuid,
  input_role text default 'viewer',
  input_max_uses integer default 1,
  input_expires_at timestamptz default null
)
returns table (
  id uuid,
  code text,
  role text,
  max_uses integer,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_members(input_organization_id) then
    raise exception 'Not allowed to manage invite codes for this library.';
  end if;

  if exists (
    select 1
    from public.organizations
    where id = input_organization_id
      and subscription_tier = 'free'
  ) then
    raise exception 'Invite codes are not available on the Free plan.';
  end if;

  return query
  insert into public.organization_invites (
    organization_id,
    code,
    role,
    max_uses,
    expires_at,
    created_by
  ) values (
    input_organization_id,
    upper(encode(gen_random_bytes(5), 'hex')),
    input_role,
    greatest(coalesce(input_max_uses, 1), 1),
    input_expires_at,
    auth.uid()
  )
  returning organization_invites.id, organization_invites.code, organization_invites.role, organization_invites.max_uses, organization_invites.expires_at;
end;
$$;

create or replace function public.update_membership_role(
  input_membership_id uuid,
  input_role text
)
returns public.organization_memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  membership_record public.organization_memberships%rowtype;
begin
  select *
  into membership_record
  from public.organization_memberships
  where id = input_membership_id;

  if membership_record.id is null then
    raise exception 'Membership not found.';
  end if;

  if not public.can_manage_members(membership_record.organization_id) then
    raise exception 'Not allowed to update this membership.';
  end if;

  if membership_record.user_id = (
    select owner_user_id
    from public.organizations
    where id = membership_record.organization_id
  ) and input_role <> 'account_owner' then
    raise exception 'Transfer ownership before changing the owner role.';
  end if;

  update public.organization_memberships
  set role = input_role,
      updated_at = now()
  where id = input_membership_id
  returning * into membership_record;

  return membership_record;
end;
$$;

create or replace function public.platform_set_organization_owner(
  input_organization_id uuid,
  input_user_id uuid
)
returns public.organizations
language plpgsql
security definer
set search_path = public
as $$
declare
  org_record public.organizations%rowtype;
  previous_owner uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'Platform admin access required.';
  end if;

  select * into org_record
  from public.organizations
  where id = input_organization_id;

  if org_record.id is null then
    raise exception 'Organization not found.';
  end if;

  previous_owner := org_record.owner_user_id;

  insert into public.organization_memberships (organization_id, user_id, role, created_by)
  values (input_organization_id, input_user_id, 'account_owner', auth.uid())
  on conflict (organization_id, user_id) do update
    set role = 'account_owner',
        updated_at = now();

  update public.organization_memberships
  set role = 'account_admin',
      updated_at = now()
  where organization_id = input_organization_id
    and user_id = previous_owner
    and previous_owner <> input_user_id;

  update public.organizations
  set owner_user_id = input_user_id,
      updated_at = now()
  where id = input_organization_id
  returning * into org_record;

  return org_record;
end;
$$;

create or replace function public.protect_organization_billing_fields()
returns trigger
language plpgsql
as $$
begin
  if auth.role() = 'service_role' then
    return new;
  end if;

  if not public.can_manage_billing(old.id) then
    if new.subscription_tier is distinct from old.subscription_tier
      or new.account_status is distinct from old.account_status
      or new.document_limit is distinct from old.document_limit
      or new.storage_limit_mb is distinct from old.storage_limit_mb
      or new.user_limit is distinct from old.user_limit
      or new.stripe_customer_id is distinct from old.stripe_customer_id
      or new.stripe_subscription_id is distinct from old.stripe_subscription_id
      or new.stripe_price_id is distinct from old.stripe_price_id
      or new.subscription_current_period_end is distinct from old.subscription_current_period_end then
      raise exception 'Billing fields require account owner or platform admin access.';
    end if;
  end if;

  if not public.can_manage_org_settings(old.id) then
    if new.name is distinct from old.name
      or new.slug is distinct from old.slug
      or new.public_embed_enabled is distinct from old.public_embed_enabled
      or new.public_embed_token is distinct from old.public_embed_token
      or new.transcript_preview_enabled is distinct from old.transcript_preview_enabled
      or new.keyword_search_enabled is distinct from old.keyword_search_enabled
      or new.file_preview_cards_enabled is distinct from old.file_preview_cards_enabled
      or new.hosted_public_portal_enabled is distinct from old.hosted_public_portal_enabled
      or new.branded_primary_color is distinct from old.branded_primary_color
      or new.branded_accent_color is distinct from old.branded_accent_color then
      raise exception 'Library settings require admin access.';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute procedure public.set_updated_at();

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute procedure public.set_updated_at();

drop trigger if exists organization_memberships_set_updated_at on public.organization_memberships;
create trigger organization_memberships_set_updated_at
before update on public.organization_memberships
for each row execute procedure public.set_updated_at();

drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
before update on public.documents
for each row execute procedure public.set_updated_at();

drop trigger if exists organizations_protect_billing_fields on public.organizations;
create trigger organizations_protect_billing_fields
before update on public.organizations
for each row execute procedure public.protect_organization_billing_fields();

alter table public.profiles enable row level security;
alter table public.platform_admins enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_memberships enable row level security;
alter table public.organization_invites enable row level security;
alter table public.documents enable row level security;

drop policy if exists "profiles_select_policy" on public.profiles;
create policy "profiles_select_policy"
on public.profiles
for select
using (auth.uid() = id or public.is_platform_admin());

drop policy if exists "profiles_update_policy" on public.profiles;
create policy "profiles_update_policy"
on public.profiles
for update
using (auth.uid() = id or public.is_platform_admin())
with check (auth.uid() = id or public.is_platform_admin());

drop policy if exists "platform_admins_select_policy" on public.platform_admins;
create policy "platform_admins_select_policy"
on public.platform_admins
for select
using (public.is_platform_admin());

drop policy if exists "organizations_select_policy" on public.organizations;
create policy "organizations_select_policy"
on public.organizations
for select
using (public.can_view_organization(id));

drop policy if exists "organizations_insert_policy" on public.organizations;
create policy "organizations_insert_policy"
on public.organizations
for insert
with check (auth.uid() = owner_user_id or public.is_platform_admin());

drop policy if exists "organizations_update_policy" on public.organizations;
create policy "organizations_update_policy"
on public.organizations
for update
using (public.can_manage_org_settings(id) or public.can_manage_billing(id))
with check (public.can_manage_org_settings(id) or public.can_manage_billing(id));

drop policy if exists "organization_memberships_select_policy" on public.organization_memberships;
create policy "organization_memberships_select_policy"
on public.organization_memberships
for select
using (public.can_view_organization(organization_id));

drop policy if exists "organization_memberships_insert_policy" on public.organization_memberships;
create policy "organization_memberships_insert_policy"
on public.organization_memberships
for insert
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_memberships_update_policy" on public.organization_memberships;
create policy "organization_memberships_update_policy"
on public.organization_memberships
for update
using (public.can_manage_members(organization_id))
with check (public.can_manage_members(organization_id));

drop policy if exists "organization_invites_select_policy" on public.organization_invites;
create policy "organization_invites_select_policy"
on public.organization_invites
for select
using (public.can_manage_members(organization_id));

drop policy if exists "organization_invites_manage_policy" on public.organization_invites;
create policy "organization_invites_manage_policy"
on public.organization_invites
for all
using (public.can_manage_members(organization_id))
with check (public.can_manage_members(organization_id));

drop policy if exists "documents_select_policy" on public.documents;
create policy "documents_select_policy"
on public.documents
for select
using (
  public.can_view_organization(organization_id)
  or (
    is_public = true
    and exists (
      select 1
      from public.organizations o
      where o.id = organization_id
        and o.public_embed_enabled = true
    )
  )
);

drop policy if exists "documents_insert_policy" on public.documents;
create policy "documents_insert_policy"
on public.documents
for insert
with check (
  public.can_manage_documents(organization_id)
  and uploaded_by_user_id = auth.uid()
);

drop policy if exists "documents_update_policy" on public.documents;
create policy "documents_update_policy"
on public.documents
for update
using (public.can_manage_documents(organization_id))
with check (public.can_manage_documents(organization_id));

drop policy if exists "documents_delete_policy" on public.documents;
create policy "documents_delete_policy"
on public.documents
for delete
using (public.can_manage_documents(organization_id));

insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

drop policy if exists "storage_select_documents_policy" on storage.objects;
create policy "storage_select_documents_policy"
on storage.objects
for select
using (
  bucket_id = 'documents'
  and (
    public.can_view_organization(public.storage_object_org_id(name))
    or exists (
      select 1
      from public.documents d
      join public.organizations o on o.id = d.organization_id
      where d.storage_path = name
        and d.is_public = true
        and o.public_embed_enabled = true
    )
  )
);

drop policy if exists "storage_insert_documents_policy" on storage.objects;
create policy "storage_insert_documents_policy"
on storage.objects
for insert
with check (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
);

drop policy if exists "storage_update_documents_policy" on storage.objects;
create policy "storage_update_documents_policy"
on storage.objects
for update
using (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
)
with check (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
);

drop policy if exists "storage_delete_documents_policy" on storage.objects;
create policy "storage_delete_documents_policy"
on storage.objects
for delete
using (
  bucket_id = 'documents'
  and public.can_manage_documents(public.storage_object_org_id(name))
);
