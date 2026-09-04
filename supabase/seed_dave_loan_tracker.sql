-- Dave's verified N3XRA login is matched by his unique confirmed email.
-- Never identify a financial-record owner by editable display-name metadata.
insert into public.loan_accounts (
  user_id, organization_id, name, borrower_name, payment_recipient_name, lender_name, loan_number,
  original_balance, amount_financed, annual_interest_rate,
  required_monthly_payment, planned_monthly_payment, private_payment_day,
  lender_due_day, first_payment_date, calculation_start_date, notes
) select
  users.id,
  organization.id,
  'Vibrant Credit Union Loan',
  'Dave Wilson',
  'Brent Brown',
  'Vibrant Credit Union',
  '30002041893',
  27024.00,
  26725.00,
  9.2600,
  343.51,
  500.00,
  3,
  16,
  date '2026-08-03',
  date '2026-08-03',
  'Loan documents show both $27,024.00 and $26,725.00 as starting figures.'
from auth.users
join public.organizations as organization
  on organization.owner_user_id = users.id
join public.client_websites as website
  on website.organization_id = organization.id
 and website.portal_slug = 'the-bly-outdoor-store'
where lower(users.email) = 'theoutdoorstore2016@gmail.com'
  and users.email_confirmed_at is not null
  and not exists (
    select 1
    from public.loan_accounts
    where loan_accounts.user_id = users.id
      and loan_accounts.status = 'active'
  );
