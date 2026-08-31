create or replace function private.capture_contact_card_request_admin_notification()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.physical_card_status = 'requested'
    and old.physical_card_status is distinct from 'requested' then
    insert into public.admin_notifications (
      event_type,
      product,
      priority,
      title,
      summary,
      actor_name,
      actor_email,
      source_table,
      source_id,
      action_url,
      metadata
    ) values (
      'contact_cards.physical_card.requested',
      'contact_cards',
      'important',
      'Physical Contact Card requested',
      left(concat_ws(
        ' · ',
        nullif(new.display_name, ''),
        nullif(new.company_name, ''),
        nullif(new.shipping_city, ''),
        nullif(new.shipping_region, '')
      ), 2000),
      nullif(new.display_name, ''),
      new.email,
      'contact_card_profiles',
      new.id::text,
      '/n3xra-admin/contact-cards/?card=' || new.id::text,
      jsonb_build_object(
        'operation', 'UPDATE',
        'card_id', new.id,
        'slug', new.slug,
        'physical_card_status', new.physical_card_status
      )
    );
  end if;

  return new;
end;
$$;

revoke all on function private.capture_contact_card_request_admin_notification()
from public, anon, authenticated;

drop trigger if exists capture_contact_card_request_admin_notification
on public.contact_card_profiles;

create trigger capture_contact_card_request_admin_notification
after update of physical_card_status on public.contact_card_profiles
for each row execute function private.capture_contact_card_request_admin_notification();
;
