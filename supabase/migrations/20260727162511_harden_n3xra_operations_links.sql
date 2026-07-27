alter table public.operations_transactions
add constraint operations_transactions_invoice_revenue_check
check (invoice_id is null or transaction_type = 'revenue');

alter table public.operations_transactions
add constraint operations_transactions_deposit_revenue_check
check (deposit_id is null or transaction_type = 'revenue');

create or replace function private.validate_operations_transaction_links()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  deposit_amount bigint;
  deposit_status text;
  matched_amount bigint;
begin
  if new.deposit_id is null then
    return new;
  end if;

  select amount_cents, status
  into deposit_amount, deposit_status
  from public.operations_deposits
  where id = new.deposit_id;

  if deposit_status = 'void' then
    raise exception 'A transaction cannot be matched to a voided deposit.';
  end if;

  select coalesce(sum(amount_cents), 0)
  into matched_amount
  from public.operations_transactions
  where deposit_id = new.deposit_id
    and id <> new.id
    and status = 'completed';

  if new.status = 'completed' then
    matched_amount := matched_amount + new.amount_cents;
  end if;

  if matched_amount > deposit_amount then
    raise exception 'Completed transactions matched to this deposit cannot exceed the deposit amount.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_operations_transaction_links() from public;

create trigger operations_transactions_validate_links
before insert or update on public.operations_transactions
for each row execute function private.validate_operations_transaction_links();

create or replace function private.validate_operations_deposit_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  matched_amount bigint;
begin
  select coalesce(sum(amount_cents), 0)
  into matched_amount
  from public.operations_transactions
  where deposit_id = new.id
    and status = 'completed';

  if new.status = 'void' and matched_amount > 0 then
    raise exception 'Remove completed transaction matches before voiding this deposit.';
  end if;

  if matched_amount > new.amount_cents then
    raise exception 'The deposit amount cannot be less than its matched completed transactions.';
  end if;

  return new;
end;
$$;

revoke all on function private.validate_operations_deposit_update() from public;

create trigger operations_deposits_validate_update
before update on public.operations_deposits
for each row execute function private.validate_operations_deposit_update();
