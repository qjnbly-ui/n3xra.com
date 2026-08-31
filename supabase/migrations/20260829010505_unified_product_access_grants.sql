create table public.product_access_grants (
  id uuid primary key default gen_random_uuid(),
  product_key text not null,
  access_level text not null default 'premium',
  subject_user_id uuid references auth.users(id) on delete cascade,
  subject_organization_id uuid references public.organizations(id) on delete cascade,
  status text not null default 'active'
    check (status in ('active', 'paused', 'revoked')),
  source text not null default 'admin'
    check (source in ('admin', 'promotion', 'legacy')),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  lifetime boolean not null default false,
  note text not null default '',
  granted_by_user_id uuid not null references auth.users(id),
  revoked_by_user_id uuid references auth.users(id),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_access_grants_subject_check check (
    (subject_user_id is not null and subject_organization_id is null)
    or (subject_user_id is null and subject_organization_id is not null)
  ),
  constraint product_access_grants_key_check check (product_key ~ '^[a-z0-9_]{2,80}$'),
  constraint product_access_grants_level_check check (access_level ~ '^[a-z0-9_]{2,80}$'),
  constraint product_access_grants_term_check check (
    (lifetime is true and ends_at is null)
    or (lifetime is false and ends_at is not null and ends_at > starts_at)
  ),
  constraint product_access_grants_note_check check (length(note) <= 1000),
  constraint product_access_grants_metadata_check check (jsonb_typeof(metadata) = 'object'),
  constraint product_access_grants_revoke_check check (
    (status <> 'revoked' and revoked_at is null and revoked_by_user_id is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by_user_id is not null)
  )
);

create index product_access_grants_user_lookup_idx
on public.product_access_grants (subject_user_id, product_key, access_level, created_at desc)
where subject_user_id is not null;

create index product_access_grants_organization_lookup_idx
on public.product_access_grants (subject_organization_id, product_key, access_level, created_at desc)
where subject_organization_id is not null;

create table public.product_access_grant_events (
  id uuid primary key default gen_random_uuid(),
  grant_id uuid not null references public.product_access_grants(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id),
  action text not null check (action in ('granted', 'extended', 'paused', 'restored', 'revoked')),
  before_state jsonb,
  after_state jsonb,
  note text not null default '',
  created_at timestamptz not null default now(),
  constraint product_access_grant_events_before_check check (before_state is null or jsonb_typeof(before_state) = 'object'),
  constraint product_access_grant_events_after_check check (after_state is null or jsonb_typeof(after_state) = 'object'),
  constraint product_access_grant_events_note_check check (length(note) <= 1000)
);

create index product_access_grant_events_grant_created_idx
on public.product_access_grant_events (grant_id, created_at desc);

create trigger product_access_grants_set_updated_at
before update on public.product_access_grants
for each row execute function public.set_updated_at();

create or replace function private.prevent_product_access_event_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception 'Product access history is immutable.' using errcode = '42501';
end;
$$;

create trigger product_access_grant_events_immutable
before update or delete on public.product_access_grant_events
for each row execute function private.prevent_product_access_event_changes();

create trigger product_access_grant_events_immutable_truncate
before truncate on public.product_access_grant_events
for each statement execute function private.prevent_product_access_event_changes();

alter table public.product_access_grants enable row level security;
alter table public.product_access_grant_events enable row level security;

revoke all on table public.product_access_grants from public, anon, authenticated;
revoke all on table public.product_access_grant_events from public, anon, authenticated;
grant select on table public.product_access_grants to authenticated;
grant select on table public.product_access_grant_events to authenticated;
grant all on table public.product_access_grants to service_role;
grant select, insert on table public.product_access_grant_events to service_role;

create policy "product_access_grants_select_authorized"
on public.product_access_grants for select to authenticated
using (
  (select public.is_platform_admin())
  or subject_user_id = (select auth.uid())
  or exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = subject_organization_id
      and membership.user_id = (select auth.uid())
  )
);

create policy "product_access_grant_events_select_authorized"
on public.product_access_grant_events for select to authenticated
using (
  (select public.is_platform_admin())
);

create or replace function public.guard_contact_card_commerce()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  is_admin boolean := false;
  entitled boolean := false;
  branding_entitled boolean := false;
begin
  is_admin := coalesce((select public.is_platform_admin()), false);

  select base_access, premium_active
    into entitled, branding_entitled
  from public.contact_card_entitlements
  where owner_user_id = new.owner_user_id;

  if not is_admin then
    if tg_op = 'INSERT' and not coalesce(entitled, false) then
      if new.status <> 'draft' or new.show_n3xra_branding is false or new.physical_card_status <> 'not_requested' then
        raise exception 'Complete Contact Card checkout before publishing.' using errcode = '42501';
      end if;
    elsif tg_op = 'UPDATE' and new.status = 'published' and not coalesce(entitled, false) then
      raise exception 'Complete Contact Card checkout before publishing.' using errcode = '42501';
    end if;
  end if;

  -- Branding removal is a paid entitlement even when an administrator grants
  -- complimentary Premium tools. This check intentionally applies to admins.
  if new.show_n3xra_branding is false and not coalesce(branding_entitled, false) then
    raise exception 'Paid Contact Card Premium is required before hiding N3XRA branding.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_contact_card_commerce() from public, anon, authenticated;

create or replace function public.guard_contact_card_connection_premium()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce((select public.is_platform_admin()), false) then
    return new;
  end if;

  if not exists (
    select 1
    from public.contact_card_entitlements entitlement
    where entitlement.owner_user_id = new.owner_user_id
      and (
        entitlement.premium_active is true
        or entitlement.premium_trial_ends_at > now()
      )
  ) and not exists (
    select 1
    from public.product_access_grants access_grant
    where access_grant.subject_user_id = new.owner_user_id
      and access_grant.product_key = 'contact_cards'
      and access_grant.access_level = 'premium'
      and access_grant.status = 'active'
      and access_grant.starts_at <= now()
      and (access_grant.lifetime or access_grant.ends_at > now())
  ) then
    raise exception 'Contact Card Premium is required to save contacts.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_contact_card_connection_premium() from public, anon, authenticated;

comment on table public.product_access_grants is
  'Reusable non-Stripe product access grants. Paid subscriptions remain authoritative in their product billing tables.';
comment on column public.product_access_grants.source is
  'Administrative access source only. Stripe subscriptions are intentionally not represented as manual grants.';
comment on table public.product_access_grant_events is
  'Immutable administrator history for product access changes.';
;
