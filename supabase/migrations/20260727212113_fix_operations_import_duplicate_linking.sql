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
      and imported.status = 'approved'
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
