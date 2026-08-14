create table public.operations_parties (
  id uuid primary key default gen_random_uuid(),
  party_type text not null default 'customer',
  name text not null,
  email text,
  phone text,
  account_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'active',
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_parties_type_check check (party_type in ('customer', 'vendor', 'both')),
  constraint operations_parties_name_check check (length(btrim(name)) between 1 and 160),
  constraint operations_parties_status_check check (status in ('active', 'archived'))
);

create table public.operations_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product_code text,
  category text,
  status text not null default 'active',
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_products_name_check check (length(btrim(name)) between 1 and 160),
  constraint operations_products_code_check check (
    product_code is null or product_code ~ '^[a-z0-9][a-z0-9_-]{1,39}$'
  ),
  constraint operations_products_status_check check (status in ('active', 'archived'))
);

create unique index operations_products_code_unique_idx
on public.operations_products(lower(product_code))
where product_code is not null;

create table public.operations_projects (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.operations_parties(id) on delete restrict,
  product_id uuid references public.operations_products(id) on delete set null,
  name text not null,
  status text not null default 'planned',
  started_on date,
  completed_on date,
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_projects_name_check check (length(btrim(name)) between 1 and 200),
  constraint operations_projects_status_check check (
    status in ('planned', 'active', 'on_hold', 'completed', 'canceled', 'archived')
  ),
  constraint operations_projects_dates_check check (
    completed_on is null or started_on is null or completed_on >= started_on
  )
);

create table public.operations_financial_accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null default 'checking',
  institution_name text,
  last_four text,
  current_balance_cents bigint,
  balance_as_of date,
  status text not null default 'active',
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_financial_accounts_name_check check (length(btrim(name)) between 1 and 160),
  constraint operations_financial_accounts_type_check check (
    account_type in ('checking', 'savings', 'cash', 'credit', 'payment_processor', 'other')
  ),
  constraint operations_financial_accounts_last_four_check check (
    last_four is null or last_four ~ '^[0-9]{4}$'
  ),
  constraint operations_financial_accounts_balance_pair_check check (
    (current_balance_cents is null and balance_as_of is null)
    or (current_balance_cents is not null and balance_as_of is not null)
  ),
  constraint operations_financial_accounts_status_check check (status in ('active', 'archived'))
);

create table public.operations_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null,
  customer_id uuid not null references public.operations_parties(id) on delete restrict,
  project_id uuid references public.operations_projects(id) on delete set null,
  product_id uuid references public.operations_products(id) on delete set null,
  issue_date date not null,
  due_date date,
  total_cents bigint not null,
  status text not null default 'draft',
  recurring boolean not null default false,
  external_url text,
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_invoices_number_check check (length(btrim(invoice_number)) between 1 and 80),
  constraint operations_invoices_dates_check check (due_date is null or due_date >= issue_date),
  constraint operations_invoices_amount_check check (total_cents > 0),
  constraint operations_invoices_status_check check (
    status in ('draft', 'sent', 'partial', 'paid', 'overdue', 'void', 'uncollectible')
  )
);

create unique index operations_invoices_number_unique_idx
on public.operations_invoices(lower(invoice_number));

create table public.operations_deposits (
  id uuid primary key default gen_random_uuid(),
  financial_account_id uuid references public.operations_financial_accounts(id) on delete restrict,
  deposit_date date not null,
  amount_cents bigint not null,
  payment_method text not null default 'cash',
  reference_number text,
  status text not null default 'completed',
  notes text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_deposits_amount_check check (amount_cents > 0),
  constraint operations_deposits_method_check check (
    payment_method in ('cash', 'check', 'stripe', 'ach', 'paypal', 'venmo', 'square', 'bank_transfer', 'manual', 'other')
  ),
  constraint operations_deposits_status_check check (status in ('pending', 'completed', 'void'))
);

