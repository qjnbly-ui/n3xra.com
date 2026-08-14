create table public.loan_account_changes (
  id uuid primary key default gen_random_uuid(),
  loan_account_id uuid not null references public.loan_accounts(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_is_admin boolean not null default false,
  changes jsonb not null check (jsonb_typeof(changes) = 'object' and changes <> '{}'::jsonb),
  created_at timestamptz not null default now()
);

create index loan_account_changes_account_created_idx on public.loan_account_changes(loan_account_id, created_at desc);
create index loan_account_changes_owner_idx on public.loan_account_changes(owner_user_id, created_at desc);
create index loan_account_changes_actor_idx on public.loan_account_changes(actor_user_id, created_at desc);

alter table public.loan_account_changes enable row level security;
revoke all on public.loan_account_changes from anon, authenticated;
grant select on public.loan_account_changes to authenticated;

create policy "loan_account_changes_owner_or_admin_select"
on public.loan_account_changes for select to authenticated
using (owner_user_id = (select auth.uid()) or (select public.is_platform_admin()));

create or replace function public.update_loan_account_settings(input_loan_account_id uuid, input_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  actor_admin boolean := false;
  existing public.loan_accounts%rowtype;
  updated public.loan_accounts%rowtype;
  allowed_owner_fields constant text[] := array['current_official_balance','official_balance_date','planned_monthly_payment','private_payment_day','first_payment_date','notes','original_balance'];
  allowed_admin_fields constant text[] := array['current_official_balance','official_balance_date','planned_monthly_payment','private_payment_day','first_payment_date','notes','original_balance','amount_financed','annual_interest_rate','required_monthly_payment','lender_due_day','calculation_start_date','borrower_name','payment_recipient_name','lender_name','loan_number'];
  requested_field text;
  audit_changes jsonb := '{}'::jsonb;
  old_value jsonb;
  new_value jsonb;
  payment_count integer;
  latest_payment_date date;
begin
  if actor_id is null then raise exception 'Authentication required.'; end if;
  if input_changes is null or jsonb_typeof(input_changes) <> 'object' or input_changes = '{}'::jsonb then raise exception 'Choose at least one setting to update.'; end if;
  actor_admin := public.is_platform_admin();
  select * into existing from public.loan_accounts where id = input_loan_account_id for update;
  if existing.id is null then raise exception 'Loan account not found.'; end if;
  if existing.user_id <> actor_id and not actor_admin then raise exception 'You do not have permission to change this loan.'; end if;

  for requested_field in select jsonb_object_keys(input_changes) loop
    if actor_admin then
      if not (requested_field = any(allowed_admin_fields)) then raise exception 'The setting "%" cannot be changed here.', requested_field; end if;
    elsif not (requested_field = any(allowed_owner_fields)) then
      raise exception 'You do not have permission to change "%".', requested_field;
    end if;
  end loop;

  updated := existing;
  if input_changes ? 'current_official_balance' then updated.current_official_balance := nullif(input_changes ->> 'current_official_balance', '')::numeric; end if;
  if input_changes ? 'official_balance_date' then updated.official_balance_date := nullif(input_changes ->> 'official_balance_date', '')::date; end if;
  if input_changes ? 'planned_monthly_payment' then updated.planned_monthly_payment := nullif(input_changes ->> 'planned_monthly_payment', '')::numeric; end if;
  if input_changes ? 'private_payment_day' then updated.private_payment_day := nullif(input_changes ->> 'private_payment_day', '')::integer; end if;
  if input_changes ? 'first_payment_date' then updated.first_payment_date := nullif(input_changes ->> 'first_payment_date', '')::date; end if;
  if input_changes ? 'notes' then updated.notes := nullif(btrim(input_changes ->> 'notes'), ''); end if;
  if input_changes ? 'original_balance' then updated.original_balance := nullif(input_changes ->> 'original_balance', '')::numeric; end if;

  if actor_admin then
    if input_changes ? 'amount_financed' then updated.amount_financed := nullif(input_changes ->> 'amount_financed', '')::numeric; end if;
    if input_changes ? 'annual_interest_rate' then updated.annual_interest_rate := nullif(input_changes ->> 'annual_interest_rate', '')::numeric; end if;
    if input_changes ? 'required_monthly_payment' then updated.required_monthly_payment := nullif(input_changes ->> 'required_monthly_payment', '')::numeric; end if;
    if input_changes ? 'lender_due_day' then updated.lender_due_day := nullif(input_changes ->> 'lender_due_day', '')::integer; end if;
    if input_changes ? 'calculation_start_date' then updated.calculation_start_date := nullif(input_changes ->> 'calculation_start_date', '')::date; end if;
    if input_changes ? 'borrower_name' then updated.borrower_name := nullif(btrim(input_changes ->> 'borrower_name'), ''); end if;
    if input_changes ? 'payment_recipient_name' then updated.payment_recipient_name := nullif(btrim(input_changes ->> 'payment_recipient_name'), ''); end if;
    if input_changes ? 'lender_name' then updated.lender_name := nullif(btrim(input_changes ->> 'lender_name'), ''); end if;
    if input_changes ? 'loan_number' then updated.loan_number := nullif(btrim(input_changes ->> 'loan_number'), ''); end if;
  end if;

  if updated.original_balance is null or updated.original_balance <= 0 then raise exception 'Original balance must be greater than zero.'; end if;
  if updated.planned_monthly_payment is null or updated.planned_monthly_payment <= 0 then raise exception 'Planned payment must be greater than zero.'; end if;
  if updated.required_monthly_payment is null or updated.required_monthly_payment <= 0 then raise exception 'Required payment must be greater than zero.'; end if;
  if updated.annual_interest_rate is null or updated.annual_interest_rate < 0 or updated.annual_interest_rate > 100 then raise exception 'APR must be between 0 and 100.'; end if;
  if updated.private_payment_day is not null and (updated.private_payment_day < 1 or updated.private_payment_day > 28) then raise exception 'Private payment day must be between 1 and 28.'; end if;
  if updated.lender_due_day is not null and (updated.lender_due_day < 1 or updated.lender_due_day > 28) then raise exception 'Lender due day must be between 1 and 28.'; end if;
  if updated.current_official_balance is not null and updated.current_official_balance < 0 then raise exception 'Official balance cannot be negative.'; end if;
  if updated.current_official_balance is null then
    updated.official_balance_date := null;
  elsif updated.official_balance_date is null then
    raise exception 'An effective date is required with an official balance.';
  elsif updated.official_balance_date > current_date then
    raise exception 'The official balance date cannot be in the future.';
  end if;
  if updated.amount_financed is not null and updated.amount_financed <= 0 then raise exception 'Amount financed must be greater than zero.'; end if;

  if input_changes ? 'original_balance' or input_changes ? 'first_payment_date' then
    select count(*) into payment_count from public.loan_payments where loan_account_id = existing.id and status = 'completed' and applied_to_loan;
    if payment_count > 0 then raise exception 'The original balance and first payment date cannot be changed after payments are recorded. Use an official balance correction instead.'; end if;
  end if;

  if updated.current_official_balance is not null then
    select max(payment_date) into latest_payment_date from public.loan_payments where loan_account_id = existing.id and status = 'completed' and applied_to_loan;
    if latest_payment_date is not null and updated.official_balance_date < latest_payment_date then raise exception 'The official balance date cannot be earlier than the latest recorded payment (%).', latest_payment_date; end if;
  end if;

  for requested_field in select jsonb_object_keys(input_changes) loop
    old_value := to_jsonb(existing) -> requested_field;
    new_value := to_jsonb(updated) -> requested_field;
    if old_value is distinct from new_value then
      if requested_field = 'loan_number' then
        old_value := to_jsonb(case when existing.loan_number is null then null else '••••••' || right(existing.loan_number, 4) end);
        new_value := to_jsonb(case when updated.loan_number is null then null else '••••••' || right(updated.loan_number, 4) end);
      end if;
      audit_changes := audit_changes || jsonb_build_object(requested_field, jsonb_build_object('old', old_value, 'new', new_value));
    end if;
  end loop;

  if audit_changes = '{}'::jsonb then raise exception 'No settings changed.'; end if;

  update public.loan_accounts
  set borrower_name = updated.borrower_name,
      payment_recipient_name = updated.payment_recipient_name,
      lender_name = updated.lender_name,
      loan_number = updated.loan_number,
      original_balance = updated.original_balance,
      amount_financed = updated.amount_financed,
      current_official_balance = updated.current_official_balance,
      official_balance_date = updated.official_balance_date,
      annual_interest_rate = updated.annual_interest_rate,
      required_monthly_payment = updated.required_monthly_payment,
      planned_monthly_payment = updated.planned_monthly_payment,
      private_payment_day = updated.private_payment_day,
      lender_due_day = updated.lender_due_day,
      first_payment_date = updated.first_payment_date,
      calculation_start_date = updated.calculation_start_date,
      notes = updated.notes
  where id = existing.id returning * into updated;

  insert into public.loan_account_changes (loan_account_id,owner_user_id,actor_user_id,actor_is_admin,changes)
  values (updated.id,updated.user_id,actor_id,actor_admin,audit_changes);

  return jsonb_build_object('account', to_jsonb(updated) - 'loan_number', 'changes', audit_changes);
end;
$$;

revoke all on function public.update_loan_account_settings(uuid, jsonb) from public, anon;
grant execute on function public.update_loan_account_settings(uuid, jsonb) to authenticated;
revoke update on public.loan_accounts from authenticated;;
