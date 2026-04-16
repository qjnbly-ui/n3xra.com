-- Manual billing updates for the pre-Stripe phase.
-- Run these in the Supabase SQL Editor as needed.
--
-- Replace YOUR_ORGANIZATION_ID with the target organization id.
-- Until you replace it, the filter resolves to NULL and matches no rows.

-- View the current billing state for one organization.
select
  id,
  name,
  subscription_tier,
  account_status,
  document_limit,
  user_limit,
  storage_limit_mb,
  public_embed_enabled,
  stripe_customer_id,
  stripe_subscription_id,
  stripe_price_id,
  subscription_current_period_end
from public.organizations
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Move an organization to Free.
update public.organizations
set
  subscription_tier = 'free',
  account_status = 'active',
  document_limit = 25,
  user_limit = 1,
  storage_limit_mb = 512,
  public_embed_enabled = false,
  stripe_price_id = null,
  stripe_subscription_id = null,
  subscription_current_period_end = null
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Move an organization to Starter.
update public.organizations
set
  subscription_tier = 'starter',
  account_status = 'active',
  document_limit = 250,
  user_limit = 6,
  storage_limit_mb = 4096,
  public_embed_enabled = false
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Move an organization to Organization.
update public.organizations
set
  subscription_tier = 'organization',
  account_status = 'active',
  document_limit = 2500,
  user_limit = 20,
  storage_limit_mb = 20480,
  public_embed_enabled = true
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Mark a subscription as trialing.
update public.organizations
set
  account_status = 'trialing'
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Mark a subscription as past due.
update public.organizations
set
  account_status = 'past_due'
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Mark a subscription as canceled.
update public.organizations
set
  account_status = 'canceled'
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;

-- Attach Stripe ids later without changing the rest of the account model.
update public.organizations
set
  stripe_customer_id = 'cus_example',
  stripe_subscription_id = 'sub_example',
  stripe_price_id = 'price_example',
  subscription_current_period_end = now() + interval '30 days'
where id = nullif('YOUR_ORGANIZATION_ID', 'YOUR_ORGANIZATION_ID')::uuid;
