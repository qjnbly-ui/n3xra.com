create table public.organization_product_price_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  product_key text not null references public.n3xra_product_catalog (product_key) on delete cascade,
  setup_fee_cents integer,
  monthly_price_cents integer,
  stripe_monthly_price_id text,
  stripe_setup_price_id text,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_product_price_overrides_org_product_key unique (organization_id, product_key),
  constraint organization_product_price_overrides_amounts_check check (
    (setup_fee_cents is null or setup_fee_cents >= 0)
    and (monthly_price_cents is null or monthly_price_cents >= 0)
  )
);

create trigger organization_product_price_overrides_set_updated_at
before update on public.organization_product_price_overrides
for each row execute function public.set_updated_at();

alter table public.organization_product_price_overrides enable row level security;
revoke all on public.organization_product_price_overrides from public, anon, authenticated;
grant all on public.organization_product_price_overrides to service_role;

comment on table public.organization_product_price_overrides is
  'Server-only organization pricing exceptions. Catalog pricing remains the standard public price.';

insert into public.organization_product_price_overrides (
  organization_id,
  product_key,
  setup_fee_cents,
  monthly_price_cents,
  stripe_monthly_price_id,
  stripe_setup_price_id,
  reason
)
values (
  '74b2226c-6d7d-4267-9f70-5fbe106a6816',
  'communications',
  2900,
  1900,
  'price_1U8iNG4fYoWkBJCDueCP9iAe',
  'price_1U8iTw4fYoWkBJCDBMrndlhW',
  'Roots & Relics founding-customer setup price'
)
on conflict (organization_id, product_key) do update set
  setup_fee_cents = excluded.setup_fee_cents,
  monthly_price_cents = excluded.monthly_price_cents,
  stripe_monthly_price_id = excluded.stripe_monthly_price_id,
  stripe_setup_price_id = excluded.stripe_setup_price_id,
  reason = excluded.reason,
  updated_at = now();

-- The standard catalog price is $49. The Stripe setup price ID is replaced in
-- this migration after the corresponding immutable Stripe Price is created.
update public.n3xra_product_catalog
set setup_fee_cents = 4900,
    stripe_setup_price_id = 'price_1U8kHk4fYoWkBJCDgL9ofcpS'
where product_key = 'communications';

create table public.communications_carrier_onboarding (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  workspace_id uuid not null,
  status text not null default 'draft',
  application jsonb not null default '{}'::jsonb,
  submitted_at timestamptz,
  submitted_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  review_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint communications_carrier_onboarding_workspace_key unique (workspace_id),
  constraint communications_carrier_onboarding_workspace_organization_fk
    foreign key (workspace_id, organization_id)
    references public.communications_workspaces (id, organization_id) on delete cascade,
  constraint communications_carrier_onboarding_status_check
    check (status in ('draft', 'submitted', 'needs_changes', 'approved', 'provisioning', 'carrier_pending', 'active', 'rejected')),
  constraint communications_carrier_onboarding_application_object_check
    check (jsonb_typeof(application) = 'object' and octet_length(application::text) <= 60000),
  constraint communications_carrier_onboarding_review_notes_check
    check (review_notes is null or char_length(review_notes) <= 5000)
);

create index communications_carrier_onboarding_organization_status_idx
  on public.communications_carrier_onboarding (organization_id, status, updated_at desc);

create trigger communications_carrier_onboarding_set_updated_at
before update on public.communications_carrier_onboarding
for each row execute function public.set_updated_at();

alter table public.communications_carrier_onboarding enable row level security;
revoke all on public.communications_carrier_onboarding from public, anon, authenticated;
grant select on public.communications_carrier_onboarding to authenticated;
grant all on public.communications_carrier_onboarding to service_role;

