-- Table privileges permit the operation; RLS restricts it to platform admins.
grant insert, update on public.loan_accounts to authenticated;
