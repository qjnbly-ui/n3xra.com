alter table public.contact_card_connections
  add column job_title text not null default '',
  add column website_url text,
  add column address_text text not null default '',
  add column additional_emails text[] not null default '{}',
  add column additional_phones text[] not null default '{}';

alter table public.contact_card_connections
  drop constraint contact_card_connections_source_check,
  add constraint contact_card_connections_source_check
    check (source in ('public_card', 'business_card_scan')),
  drop constraint contact_card_connections_contact_method_check,
  add constraint contact_card_connections_contact_method_check
    check (source = 'business_card_scan' or email is not null or phone_e164 is not null),
  add constraint contact_card_connections_job_title_check check (length(job_title) <= 180),
  add constraint contact_card_connections_website_check check (website_url is null or length(website_url) <= 500),
  add constraint contact_card_connections_address_check check (length(address_text) <= 500),
  add constraint contact_card_connections_additional_emails_check check (cardinality(additional_emails) <= 8),
  add constraint contact_card_connections_additional_phones_check check (cardinality(additional_phones) <= 8);

create or replace function public.guard_contact_card_connection_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_owner uuid;
begin
  if tg_op = 'INSERT' then
    select owner_user_id into expected_owner
    from public.contact_card_profiles
    where id = new.profile_id;

    if expected_owner is null or new.owner_user_id is distinct from expected_owner then
      raise exception 'Contact Card connection ownership is invalid.' using errcode = '23514';
    end if;
    return new;
  end if;

  if coalesce((select public.is_platform_admin()), false) is false then
    if new.profile_id is distinct from old.profile_id
      or new.owner_user_id is distinct from old.owner_user_id
      or new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.phone_e164 is distinct from old.phone_e164
      or new.company_name is distinct from old.company_name
      or new.message is distinct from old.message
      or new.source is distinct from old.source
      or new.privacy_notice_version is distinct from old.privacy_notice_version
      or new.submitted_at is distinct from old.submitted_at
      or new.job_title is distinct from old.job_title
      or new.website_url is distinct from old.website_url
      or new.address_text is distinct from old.address_text
      or new.additional_emails is distinct from old.additional_emails
      or new.additional_phones is distinct from old.additional_phones then
      raise exception 'Only connection status and private notes can be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create policy "contact_card_connections_owner_insert_scanned"
on public.contact_card_connections for insert to authenticated
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = owner_user_id
  and source = 'business_card_scan'
  and exists (
    select 1
    from public.contact_card_profiles profile
    where profile.id = profile_id
      and profile.owner_user_id = (select auth.uid())
  )
);

grant insert (
  profile_id,
  owner_user_id,
  name,
  email,
  phone_e164,
  company_name,
  message,
  source,
  privacy_notice_version,
  job_title,
  website_url,
  address_text,
  additional_emails,
  additional_phones
)
on table public.contact_card_connections
to authenticated;