create policy communications_carrier_onboarding_account_admin_select
on public.communications_carrier_onboarding
for select
to authenticated
using (
  exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = communications_carrier_onboarding.organization_id
      and membership.user_id = (select auth.uid())
      and membership.role = 'account_admin'
  )
  or exists (
    select 1 from public.organizations organization
    where organization.id = communications_carrier_onboarding.organization_id
      and organization.owner_user_id = (select auth.uid())
  )
  or public.is_platform_admin()
);

create or replace function public.save_communications_carrier_onboarding(
  input_workspace_id uuid,
  input_application jsonb,
  input_submit boolean default false
) returns public.communications_carrier_onboarding
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  target_workspace public.communications_workspaces%rowtype;
  existing_row public.communications_carrier_onboarding%rowtype;
  saved_row public.communications_carrier_onboarding%rowtype;
  sample_count integer;
  sample_value jsonb;
  can_manage boolean := false;
begin
  if current_user_id is null then raise exception 'Authentication required.'; end if;
  if input_application is null or jsonb_typeof(input_application) <> 'object' then
    raise exception 'Onboarding details must be a JSON object.';
  end if;
  if octet_length(input_application::text) > 60000 then raise exception 'Onboarding details are too large.'; end if;

  select * into target_workspace from public.communications_workspaces where id = input_workspace_id;
  if target_workspace.id is null then raise exception 'Communications workspace not found.'; end if;

  select (
    exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = target_workspace.organization_id
        and membership.user_id = current_user_id
        and membership.role = 'account_admin'
    )
    or exists (
      select 1 from public.organizations organization
      where organization.id = target_workspace.organization_id
        and organization.owner_user_id = current_user_id
    )
    or public.is_platform_admin()
  ) into can_manage;
  if not can_manage then raise exception 'Account administrator access is required.'; end if;

  if not exists (
    select 1 from public.organization_product_entitlements entitlement
    where entitlement.organization_id = target_workspace.organization_id
      and entitlement.product_key = 'communications'
      and entitlement.portal_enabled = true
      and entitlement.status in ('trialing', 'active', 'past_due')
  ) and not public.is_platform_admin() then
    raise exception 'Communications must be activated before carrier onboarding.';
  end if;

  select * into existing_row from public.communications_carrier_onboarding
  where workspace_id = input_workspace_id;
  if existing_row.status in ('approved', 'provisioning', 'carrier_pending', 'active') and not public.is_platform_admin() then
    raise exception 'This onboarding submission is already being processed.';
  end if;

  if input_submit then
    if coalesce(input_application->>'brand_type', '') not in ('standard', 'sole_proprietor') then raise exception 'Choose a valid business registration type.'; end if;
    if char_length(trim(coalesce(input_application->>'legal_business_name', ''))) < 2 then raise exception 'Legal business name is required.'; end if;
    if char_length(trim(coalesce(input_application->>'business_industry', ''))) < 2 then raise exception 'Business industry is required.'; end if;
    if input_application->>'brand_type' = 'standard' and (
      char_length(trim(coalesce(input_application->>'business_type', ''))) < 2
      or char_length(regexp_replace(coalesce(input_application->>'business_registration_number', ''), '[^0-9A-Za-z]', '', 'g')) < 9
    ) then raise exception 'Business type and EIN or registration number are required.'; end if;
    if coalesce(input_application->>'website_url', '') !~ '^https://[^[:space:]]+$' then raise exception 'A public HTTPS business website is required.'; end if;
    if coalesce(input_application->>'privacy_policy_url', '') !~ '^https://[^[:space:]]+$' then raise exception 'A public HTTPS privacy policy URL is required.'; end if;
    if coalesce(input_application->>'terms_url', '') !~ '^https://[^[:space:]]+$' then raise exception 'A public HTTPS terms URL is required.'; end if;
    if char_length(trim(coalesce(input_application->>'authorized_first_name', ''))) < 1
      or char_length(trim(coalesce(input_application->>'authorized_last_name', ''))) < 1
      or char_length(trim(coalesce(input_application->>'authorized_title', ''))) < 2
      or char_length(trim(coalesce(input_application->>'authorized_phone', ''))) < 7
      or coalesce(input_application->>'authorized_email', '') !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    then raise exception 'Complete the authorized representative details.'; end if;
    if char_length(trim(coalesce(input_application->>'address_street', ''))) < 3
      or char_length(trim(coalesce(input_application->>'address_city', ''))) < 2
      or char_length(trim(coalesce(input_application->>'address_region', ''))) <> 2
      or char_length(trim(coalesce(input_application->>'address_postal_code', ''))) < 5
    then raise exception 'Complete the registered business address.'; end if;
    if char_length(trim(coalesce(input_application->>'campaign_description', ''))) not between 40 and 4096 then raise exception 'Campaign description must be between 40 and 4,096 characters.'; end if;
    if char_length(trim(coalesce(input_application->>'message_flow', ''))) not between 40 and 2049 then raise exception 'Opt-in workflow must be between 40 and 2,049 characters.'; end if;
    if coalesce(input_application->>'campaign_use_case', '') = '' then raise exception 'Choose a campaign use case.'; end if;
    if jsonb_typeof(input_application->'message_samples') <> 'array' then raise exception 'Provide at least two sample messages.'; end if;
    sample_count := jsonb_array_length(input_application->'message_samples');
    if sample_count < 2 or sample_count > 5 then raise exception 'Provide between two and five sample messages.'; end if;
    for sample_value in select value from jsonb_array_elements(input_application->'message_samples') loop
      if char_length(trim(sample_value #>> '{}')) not between 20 and 1024 then raise exception 'Each sample message must be between 20 and 1,024 characters.'; end if;
    end loop;
    if coalesce((input_application->>'sms_keyword_enabled')::boolean, false) and (
      char_length(trim(coalesce(input_application->>'opt_in_keywords', ''))) < 2
      or char_length(trim(coalesce(input_application->>'opt_in_message', ''))) not between 20 and 320
    ) then raise exception 'Keyword opt-in requires keywords and a 20–320 character confirmation message.'; end if;
    if coalesce((input_application->>'authority_attested')::boolean, false) is not true
      or coalesce((input_application->>'accuracy_attested')::boolean, false) is not true
      or coalesce((input_application->>'carrier_fees_authorized')::boolean, false) is not true
      or char_length(trim(coalesce(input_application->>'signature_name', ''))) < 2
    then raise exception 'Complete all authorization confirmations and sign the submission.'; end if;
  end if;

  insert into public.communications_carrier_onboarding (
    organization_id, workspace_id, status, application, submitted_at, submitted_by, review_notes
  ) values (
    target_workspace.organization_id,
    target_workspace.id,
    case when input_submit then 'submitted' else 'draft' end,
    input_application,
    case when input_submit then now() else null end,
    case when input_submit then current_user_id else null end,
    null
  )
  on conflict (workspace_id) do update set
    application = excluded.application,
    status = case when input_submit then 'submitted' else
      case when communications_carrier_onboarding.status = 'needs_changes' then 'needs_changes' else 'draft' end
    end,
    submitted_at = case when input_submit then now() else communications_carrier_onboarding.submitted_at end,
    submitted_by = case when input_submit then current_user_id else communications_carrier_onboarding.submitted_by end,
    review_notes = case when input_submit then null else communications_carrier_onboarding.review_notes end,
    reviewed_at = case when input_submit then null else communications_carrier_onboarding.reviewed_at end,
    reviewed_by = case when input_submit then null else communications_carrier_onboarding.reviewed_by end,
    updated_at = now()
  returning * into saved_row;
  return saved_row;
end;
$$;

revoke all on function public.save_communications_carrier_onboarding(uuid, jsonb, boolean) from public, anon;
grant execute on function public.save_communications_carrier_onboarding(uuid, jsonb, boolean) to authenticated;

comment on table public.communications_carrier_onboarding is
  'Private, account-admin-only A2P 10DLC business and campaign intake. Twilio submission remains a reviewed provider operation.';
