alter table public.loan_accounts
  add column if not exists organization_id uuid
  references public.organizations (id) on delete restrict;

create unique index if not exists loan_accounts_one_active_per_organization
  on public.loan_accounts (organization_id)
  where organization_id is not null and status = 'active';

comment on column public.loan_accounts.organization_id is
  'Optional organization that owns portal discovery for this loan workspace. Loan data access remains controlled by the owner, loan members, and platform administrators.';

insert into public.n3xra_product_catalog (
  product_key,
  name,
  description,
  portal_path,
  icon_key,
  client_portal_available,
  status,
  sort_order
)
values (
  'loan_tracker',
  'Mortgage Calculator',
  'Track loan payments, balances, payoff timing, and payment scenarios.',
  '/account/loan-tracker/',
  'records',
  true,
  'active',
  30
)
on conflict (product_key) do update
set name = excluded.name,
    description = excluded.description,
    portal_path = excluded.portal_path,
    icon_key = excluded.icon_key,
    client_portal_available = excluded.client_portal_available,
    status = excluded.status,
    sort_order = excluded.sort_order,
    updated_at = now();

update public.loan_accounts as loan
set organization_id = website.organization_id,
    updated_at = now()
from auth.users as account_user
join public.client_websites as website
  on website.portal_slug = 'the-bly-outdoor-store'
join public.organizations as organization
  on organization.id = website.organization_id
 and organization.owner_user_id = account_user.id
where loan.user_id = account_user.id
  and lower(account_user.email) = 'theoutdoorstore2016@gmail.com'
  and account_user.email_confirmed_at is not null
  and loan.status = 'active'
  and loan.organization_id is null;

insert into public.organization_product_entitlements (
  organization_id,
  product_key,
  status,
  portal_enabled,
  source,
  metadata
)
select distinct
  loan.organization_id,
  'loan_tracker',
  'active',
  true,
  'manual',
  jsonb_build_object('loan_account_id', loan.id)
from public.loan_accounts as loan
where loan.organization_id is not null
  and loan.status = 'active'
on conflict (organization_id, product_key) do update
set status = 'active',
    portal_enabled = true,
    source = case
      when public.organization_product_entitlements.source = 'subscription'
        then public.organization_product_entitlements.source
      else excluded.source
    end,
    metadata = public.organization_product_entitlements.metadata || excluded.metadata,
    updated_at = now();

revoke select on public.loan_accounts from authenticated;
grant select (
  id,
  user_id,
  organization_id,
  name,
  borrower_name,
  payment_recipient_name,
  lender_name,
  loan_number_last_four,
  original_balance,
  amount_financed,
  current_official_balance,
  official_balance_date,
  annual_interest_rate,
  required_monthly_payment,
  planned_monthly_payment,
  private_payment_day,
  lender_due_day,
  first_payment_date,
  calculation_start_date,
  status,
  notes,
  created_at,
  updated_at
) on public.loan_accounts to authenticated;
