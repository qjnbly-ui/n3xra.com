create index if not exists operations_parties_account_user_idx
on public.operations_parties(account_user_id)
where account_user_id is not null;

create index if not exists operations_parties_created_by_idx
on public.operations_parties(created_by_user_id);

create index if not exists operations_products_created_by_idx
on public.operations_products(created_by_user_id);

create index if not exists operations_projects_created_by_idx
on public.operations_projects(created_by_user_id);

create index if not exists operations_financial_accounts_created_by_idx
on public.operations_financial_accounts(created_by_user_id);

create index if not exists operations_invoices_created_by_idx
on public.operations_invoices(created_by_user_id);

create index if not exists operations_deposits_created_by_idx
on public.operations_deposits(created_by_user_id);

create index if not exists operations_transactions_voided_by_idx
on public.operations_transactions(voided_by_user_id)
where voided_by_user_id is not null;

create index if not exists operations_transactions_created_by_idx
on public.operations_transactions(created_by_user_id);
;