create table public.operations_transactions (
  id uuid primary key default gen_random_uuid(),
  transaction_type text not null,
  transaction_date date not null,
  amount_cents bigint not null,
  status text not null default 'completed',
  party_id uuid references public.operations_parties(id) on delete restrict,
  product_id uuid references public.operations_products(id) on delete set null,
  project_id uuid references public.operations_projects(id) on delete set null,
  invoice_id uuid references public.operations_invoices(id) on delete set null,
  financial_account_id uuid references public.operations_financial_accounts(id) on delete restrict,
  deposit_id uuid references public.operations_deposits(id) on delete set null,
  category text,
  payment_method text not null default 'manual',
  recurring boolean not null default false,
  description text not null,
  reference_number text,
  receipt_path text,
  notes text,
  void_reason text,
  voided_at timestamptz,
  voided_by_user_id uuid references auth.users(id) on delete set null,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_transactions_type_check check (transaction_type in ('revenue', 'expense')),
  constraint operations_transactions_amount_check check (amount_cents > 0),
  constraint operations_transactions_status_check check (status in ('pending', 'completed', 'void')),
  constraint operations_transactions_method_check check (
    payment_method in (
      'cash', 'check', 'stripe', 'ach', 'paypal', 'venmo', 'square',
      'bank_transfer', 'business_debit', 'business_credit', 'manual', 'other'
    )
  ),
  constraint operations_transactions_description_check check (length(btrim(description)) between 1 and 240),
  constraint operations_transactions_void_check check (
    (status <> 'void' and void_reason is null and voided_at is null and voided_by_user_id is null)
    or (
      status = 'void'
      and length(btrim(void_reason)) >= 3
      and voided_at is not null
      and voided_by_user_id is not null
    )
  )
);

create table public.operations_audit_log (
  id uuid primary key default gen_random_uuid(),
  table_name text not null,
  record_id uuid not null,
  action text not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  constraint operations_audit_log_table_check check (
    table_name in (
      'operations_parties',
      'operations_products',
      'operations_projects',
      'operations_financial_accounts',
      'operations_invoices',
      'operations_deposits',
      'operations_transactions'
    )
  ),
  constraint operations_audit_log_action_check check (action in ('insert', 'update', 'delete')),
  constraint operations_audit_log_snapshot_check check (jsonb_typeof(snapshot) = 'object')
);

create index operations_parties_type_status_idx
on public.operations_parties(party_type, status, name);

create index operations_projects_customer_status_idx
on public.operations_projects(customer_id, status, updated_at desc);

create index operations_projects_product_idx
on public.operations_projects(product_id)
where product_id is not null;

create index operations_invoices_customer_status_idx
on public.operations_invoices(customer_id, status, issue_date desc);

create index operations_invoices_project_idx
on public.operations_invoices(project_id)
where project_id is not null;

create index operations_invoices_product_idx
on public.operations_invoices(product_id)
where product_id is not null;

create index operations_deposits_date_status_idx
on public.operations_deposits(deposit_date desc, status);

create index operations_deposits_account_idx
on public.operations_deposits(financial_account_id)
where financial_account_id is not null;

create index operations_transactions_date_type_status_idx
on public.operations_transactions(transaction_date desc, transaction_type, status);

create index operations_transactions_party_idx
on public.operations_transactions(party_id)
where party_id is not null;

create index operations_transactions_product_idx
on public.operations_transactions(product_id)
where product_id is not null;

create index operations_transactions_project_idx
on public.operations_transactions(project_id)
where project_id is not null;

create index operations_transactions_invoice_idx
on public.operations_transactions(invoice_id)
where invoice_id is not null;

create index operations_transactions_account_idx
on public.operations_transactions(financial_account_id)
where financial_account_id is not null;

create index operations_transactions_deposit_idx
on public.operations_transactions(deposit_id)
where deposit_id is not null;

create index operations_audit_log_record_idx
on public.operations_audit_log(table_name, record_id, created_at desc);

create index operations_audit_log_actor_idx
on public.operations_audit_log(actor_user_id, created_at desc)
where actor_user_id is not null;

create trigger operations_parties_set_updated_at
before update on public.operations_parties
for each row execute function public.set_updated_at();

create trigger operations_products_set_updated_at
before update on public.operations_products
for each row execute function public.set_updated_at();

create trigger operations_projects_set_updated_at
before update on public.operations_projects
for each row execute function public.set_updated_at();

create trigger operations_financial_accounts_set_updated_at
before update on public.operations_financial_accounts
for each row execute function public.set_updated_at();

create trigger operations_invoices_set_updated_at
before update on public.operations_invoices
for each row execute function public.set_updated_at();

create trigger operations_deposits_set_updated_at
before update on public.operations_deposits
for each row execute function public.set_updated_at();

create trigger operations_transactions_set_updated_at
before update on public.operations_transactions
for each row execute function public.set_updated_at();

