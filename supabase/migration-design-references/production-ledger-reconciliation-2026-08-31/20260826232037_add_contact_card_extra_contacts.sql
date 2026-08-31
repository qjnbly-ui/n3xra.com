alter table public.contact_card_profiles
  add column if not exists additional_emails text[] not null default '{}'::text[],
  add column if not exists additional_phones text[] not null default '{}'::text[];

alter table public.contact_card_profiles
  add constraint contact_card_profiles_additional_emails_limit_check
    check (cardinality(additional_emails) <= 5 and array_position(additional_emails, null) is null),
  add constraint contact_card_profiles_additional_phones_limit_check
    check (cardinality(additional_phones) <= 5 and array_position(additional_phones, null) is null);

grant update (additional_emails, additional_phones)
on table public.contact_card_profiles to authenticated;

comment on column public.contact_card_profiles.additional_emails is
  'Optional secondary public email addresses, limited to five.';
comment on column public.contact_card_profiles.additional_phones is
  'Optional secondary public E.164 phone numbers, limited to five.';
