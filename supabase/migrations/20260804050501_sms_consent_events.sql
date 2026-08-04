create table if not exists public.sms_consent_events (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null,
  user_id uuid references auth.users (id) on delete set null,
  event_type text not null,
  consent_method text not null,
  disclosure_version text not null,
  disclosure_text text not null,
  source_url text,
  call_sid text,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now(),
  constraint sms_consent_events_phone_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint sms_consent_events_type_check
    check (event_type in ('opt_in', 'opt_out')),
  constraint sms_consent_events_method_check
    check (consent_method in ('web_form', 'verbal', 'sms_keyword')),
  constraint sms_consent_events_call_sid_check
    check (call_sid is null or call_sid ~ '^CA[0-9A-Za-z]{32}$'),
  constraint sms_consent_events_ip_hash_check
    check (ip_hash is null or ip_hash ~ '^[0-9a-f]{64}$')
);

create index if not exists sms_consent_events_phone_created_idx
  on public.sms_consent_events (phone_e164, created_at desc);

create index if not exists sms_consent_events_user_created_idx
  on public.sms_consent_events (user_id, created_at desc)
  where user_id is not null;

alter table public.sms_consent_events enable row level security;

revoke all on table public.sms_consent_events from public, anon, authenticated;
grant select, insert on table public.sms_consent_events to service_role;

drop policy if exists sms_consent_events_no_client_access
  on public.sms_consent_events;

create policy sms_consent_events_no_client_access
on public.sms_consent_events
as restrictive
for all
to anon, authenticated
using (false)
with check (false);
