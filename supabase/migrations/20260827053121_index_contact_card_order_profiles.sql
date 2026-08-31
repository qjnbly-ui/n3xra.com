create index contact_card_orders_profile_created_idx
on public.contact_card_orders (profile_id, created_at desc);
;
