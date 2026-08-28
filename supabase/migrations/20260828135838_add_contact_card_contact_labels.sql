alter table public.contact_card_profiles
  add column email_label text not null default 'Email',
  add column phone_label text not null default 'Phone',
  add column additional_email_labels text[] not null default '{}'::text[],
  add column additional_phone_labels text[] not null default '{}'::text[];

update public.contact_card_profiles
set
  additional_email_labels = case
    when cardinality(additional_emails) = 0 then '{}'::text[]
    else array_fill('Email'::text, array[cardinality(additional_emails)])
  end,
  additional_phone_labels = case
    when cardinality(additional_phones) = 0 then '{}'::text[]
    else array_fill('Phone'::text, array[cardinality(additional_phones)])
  end;

alter table public.contact_card_profiles
  add constraint contact_card_profiles_email_label_check
    check (length(btrim(email_label)) between 1 and 60),
  add constraint contact_card_profiles_phone_label_check
    check (length(btrim(phone_label)) between 1 and 60),
  add constraint contact_card_profiles_additional_email_labels_check
    check (
      cardinality(additional_email_labels) = cardinality(additional_emails)
      and array_position(additional_email_labels, null) is null
    ),
  add constraint contact_card_profiles_additional_phone_labels_check
    check (
      cardinality(additional_phone_labels) = cardinality(additional_phones)
      and array_position(additional_phone_labels, null) is null
    );

grant update (
  email_label,
  phone_label,
  additional_email_labels,
  additional_phone_labels
)
on table public.contact_card_profiles
to authenticated;

comment on column public.contact_card_profiles.email_label is
  'Public description for the primary email address, such as Work or Personal.';
comment on column public.contact_card_profiles.phone_label is
  'Public description for the primary phone number, such as Mobile or Office.';
comment on column public.contact_card_profiles.additional_email_labels is
  'Public descriptions aligned by index with additional_emails.';
comment on column public.contact_card_profiles.additional_phone_labels is
  'Public descriptions aligned by index with additional_phones.';
