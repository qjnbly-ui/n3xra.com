create table public.contact_card_entitlements (
  owner_user_id uuid primary key references auth.users(id) on delete cascade,
  base_access boolean not null default false,
  branding_removal boolean not null default false,
  stripe_customer_id text,
  base_purchased_at timestamptz,
  branding_purchased_at timestamptz,
  source text not null default 'stripe' check (source in ('stripe', 'legacy', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.contact_card_orders (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid not null references public.contact_card_profiles(id) on delete cascade,
  order_type text not null check (order_type in ('base', 'branding_removal', 'additional_card', 'three_pack')),
  quantity integer not null check (quantity in (0, 1, 3)),
  amount_cents integer not null check (amount_cents in (799, 999, 1999)),
  status text not null default 'pending' check (status in ('pending', 'paid', 'expired', 'refunded')),
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contact_card_orders_owner_created_idx
on public.contact_card_orders (owner_user_id, created_at desc);

drop trigger if exists contact_card_entitlements_set_updated_at on public.contact_card_entitlements;
create trigger contact_card_entitlements_set_updated_at
before update on public.contact_card_entitlements
for each row execute function public.set_updated_at();

drop trigger if exists contact_card_orders_set_updated_at on public.contact_card_orders;
create trigger contact_card_orders_set_updated_at
before update on public.contact_card_orders
for each row execute function public.set_updated_at();

alter table public.contact_card_entitlements enable row level security;
alter table public.contact_card_orders enable row level security;

create policy "contact_card_entitlements_owner_select"
on public.contact_card_entitlements for select to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

create policy "contact_card_orders_owner_select"
on public.contact_card_orders for select to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

revoke all on table public.contact_card_entitlements from public, anon, authenticated;
revoke all on table public.contact_card_orders from public, anon, authenticated;
grant select on table public.contact_card_entitlements to authenticated;
grant select on table public.contact_card_orders to authenticated;
grant all on table public.contact_card_entitlements to service_role;
grant all on table public.contact_card_orders to service_role;

insert into public.contact_card_entitlements (
  owner_user_id,
  base_access,
  branding_removal,
  base_purchased_at,
  branding_purchased_at,
  source
)
select
  owner_user_id,
  true,
  not show_n3xra_branding,
  created_at,
  case when show_n3xra_branding is false then created_at end,
  'legacy'
from public.contact_card_profiles
on conflict (owner_user_id) do nothing;

create or replace function public.guard_contact_card_commerce()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  entitled boolean := false;
  branding_entitled boolean := false;
begin
  if coalesce((select public.is_platform_admin()), false) then
    return new;
  end if;

  select base_access, branding_removal
    into entitled, branding_entitled
  from public.contact_card_entitlements
  where owner_user_id = new.owner_user_id;

  if tg_op = 'INSERT' and not coalesce(entitled, false) then
    if new.status <> 'draft' or new.show_n3xra_branding is false or new.physical_card_status <> 'not_requested' then
      raise exception 'Complete Contact Card checkout before publishing.' using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and new.status = 'published' and not coalesce(entitled, false) then
    raise exception 'Complete Contact Card checkout before publishing.' using errcode = '42501';
  end if;

  if new.show_n3xra_branding is false and not coalesce(branding_entitled, false) then
    raise exception 'Purchase the branding removal upgrade before hiding N3XRA branding.' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists contact_card_profiles_guard_commerce on public.contact_card_profiles;
create trigger contact_card_profiles_guard_commerce
before insert or update on public.contact_card_profiles
for each row execute function public.guard_contact_card_commerce();

revoke all on function public.guard_contact_card_commerce() from public, anon, authenticated;

create or replace function public.grant_admin_contact_card_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce((select public.is_platform_admin()), false) then
    insert into public.contact_card_entitlements (
      owner_user_id,
      base_access,
      branding_removal,
      base_purchased_at,
      branding_purchased_at,
      source
    ) values (
      new.owner_user_id,
      true,
      new.show_n3xra_branding is false,
      now(),
      case when new.show_n3xra_branding is false then now() end,
      'admin'
    )
    on conflict (owner_user_id) do update
      set base_access = true,
          branding_removal = public.contact_card_entitlements.branding_removal or excluded.branding_removal,
          branding_purchased_at = coalesce(public.contact_card_entitlements.branding_purchased_at, excluded.branding_purchased_at),
          source = case when public.contact_card_entitlements.source = 'stripe' then 'stripe' else 'admin' end;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_card_profiles_grant_admin_access on public.contact_card_profiles;
create trigger contact_card_profiles_grant_admin_access
after insert or update of show_n3xra_branding on public.contact_card_profiles
for each row execute function public.grant_admin_contact_card_access();

revoke all on function public.grant_admin_contact_card_access() from public, anon, authenticated;

create or replace function private.capture_contact_card_order_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  profile public.contact_card_profiles;
begin
  if new.status = 'paid'
    and old.status is distinct from 'paid'
    and new.order_type in ('additional_card', 'three_pack') then
    select * into profile from public.contact_card_profiles where id = new.profile_id;
    insert into public.admin_notifications (
      event_type, product, priority, title, summary, actor_name, actor_email,
      source_table, source_id, action_url, metadata
    ) values (
      'contact_cards.additional_cards.paid',
      'contact_cards',
      'important',
      case when new.quantity = 3 then 'Three additional Contact Cards purchased' else 'Additional Contact Card purchased' end,
      left(concat_ws(' · ', nullif(profile.display_name, ''), new.quantity::text || ' card' || case when new.quantity = 1 then '' else 's' end), 2000),
      nullif(profile.display_name, ''),
      profile.email,
      'contact_card_orders',
      new.id::text,
      '/n3xra-admin/contact-cards/?card=' || new.profile_id::text,
      jsonb_build_object('order_id', new.id, 'card_id', new.profile_id, 'quantity', new.quantity, 'amount_cents', new.amount_cents)
    );
  end if;
  return new;
end;
$$;

revoke all on function private.capture_contact_card_order_notification() from public, anon, authenticated;

drop trigger if exists capture_contact_card_order_notification on public.contact_card_orders;
create trigger capture_contact_card_order_notification
after update of status on public.contact_card_orders
for each row execute function private.capture_contact_card_order_notification();
