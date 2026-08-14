revoke all on public.loan_accounts from authenticated;
revoke all on public.loan_payments from authenticated;

grant select, insert, update on public.loan_accounts to authenticated;
grant select, insert, update on public.loan_payments to authenticated;
