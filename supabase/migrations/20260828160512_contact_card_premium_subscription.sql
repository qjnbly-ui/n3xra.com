alter table public.contact_card_entitlements
  add column premium_active boolean not null default false,
  add column premium_status text not null default 'inactive'
    check (premium_status in ('inactive', 'incomplete', 'incomplete_expired', 'trialing', 'active', 'past_due', 'paused', 'unpaid', 'canceled')),
  add column premium_plan text
    check (premium_plan is null or premium_plan in ('monthly', 'yearly')),
  add column stripe_subscription_id text,
  add column stripe_price_id text,
  add column premium_current_period_end timestamptz,
  add column premium_cancel_at_period_end boolean not null default false,
  add column premium_started_at timestamptz,
  add column premium_prompt_dismissed_at timestamptz;

create unique index contact_card_entitlements_subscription_idx
on public.contact_card_entitlements (stripe_subscription_id)
where stripe_subscription_id is not null;

grant update (premium_prompt_dismissed_at)
on table public.contact_card_entitlements to authenticated;

create policy "contact_card_entitlements_owner_prompt_update"
on public.contact_card_entitlements for update to authenticated
using ((select auth.uid()) = owner_user_id)
with check ((select auth.uid()) = owner_user_id);

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

  select base_access, (branding_removal or premium_active)
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
    raise exception 'Contact Card Premium is required before hiding N3XRA branding.' using errcode = '42501';
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
    from public.contact_card_entitlements
    where owner_user_id = new.owner_user_id
      and premium_active is true
  ) then
    raise exception 'Contact Card Premium is required to save contacts.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_contact_card_connection_premium() from public, anon, authenticated;

drop trigger if exists contact_card_connections_guard_premium on public.contact_card_connections;
create trigger contact_card_connections_guard_premium
before insert on public.contact_card_connections
for each row execute function public.guard_contact_card_connection_premium();
