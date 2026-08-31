create index contact_card_profiles_created_by_user_idx
  on public.contact_card_profiles (created_by_user_id);

create index contact_card_profiles_updated_by_user_idx
  on public.contact_card_profiles (updated_by_user_id);;
