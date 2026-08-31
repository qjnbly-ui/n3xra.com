alter table public.contact_card_profiles
  drop constraint contact_card_profiles_physical_card_status_check,
  drop constraint contact_card_profiles_shipping_check;

alter table public.contact_card_profiles
  add constraint contact_card_profiles_physical_card_status_check
  check (physical_card_status in ('not_requested', 'requested', 'processing', 'shipped', 'delivered'));

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
    if new.physical_card_status = 'requested'
      and (
        length(btrim(new.shipping_name)) < 1
        or length(btrim(new.shipping_address_line_1)) < 1
        or length(btrim(new.shipping_city)) < 1
        or length(btrim(new.shipping_region)) < 1
        or length(btrim(new.shipping_postal_code)) < 1
        or length(btrim(new.shipping_country)) < 1
      ) then
      raise exception 'Complete the mailing address before requesting a physical card.' using errcode = '23514';
    end if;
    new.updated_by_user_id = (select auth.uid());
    if old.physical_card_status in ('processing', 'shipped', 'delivered')
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

drop policy "contact_card_profiles_admin_insert" on public.contact_card_profiles;
create policy "contact_card_profiles_admin_insert"
on public.contact_card_profiles for insert to authenticated
with check (
  (select public.is_platform_admin())
  or (
    (select auth.uid()) = owner_user_id
    and (created_by_user_id is null or created_by_user_id = (select auth.uid()))
    and (updated_by_user_id is null or updated_by_user_id = (select auth.uid()))
    and physical_card_status = 'not_requested'
    and physical_card_requested_at is null
  )
);
