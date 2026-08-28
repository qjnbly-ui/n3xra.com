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

  select base_access, premium_active
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
    raise exception 'Paid Contact Card Premium is required before hiding N3XRA branding.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_contact_card_commerce() from public, anon, authenticated;

create or replace function public.default_contact_card_premium_features()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    new.premium_trial_started_at is not null
    and old.premium_trial_started_at is null
  ) or (
    new.premium_active is true
    and new.premium_started_at is not null
    and old.premium_started_at is null
  ) then
    update public.contact_card_profiles
    set show_n3xra_branding = true,
        exchange_enabled = true
    where owner_user_id = new.owner_user_id;
  end if;

  return new;
end;
$$;

revoke all on function public.default_contact_card_premium_features() from public, anon, authenticated;

drop trigger if exists contact_card_entitlements_default_premium_features on public.contact_card_entitlements;
create trigger contact_card_entitlements_default_premium_features
after update of premium_active, premium_trial_started_at, premium_started_at
on public.contact_card_entitlements
for each row execute function public.default_contact_card_premium_features();

update public.contact_card_profiles as profile
set show_n3xra_branding = true,
    exchange_enabled = true
from public.contact_card_entitlements as entitlement
where entitlement.owner_user_id = profile.owner_user_id
  and entitlement.premium_active is false
  and entitlement.premium_trial_ends_at > now();
