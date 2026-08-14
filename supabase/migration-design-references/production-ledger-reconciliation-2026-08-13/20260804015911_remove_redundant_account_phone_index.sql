-- The unique phone constraint already supplies the lookup index.
drop index if exists public.account_phone_credentials_phone_idx;
