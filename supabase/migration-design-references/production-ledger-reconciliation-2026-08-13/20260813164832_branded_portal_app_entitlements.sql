create table public.n3xra_product_catalog (
  product_key text primary key,
  name text not null,
  description text not null,
  portal_path text not null,
  icon_key text not null default 'app',
  client_portal_available boolean not null default false,
  status text not null default 'active',
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint n3xra_product_catalog_key_check
    check (product_key ~ '^[a-z][a-z0-9_]{1,49}$'),
  constraint n3xra_product_catalog_path_check
    check (portal_path ~ '^/[^/]' and portal_path !~ '[[:space:]]'),
  constraint n3xra_product_catalog_icon_check
    check (icon_key ~ '^[a-z][a-z0-9_-]{1,49}$'),
  constraint n3xra_product_catalog_status_check
    check (status in ('active', 'preview', 'retired')),
  constraint n3xra_product_catalog_sort_check
    check (sort_order between 0 and 10000)
);

create table public.organization_product_entitlements (
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_key text not null references public.n3xra_product_catalog (product_key) on delete restrict,
  status text not null default 'active',
  portal_enabled boolean not null default true,
  source text not null default 'subscription',
  external_reference text,
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, product_key),
  constraint organization_product_entitlements_status_check
    check (status in ('trialing', 'active', 'past_due', 'paused', 'canceled')),
  constraint organization_product_entitlements_source_check
    check (source in ('subscription', 'included', 'manual', 'legacy')),
  constraint organization_product_entitlements_metadata_check
    check (jsonb_typeof(metadata) = 'object'),
  constraint organization_product_entitlements_dates_check
    check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index organization_product_entitlements_portal_idx
on public.organization_product_entitlements (organization_id, portal_enabled, status, product_key);

drop trigger if exists n3xra_product_catalog_set_updated_at on public.n3xra_product_catalog;
create trigger n3xra_product_catalog_set_updated_at
before update on public.n3xra_product_catalog
for each row execute function public.set_updated_at();

drop trigger if exists organization_product_entitlements_set_updated_at on public.organization_product_entitlements;
create trigger organization_product_entitlements_set_updated_at
before update on public.organization_product_entitlements
for each row execute function public.set_updated_at();

alter table public.n3xra_product_catalog enable row level security;
alter table public.organization_product_entitlements enable row level security;

revoke all on public.n3xra_product_catalog from anon, authenticated;
revoke all on public.organization_product_entitlements from anon, authenticated;
grant select on public.n3xra_product_catalog to authenticated;
grant select on public.organization_product_entitlements to authenticated;
grant all on public.n3xra_product_catalog to service_role;
grant all on public.organization_product_entitlements to service_role;

drop policy if exists "n3xra_product_catalog_client_select" on public.n3xra_product_catalog;
create policy "n3xra_product_catalog_client_select"
on public.n3xra_product_catalog
for select
to authenticated
using (
  (client_portal_available and status = 'active')
  or (select public.is_platform_admin())
);

drop policy if exists "n3xra_product_catalog_admin_insert" on public.n3xra_product_catalog;
create policy "n3xra_product_catalog_admin_insert"
on public.n3xra_product_catalog
for insert
to authenticated
with check ((select public.is_platform_admin()));

drop policy if exists "n3xra_product_catalog_admin_update" on public.n3xra_product_catalog;
create policy "n3xra_product_catalog_admin_update"
on public.n3xra_product_catalog
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

drop policy if exists "n3xra_product_catalog_admin_delete" on public.n3xra_product_catalog;
create policy "n3xra_product_catalog_admin_delete"
on public.n3xra_product_catalog
for delete
to authenticated
using ((select public.is_platform_admin()));

drop policy if exists "organization_product_entitlements_member_select" on public.organization_product_entitlements;
create policy "organization_product_entitlements_member_select"
on public.organization_product_entitlements
for select
to authenticated
using (
  exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = organization_product_entitlements.organization_id
      and membership.user_id = (select auth.uid())
  )
  or (select public.is_platform_admin())
);

drop policy if exists "organization_product_entitlements_admin_insert" on public.organization_product_entitlements;
create policy "organization_product_entitlements_admin_insert"
on public.organization_product_entitlements
for insert
to authenticated
with check ((select public.is_platform_admin()));

drop policy if exists "organization_product_entitlements_admin_update" on public.organization_product_entitlements;
create policy "organization_product_entitlements_admin_update"
on public.organization_product_entitlements
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

