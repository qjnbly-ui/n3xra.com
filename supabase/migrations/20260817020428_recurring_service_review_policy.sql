alter table public.website_proposal_versions
  add column if not exists recurring_start_policy text not null default 'immediate',
  add column if not exists complimentary_months integer not null default 0,
  add column if not exists review_notice_days integer not null default 45;

alter table public.website_proposal_versions
  drop constraint if exists website_proposal_versions_recurring_start_policy_check,
  add constraint website_proposal_versions_recurring_start_policy_check
    check (recurring_start_policy in ('immediate', 'review_required')),
  drop constraint if exists website_proposal_versions_complimentary_months_check,
  add constraint website_proposal_versions_complimentary_months_check
    check (complimentary_months between 0 and 60),
  drop constraint if exists website_proposal_versions_review_notice_days_check,
  add constraint website_proposal_versions_review_notice_days_check
    check (review_notice_days between 1 and 180),
  drop constraint if exists website_proposal_versions_review_policy_consistency_check,
  add constraint website_proposal_versions_review_policy_consistency_check
    check (
      (recurring_start_policy = 'immediate' and complimentary_months = 0)
      or (recurring_start_policy = 'review_required' and complimentary_months > 0 and recurring_cents > 0)
    );

alter table public.website_billing_snapshots
  add column if not exists recurring_start_policy text not null default 'immediate',
  add column if not exists complimentary_months integer not null default 0,
  add column if not exists review_notice_days integer not null default 45;

alter table public.website_billing_snapshots
  drop constraint if exists website_billing_snapshots_recurring_start_policy_check,
  add constraint website_billing_snapshots_recurring_start_policy_check
    check (recurring_start_policy in ('immediate', 'review_required')),
  drop constraint if exists website_billing_snapshots_complimentary_months_check,
  add constraint website_billing_snapshots_complimentary_months_check
    check (complimentary_months between 0 and 60),
  drop constraint if exists website_billing_snapshots_review_notice_days_check,
  add constraint website_billing_snapshots_review_notice_days_check
    check (review_notice_days between 1 and 180);

comment on column public.website_proposal_versions.recurring_start_policy is
  'Controls whether recurring service begins during billing setup or requires a later written review.';
comment on column public.website_proposal_versions.complimentary_months is
  'Number of complimentary service months before a paid-service review.';
comment on column public.website_proposal_versions.review_notice_days is
  'Days before the complimentary period ends when N3XRA should review paid service with the client.';
