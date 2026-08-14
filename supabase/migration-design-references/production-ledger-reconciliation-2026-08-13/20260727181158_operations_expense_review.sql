create table public.operations_import_batches (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  file_type text not null,
  file_fingerprint text not null unique,
  financial_account_id uuid references public.operations_financial_accounts(id) on delete restrict,
  statement_month date,
  status text not null default 'review',
  row_count integer not null default 0,
  posted_count integer not null default 0,
  posted_amount_cents bigint not null default 0,
  assumptions text,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  posted_by_user_id uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_import_batches_file_name_check
    check (length(btrim(file_name)) between 1 and 240),
  constraint operations_import_batches_file_type_check
    check (file_type in ('csv', 'xlsx', 'xls')),
  constraint operations_import_batches_fingerprint_check
    check (file_fingerprint ~ '^[a-f0-9]{64}$'),
  constraint operations_import_batches_month_check
    check (statement_month is null or statement_month = date_trunc('month', statement_month)::date),
  constraint operations_import_batches_status_check
    check (status in ('review', 'posted', 'void')),
  constraint operations_import_batches_counts_check
    check (row_count >= 0 and posted_count >= 0 and posted_count <= row_count and posted_amount_cents >= 0),
  constraint operations_import_batches_posted_check
    check (
      (status <> 'posted' and posted_by_user_id is null and posted_at is null)
      or (status = 'posted' and posted_by_user_id is not null and posted_at is not null)
    )
);

create table public.operations_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.operations_import_batches(id) on delete cascade,
  row_number integer not null,
  transaction_date date not null,
  posted_date date,
  description text not null,
  amount_cents bigint not null,
  flow text not null,
  source_category text,
  classification text not null default 'needs_review',
  business_use_percent numeric(5,2) not null default 0,
  deductible_cents bigint not null default 0,
  category text,
  confidence smallint not null default 0,
  suggestion_reason text,
  fingerprint text not null,
  is_duplicate boolean not null default false,
  receipt_path text,
  asset_candidate boolean not null default false,
  asset_notes text,
  status text not null default 'pending',
  posted_transaction_id uuid references public.operations_transactions(id) on delete set null,
  raw_data jsonb not null default '{}'::jsonb,
  created_by_user_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operations_import_rows_batch_row_unique unique (batch_id, row_number),
  constraint operations_import_rows_date_check
    check (posted_date is null or posted_date >= transaction_date - 31),
  constraint operations_import_rows_description_check
    check (length(btrim(description)) between 1 and 500),
  constraint operations_import_rows_amount_check check (amount_cents > 0),
  constraint operations_import_rows_flow_check check (flow in ('debit', 'credit')),
  constraint operations_import_rows_classification_check
    check (classification in ('business', 'personal', 'mixed', 'transfer', 'needs_review')),
  constraint operations_import_rows_business_use_check check (
    (classification = 'business' and business_use_percent > 0 and business_use_percent <= 100)
    or (classification = 'mixed' and business_use_percent > 0 and business_use_percent < 100)
    or (classification in ('personal', 'transfer') and business_use_percent = 0)
    or (classification = 'needs_review' and business_use_percent between 0 and 100)
  ),
  constraint operations_import_rows_deductible_check
    check (deductible_cents >= 0 and deductible_cents <= amount_cents),
  constraint operations_import_rows_confidence_check check (confidence between 0 and 100),
  constraint operations_import_rows_fingerprint_check check (fingerprint ~ '^[a-f0-9]{64}$'),
  constraint operations_import_rows_receipt_check
    check (receipt_path is null or length(btrim(receipt_path)) between 1 and 1000),
  constraint operations_import_rows_asset_notes_check
    check (asset_notes is null or length(asset_notes) <= 1000),
  constraint operations_import_rows_status_check check (status in ('pending', 'approved', 'excluded', 'posted')),
  constraint operations_import_rows_approval_check check (
    status not in ('approved', 'posted')
    or (
      flow = 'debit'
      and classification in ('business', 'mixed')
      and is_duplicate = false
      and deductible_cents > 0
    )
  ),
  constraint operations_import_rows_posted_check check (
    (status = 'posted' and posted_transaction_id is not null)
    or (status <> 'posted' and posted_transaction_id is null)
  ),
  constraint operations_import_rows_raw_check check (jsonb_typeof(raw_data) = 'object')
);

