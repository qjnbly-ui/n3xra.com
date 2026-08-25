create table if not exists public.prospect_contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  job_title text not null default '',
  company_name text not null default '',
  email text,
  phone_e164 text,
  website_url text,
  address_text text not null default '',
  notes text not null default '',
  interest_tags text[] not null default '{}'::text[],
  source_label text not null default 'Business card',
  relationship_status text not null default 'new'
    check (relationship_status in ('new', 'contacted', 'qualified', 'nurturing', 'not_interested', 'converted')),
  email_marketing_status text not null default 'not_requested'
    check (email_marketing_status in ('not_requested', 'subscribed', 'unsubscribed', 'bounced')),
  sms_marketing_status text not null default 'not_requested'
    check (sms_marketing_status in ('not_requested', 'subscribed', 'unsubscribed')),
  email_consent_at timestamptz,
  sms_consent_at timestamptz,
  consent_notes text not null default '',
  card_image_bucket text not null default 'prospect-business-cards'
    check (card_image_bucket = 'prospect-business-cards'),
  card_image_path text,
  scan_provider text,
  scan_model text,
  scan_confidence numeric(4, 3) check (scan_confidence is null or scan_confidence between 0 and 1),
  scan_raw jsonb not null default '{}'::jsonb check (jsonb_typeof(scan_raw) = 'object'),
  scanned_at timestamptz,
  created_by_user_id uuid references auth.users(id) on delete set null,
  updated_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint prospect_contacts_email_format_check check (
    email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  constraint prospect_contacts_phone_format_check check (
    phone_e164 is null or phone_e164 ~ E'^\\+[1-9][0-9]{7,14}$'
  ),
  constraint prospect_contacts_identity_check check (
    btrim(full_name) <> '' or btrim(company_name) <> '' or email is not null or phone_e164 is not null
  ),
  constraint prospect_contacts_email_consent_check check (
    email_marketing_status <> 'subscribed' or (email is not null and email_consent_at is not null)
  ),
  constraint prospect_contacts_sms_consent_check check (
    sms_marketing_status <> 'subscribed' or (phone_e164 is not null and sms_consent_at is not null)
  ),
  constraint prospect_contacts_consent_notes_check check (
    (email_marketing_status <> 'subscribed' and sms_marketing_status <> 'subscribed')
    or btrim(consent_notes) <> ''
  )
);

create unique index if not exists prospect_contacts_email_unique_idx
  on public.prospect_contacts (lower(email))
  where email is not null;

create index if not exists prospect_contacts_phone_idx
  on public.prospect_contacts (phone_e164)
  where phone_e164 is not null;

create index if not exists prospect_contacts_recent_idx
  on public.prospect_contacts (created_at desc);

create index if not exists prospect_contacts_interest_tags_idx
  on public.prospect_contacts using gin (interest_tags);

create table if not exists public.prospect_consent_events (
  id uuid primary key default gen_random_uuid(),
  prospect_contact_id uuid not null references public.prospect_contacts(id) on delete cascade,
  channel text not null check (channel in ('email', 'sms')),
  previous_status text not null,
  next_status text not null,
  consent_notes text not null default '',
  changed_by_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists prospect_consent_events_contact_recent_idx
  on public.prospect_consent_events (prospect_contact_id, created_at desc);

drop trigger if exists prospect_contacts_set_updated_at on public.prospect_contacts;
create trigger prospect_contacts_set_updated_at
before update on public.prospect_contacts
for each row execute function public.set_updated_at();

create or replace function private.capture_prospect_consent_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.email_marketing_status is distinct from old.email_marketing_status then
    insert into public.prospect_consent_events (
      prospect_contact_id, channel, previous_status, next_status, consent_notes, changed_by_user_id
    ) values (
      new.id, 'email', old.email_marketing_status, new.email_marketing_status,
      new.consent_notes, auth.uid()
    );
  end if;

  if new.sms_marketing_status is distinct from old.sms_marketing_status then
    insert into public.prospect_consent_events (
      prospect_contact_id, channel, previous_status, next_status, consent_notes, changed_by_user_id
    ) values (
      new.id, 'sms', old.sms_marketing_status, new.sms_marketing_status,
      new.consent_notes, auth.uid()
    );
  end if;

  return new;
end;
$$;

revoke all on function private.capture_prospect_consent_change() from public, anon, authenticated;

drop trigger if exists prospect_contacts_capture_consent on public.prospect_contacts;
create trigger prospect_contacts_capture_consent
after update on public.prospect_contacts
for each row execute function private.capture_prospect_consent_change();

alter table public.prospect_contacts enable row level security;
alter table public.prospect_consent_events enable row level security;

drop policy if exists "prospect_contacts_admin_select" on public.prospect_contacts;
create policy "prospect_contacts_admin_select"
on public.prospect_contacts for select to authenticated
using ((select public.is_platform_admin()));

drop policy if exists "prospect_contacts_admin_insert" on public.prospect_contacts;
create policy "prospect_contacts_admin_insert"
on public.prospect_contacts for insert to authenticated
with check (
  (select public.is_platform_admin())
  and created_by_user_id = (select auth.uid())
  and updated_by_user_id = (select auth.uid())
);

drop policy if exists "prospect_contacts_admin_update" on public.prospect_contacts;
create policy "prospect_contacts_admin_update"
on public.prospect_contacts for update to authenticated
using ((select public.is_platform_admin()))
with check (
  (select public.is_platform_admin())
  and updated_by_user_id = (select auth.uid())
);

drop policy if exists "prospect_contacts_admin_delete" on public.prospect_contacts;
create policy "prospect_contacts_admin_delete"
on public.prospect_contacts for delete to authenticated
using ((select public.is_platform_admin()));

drop policy if exists "prospect_consent_events_admin_select" on public.prospect_consent_events;
create policy "prospect_consent_events_admin_select"
on public.prospect_consent_events for select to authenticated
using ((select public.is_platform_admin()));

revoke all on table public.prospect_contacts from public, anon, authenticated;
grant select, insert, update, delete on table public.prospect_contacts to authenticated;
grant all on table public.prospect_contacts to service_role;

revoke all on table public.prospect_consent_events from public, anon, authenticated;
grant select on table public.prospect_consent_events to authenticated;
grant all on table public.prospect_consent_events to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'prospect-business-cards',
  'prospect-business-cards',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "prospect_business_cards_admin_select" on storage.objects;
create policy "prospect_business_cards_admin_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'prospect-business-cards'
  and (select public.is_platform_admin())
);

drop policy if exists "prospect_business_cards_admin_insert" on storage.objects;
create policy "prospect_business_cards_admin_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'prospect-business-cards'
  and (select public.is_platform_admin())
);

drop policy if exists "prospect_business_cards_admin_update" on storage.objects;
create policy "prospect_business_cards_admin_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'prospect-business-cards'
  and (select public.is_platform_admin())
)
with check (
  bucket_id = 'prospect-business-cards'
  and (select public.is_platform_admin())
);

drop policy if exists "prospect_business_cards_admin_delete" on storage.objects;
create policy "prospect_business_cards_admin_delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'prospect-business-cards'
  and (select public.is_platform_admin())
);

comment on table public.prospect_contacts is
  'Shared N3XRA prospect directory. Prospect records never create or enroll auth accounts.';

comment on column public.prospect_contacts.email_marketing_status is
  'Email campaign eligibility. Business-card scanning leaves this not_requested until consent is recorded.';

comment on column public.prospect_contacts.sms_marketing_status is
  'SMS campaign eligibility. Text delivery requires subscribed status and a recorded consent timestamp.';
