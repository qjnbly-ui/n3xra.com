create table public.nex_sms_sessions (
 thread_id uuid primary key references public.admin_communication_threads(id) on delete cascade,
 phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
 token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
 challenge_expires_at timestamptz not null,
 requested_at timestamptz not null default now(),
 verified_user_id uuid references auth.users(id) on delete cascade,
 verified_until timestamptz,
 credential_version timestamptz,
 consumed_at timestamptz,
 constraint verified_state check ((verified_user_id is null and verified_until is null) or (verified_user_id is not null and verified_until is not null and consumed_at is not null and credential_version is not null))
);
alter table public.nex_sms_sessions enable row level security;
revoke all on public.nex_sms_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.nex_sms_sessions to service_role;
comment on table public.nex_sms_sessions is 'Server-only, expiring SMS verification. Authorizes account status only, never website edits or other account actions.';