create index operations_import_batches_created_idx
on public.operations_import_batches(created_at desc);

create index operations_import_batches_account_idx
on public.operations_import_batches(financial_account_id)
where financial_account_id is not null;

create index operations_import_batches_created_by_idx
on public.operations_import_batches(created_by_user_id);

create index operations_import_batches_posted_by_idx
on public.operations_import_batches(posted_by_user_id)
where posted_by_user_id is not null;

create index operations_import_rows_batch_status_idx
on public.operations_import_rows(batch_id, status, row_number);

create index operations_import_rows_fingerprint_idx
on public.operations_import_rows(fingerprint);

create index operations_import_rows_created_by_idx
on public.operations_import_rows(created_by_user_id);

create index operations_import_rows_posted_transaction_idx
on public.operations_import_rows(posted_transaction_id)
where posted_transaction_id is not null;

create trigger operations_import_batches_set_updated_at
before update on public.operations_import_batches
for each row execute function public.set_updated_at();

create trigger operations_import_rows_set_updated_at
before update on public.operations_import_rows
for each row execute function public.set_updated_at();

create or replace function private.calculate_operations_import_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.flow = 'debit' and new.classification in ('business', 'mixed', 'needs_review') then
    new.deductible_cents := round(new.amount_cents * new.business_use_percent / 100.0);
  else
    new.deductible_cents := 0;
  end if;

  return new;
end;
$$;

revoke all on function private.calculate_operations_import_row() from public;

create trigger operations_import_rows_calculate
before insert or update of amount_cents, flow, classification, business_use_percent
on public.operations_import_rows
for each row execute function private.calculate_operations_import_row();

create or replace function private.protect_posted_operations_import()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'posted' and new is distinct from old then
    raise exception 'Posted import records are immutable. Void the ledger transaction instead.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_posted_operations_import() from public;

create trigger operations_import_batches_protect_posted
before update on public.operations_import_batches
for each row execute function private.protect_posted_operations_import();

create trigger operations_import_rows_protect_posted
before update on public.operations_import_rows
for each row execute function private.protect_posted_operations_import();

alter table public.operations_audit_log
drop constraint operations_audit_log_table_check;

alter table public.operations_audit_log
add constraint operations_audit_log_table_check check (
  table_name in (
    'operations_parties',
    'operations_products',
    'operations_projects',
    'operations_financial_accounts',
    'operations_invoices',
    'operations_deposits',
    'operations_transactions',
    'operations_import_batches',
    'operations_import_rows'
  )
);

create trigger operations_import_batches_audit
after insert or update or delete on public.operations_import_batches
for each row execute function private.audit_operations_change();

create trigger operations_import_rows_audit
after insert or update or delete on public.operations_import_rows
for each row execute function private.audit_operations_change();

alter table public.operations_transactions
drop constraint operations_transactions_source_check,
drop constraint operations_transactions_external_source_check;

alter table public.operations_transactions
add constraint operations_transactions_source_check
check (source in ('manual', 'stripe', 'bank_import')),
add constraint operations_transactions_external_source_check
check (
  (source = 'manual' and external_id is null)
  or (source in ('stripe', 'bank_import') and length(btrim(external_id)) > 0)
);

alter table public.operations_import_batches enable row level security;
alter table public.operations_import_rows enable row level security;

revoke all on public.operations_import_batches from anon, authenticated;
revoke all on public.operations_import_rows from anon, authenticated;

grant select, insert, update on public.operations_import_batches to authenticated;
grant select, insert, update on public.operations_import_rows to authenticated;
grant all on public.operations_import_batches to service_role;
grant all on public.operations_import_rows to service_role;

