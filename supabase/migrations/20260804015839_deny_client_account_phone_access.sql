drop policy if exists account_phone_credentials_no_client_access
  on public.account_phone_credentials;

create policy account_phone_credentials_no_client_access
on public.account_phone_credentials
as restrictive
for all
to anon, authenticated
using (false)
with check (false);;
