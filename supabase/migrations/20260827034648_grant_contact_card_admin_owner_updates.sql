-- Administrators manage card ownership from the browser. The customer-update
-- trigger still rejects owner changes for every non-platform administrator.
grant update (owner_user_id)
on table public.contact_card_profiles to authenticated;
