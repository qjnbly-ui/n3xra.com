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

    if new.physical_card_status is distinct from old.physical_card_status then
      if old.physical_card_status in ('processing', 'shipped', 'delivered') then
        raise exception 'This card request is already being fulfilled.';
      end if;
      if new.physical_card_status not in ('not_requested', 'requested') then
        raise exception 'Only N3XRA can update card fulfillment status.';
      end if;
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
$$;;