create or replace function private.audit_operations_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_id uuid;
  audit_snapshot jsonb;
begin
  if tg_op = 'INSERT' then
    target_id := new.id;
    audit_snapshot := jsonb_build_object('after', to_jsonb(new));
  elsif tg_op = 'UPDATE' then
    target_id := new.id;
    audit_snapshot := jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new));
  else
    target_id := old.id;
    audit_snapshot := jsonb_build_object('before', to_jsonb(old));
  end if;

  insert into public.operations_audit_log (
    table_name,
    record_id,
    action,
    actor_user_id,
    snapshot
  ) values (
    tg_table_name,
    target_id,
    lower(tg_op),
    actor_id,
    audit_snapshot
  );

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.audit_operations_change() from public;

create trigger operations_parties_audit
after insert or update or delete on public.operations_parties
for each row execute function private.audit_operations_change();

create trigger operations_products_audit
after insert or update or delete on public.operations_products
for each row execute function private.audit_operations_change();

create trigger operations_projects_audit
after insert or update or delete on public.operations_projects
for each row execute function private.audit_operations_change();

create trigger operations_financial_accounts_audit
after insert or update or delete on public.operations_financial_accounts
for each row execute function private.audit_operations_change();

create trigger operations_invoices_audit
after insert or update or delete on public.operations_invoices
for each row execute function private.audit_operations_change();

create trigger operations_deposits_audit
after insert or update or delete on public.operations_deposits
for each row execute function private.audit_operations_change();

create trigger operations_transactions_audit
after insert or update or delete on public.operations_transactions
for each row execute function private.audit_operations_change();

alter table public.operations_parties enable row level security;
alter table public.operations_products enable row level security;
alter table public.operations_projects enable row level security;
alter table public.operations_financial_accounts enable row level security;
alter table public.operations_invoices enable row level security;
alter table public.operations_deposits enable row level security;
alter table public.operations_transactions enable row level security;
alter table public.operations_audit_log enable row level security;

revoke all on public.operations_parties from anon, authenticated;
revoke all on public.operations_products from anon, authenticated;
revoke all on public.operations_projects from anon, authenticated;
revoke all on public.operations_financial_accounts from anon, authenticated;
revoke all on public.operations_invoices from anon, authenticated;
revoke all on public.operations_deposits from anon, authenticated;
revoke all on public.operations_transactions from anon, authenticated;
revoke all on public.operations_audit_log from anon, authenticated;

grant select, insert, update on public.operations_parties to authenticated;
grant select, insert, update on public.operations_products to authenticated;
grant select, insert, update on public.operations_projects to authenticated;
grant select, insert, update on public.operations_financial_accounts to authenticated;
grant select, insert, update on public.operations_invoices to authenticated;
grant select, insert, update on public.operations_deposits to authenticated;
grant select, insert, update on public.operations_transactions to authenticated;
grant select on public.operations_audit_log to authenticated;

grant all on public.operations_parties to service_role;
grant all on public.operations_products to service_role;
grant all on public.operations_projects to service_role;
grant all on public.operations_financial_accounts to service_role;
grant all on public.operations_invoices to service_role;
grant all on public.operations_deposits to service_role;
grant all on public.operations_transactions to service_role;
grant all on public.operations_audit_log to service_role;

create policy "operations_parties_admin_all"
on public.operations_parties for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_products_admin_all"
on public.operations_products for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_projects_admin_all"
on public.operations_projects for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_financial_accounts_admin_all"
on public.operations_financial_accounts for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_invoices_admin_all"
on public.operations_invoices for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_deposits_admin_all"
on public.operations_deposits for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_transactions_admin_all"
on public.operations_transactions for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_audit_log_admin_select"
on public.operations_audit_log for select to authenticated
using ((select public.is_platform_admin()));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'operations-receipts',
  'operations-receipts',
  false,
  10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "operations_receipts_admin_select"
on storage.objects for select to authenticated
using (
  bucket_id = 'operations-receipts'
  and (select public.is_platform_admin())
);

create policy "operations_receipts_admin_insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'operations-receipts'
  and (select public.is_platform_admin())
);

create policy "operations_receipts_admin_update"
on storage.objects for update to authenticated
using (
  bucket_id = 'operations-receipts'
  and (select public.is_platform_admin())
)
with check (
  bucket_id = 'operations-receipts'
  and (select public.is_platform_admin())
);
;