create policy "operations_import_batches_admin_all"
on public.operations_import_batches for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "operations_import_rows_admin_all"
on public.operations_import_rows for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create or replace function public.post_operations_import_batch(target_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  target_batch public.operations_import_batches%rowtype;
  pending_count integer;
  approved_count integer;
  inserted_count integer;
  inserted_cents bigint;
begin
  if auth.uid() is null or not (select public.is_platform_admin()) then
    raise exception 'Platform administrator access required.';
  end if;

  select *
  into target_batch
  from public.operations_import_batches
  where id = target_batch_id
  for update;

  if not found then
    raise exception 'Import batch not found.';
  end if;

  if target_batch.status <> 'review' then
    raise exception 'Only a review batch can be posted.';
  end if;

  select count(*)
  into pending_count
  from public.operations_import_rows
  where batch_id = target_batch_id
    and status = 'pending';

  if pending_count > 0 then
    raise exception 'Review or exclude every transaction before posting.';
  end if;

  select count(*)
  into approved_count
  from public.operations_import_rows
  where batch_id = target_batch_id
    and status = 'approved';

  if approved_count = 0 then
    raise exception 'Approve at least one business expense before posting.';
  end if;

  if exists (
    select 1
    from public.operations_import_rows imported
    join public.operations_transactions posted
      on posted.source = 'bank_import'
      and posted.external_id = imported.fingerprint
    where imported.batch_id = target_batch_id
      and imported.status = 'approved'
  ) then
    raise exception 'One or more approved transactions already exist in the ledger.';
  end if;

  with inserted as (
    insert into public.operations_transactions (
      transaction_type,
      transaction_date,
      amount_cents,
      status,
      financial_account_id,
      category,
      payment_method,
      recurring,
      description,
      reference_number,
      receipt_path,
      notes,
      created_by_user_id,
      source,
      external_id
    )
    select
      'expense',
      imported.transaction_date,
      imported.deductible_cents,
      'completed',
      target_batch.financial_account_id,
      coalesce(nullif(imported.category, ''), 'Uncategorized'),
      case
        when account.account_type = 'credit' then 'business_credit'
        when account.account_type in ('checking', 'savings') then 'business_debit'
        else 'bank_transfer'
      end,
      false,
      left(imported.description, 240),
      imported.fingerprint,
      imported.receipt_path,
      format(
        'Imported from %s. Original transaction: %s. Approved business use: %s%%.',
        target_batch.file_name,
        (imported.amount_cents / 100.0)::text,
        trim(trailing '.' from trim(trailing '0' from imported.business_use_percent::text))
      ),
      auth.uid(),
      'bank_import',
      imported.fingerprint
    from public.operations_import_rows imported
    left join public.operations_financial_accounts account
      on account.id = target_batch.financial_account_id
    where imported.batch_id = target_batch_id
      and imported.status = 'approved'
    returning id, external_id, amount_cents
  ),
  linked as (
    update public.operations_import_rows imported
    set
      status = 'posted',
      posted_transaction_id = inserted.id
    from inserted
    where imported.batch_id = target_batch_id
      and imported.fingerprint = inserted.external_id
    returning inserted.amount_cents
  )
  select count(*), coalesce(sum(amount_cents), 0)
  into inserted_count, inserted_cents
  from linked;

  if inserted_count <> approved_count then
    raise exception 'The approved expense count did not match the posted count.';
  end if;

  update public.operations_import_batches
  set
    status = 'posted',
    posted_count = inserted_count,
    posted_amount_cents = inserted_cents,
    posted_by_user_id = auth.uid(),
    posted_at = now()
  where id = target_batch_id;

  return jsonb_build_object(
    'posted_count', inserted_count,
    'posted_amount_cents', inserted_cents
  );
end;
$$;

revoke all on function public.post_operations_import_batch(uuid) from public, anon;
grant execute on function public.post_operations_import_batch(uuid) to authenticated, service_role;
