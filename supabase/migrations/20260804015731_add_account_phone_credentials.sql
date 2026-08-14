create table if not exists public.account_phone_credentials (
  user_id uuid primary key references auth.users (id) on delete cascade,
  phone_e164 text not null unique,
  pin_salt text not null,
  pin_hash text not null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_authenticated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint account_phone_credentials_phone_check
    check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  constraint account_phone_credentials_pin_salt_check
    check (char_length(pin_salt) between 16 and 256),
  constraint account_phone_credentials_pin_hash_check
    check (char_length(pin_hash) between 32 and 512),
  constraint account_phone_credentials_failed_attempts_check
    check (failed_attempts >= 0)
);

create index if not exists account_phone_credentials_phone_idx
  on public.account_phone_credentials (phone_e164);

drop trigger if exists account_phone_credentials_set_updated_at on public.account_phone_credentials;
create trigger account_phone_credentials_set_updated_at
before update on public.account_phone_credentials
for each row execute function public.set_updated_at();

alter table public.account_phone_credentials enable row level security;

revoke all on table public.account_phone_credentials from anon, authenticated;
grant select, insert, update, delete on table public.account_phone_credentials to service_role;;