drop policy if exists "organization_product_entitlements_admin_delete" on public.organization_product_entitlements;
create policy "organization_product_entitlements_admin_delete"
on public.organization_product_entitlements
for delete
to authenticated
using ((select public.is_platform_admin()));

insert into public.n3xra_product_catalog (
  product_key,
  name,
  description,
  portal_path,
  icon_key,
  client_portal_available,
  status,
  sort_order
)
values (
  'records',
  'Records',
  'Manage business records, files, documents, and meeting notes.',
  '/n3xra-records/library',
  'records',
  true,
  'active',
  20
)
on conflict (product_key) do update
set name = excluded.name,
    description = excluded.description,
    portal_path = excluded.portal_path,
    icon_key = excluded.icon_key,
    client_portal_available = excluded.client_portal_available,
    status = excluded.status,
    sort_order = excluded.sort_order,
    updated_at = now();

insert into public.organization_product_entitlements (
  organization_id,
  product_key,
  status,
  portal_enabled,
  source
)
select
  organization.id,
  'records',
  case
    when organization.account_status = 'trialing' then 'trialing'
    when organization.account_status = 'past_due' then 'past_due'
    when organization.account_status = 'suspended' then 'paused'
    when organization.account_status = 'canceled' then 'canceled'
    else 'active'
  end,
  organization.account_status not in ('canceled', 'suspended'),
  'legacy'
from public.organizations organization
on conflict (organization_id, product_key) do nothing;

create or replace function private.sync_records_product_entitlement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  insert into public.organization_product_entitlements (
    organization_id,
    product_key,
    status,
    portal_enabled,
    source
  )
  values (
    new.id,
    'records',
    case
      when new.account_status = 'trialing' then 'trialing'
      when new.account_status = 'past_due' then 'past_due'
      when new.account_status = 'suspended' then 'paused'
      when new.account_status = 'canceled' then 'canceled'
      else 'active'
    end,
    new.account_status not in ('canceled', 'suspended'),
    'subscription'
  )
  on conflict (organization_id, product_key) do update
  set status = excluded.status,
      portal_enabled = excluded.portal_enabled,
      updated_at = now()
  where organization_product_entitlements.source in ('subscription', 'legacy');

  return new;
end;
$$;

revoke all on function private.sync_records_product_entitlement() from public, anon, authenticated;

drop trigger if exists organizations_sync_records_product_entitlement on public.organizations;
create trigger organizations_sync_records_product_entitlement
after insert or update of account_status on public.organizations
for each row execute function private.sync_records_product_entitlement();

with organization_candidates as (
  select
    website.id as website_id,
    min(membership.organization_id::text)::uuid as organization_id
  from public.client_websites website
  join public.website_members website_member
    on website_member.website_id = website.id
   and website_member.role = 'owner'
   and website_member.status = 'active'
  join public.organization_memberships membership
    on membership.user_id = website_member.user_id
  where website.organization_id is null
  group by website.id
  having count(distinct membership.organization_id) = 1
)
update public.client_websites website
set organization_id = candidate.organization_id,
    updated_at = now()
from organization_candidates candidate
where website.id = candidate.website_id
  and website.organization_id is null;

create or replace function private.link_owned_websites_to_single_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_user_id uuid;
  target_organization_id uuid;
begin
  target_user_id := case
    when tg_table_name = 'organization_memberships' then new.user_id
    else new.user_id
  end;

  select min(membership.organization_id::text)::uuid
  into target_organization_id
  from public.organization_memberships membership
  where membership.user_id = target_user_id
  having count(distinct membership.organization_id) = 1;

  if target_organization_id is null then
    return new;
  end if;

  update public.client_websites website
  set organization_id = target_organization_id,
      updated_at = now()
  where website.organization_id is null
    and exists (
      select 1
      from public.website_members website_member
      where website_member.website_id = website.id
        and website_member.user_id = target_user_id
        and website_member.role = 'owner'
        and website_member.status = 'active'
    );

  return new;
end;
$$;

revoke all on function private.link_owned_websites_to_single_organization() from public, anon, authenticated;

drop trigger if exists organization_memberships_link_owned_websites on public.organization_memberships;
create trigger organization_memberships_link_owned_websites
after insert or update of organization_id, user_id on public.organization_memberships
for each row execute function private.link_owned_websites_to_single_organization();

drop trigger if exists website_members_link_single_organization on public.website_members;
create trigger website_members_link_single_organization
after insert or update of user_id, role, status on public.website_members
for each row
when (new.role = 'owner' and new.status = 'active')
execute function private.link_owned_websites_to_single_organization();
