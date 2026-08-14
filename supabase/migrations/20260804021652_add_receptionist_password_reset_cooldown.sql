alter table public.account_phone_credentials
  add column if not exists last_password_reset_sent_at timestamptz;;
