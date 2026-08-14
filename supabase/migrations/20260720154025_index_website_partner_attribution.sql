create index if not exists website_service_requests_partner_application_idx
  on public.website_service_requests (partner_application_id)
  where partner_application_id is not null;

create index if not exists founding_partner_applications_referral_code_upper_idx
  on public.founding_partner_applications (upper(referral_code))
  where referral_code is not null and status = 'approved';;
