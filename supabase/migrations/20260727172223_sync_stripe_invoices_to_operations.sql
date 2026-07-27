alter table public.operations_parties
add constraint operations_parties_account_user_unique unique (account_user_id);

drop index public.operations_parties_account_user_idx;

alter table public.operations_invoices
add column source text not null default 'manual',
add column external_id text;

alter table public.operations_invoices
add constraint operations_invoices_source_check
check (source in ('manual', 'stripe')),
add constraint operations_invoices_external_source_check
check (
  (source = 'manual' and external_id is null)
  or (source = 'stripe' and length(btrim(external_id)) > 0)
),
add constraint operations_invoices_source_external_unique
unique (source, external_id);

alter table public.operations_transactions
add column source text not null default 'manual',
add column external_id text;

alter table public.operations_transactions
add constraint operations_transactions_source_check
check (source in ('manual', 'stripe')),
add constraint operations_transactions_external_source_check
check (
  (source = 'manual' and external_id is null)
  or (source = 'stripe' and length(btrim(external_id)) > 0)
),
add constraint operations_transactions_source_external_unique
unique (source, external_id);

comment on column public.operations_invoices.external_id is
'Provider object ID used to make external invoice synchronization idempotent.';

comment on column public.operations_transactions.external_id is
'Provider object ID used to make external transaction synchronization idempotent.';
