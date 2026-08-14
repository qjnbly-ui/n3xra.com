alter table public.website_service_requests
  add column if not exists service_plan text,
  add column if not exists service_plan_auto_applied boolean not null default false,
  add column if not exists service_plan_reason text;

alter table public.website_service_requests
  drop constraint if exists website_service_requests_service_plan_check;

alter table public.website_service_requests
  add constraint website_service_requests_service_plan_check
  check (service_plan is null or service_plan in ('starter', 'starter_plus', 'advanced'));

comment on column public.website_service_requests.service_plan is
  'Client-selected website service plan, with advanced applied automatically when the selected scope requires it.';

comment on column public.website_service_requests.service_plan_auto_applied is
  'Whether Advanced was applied by the request form because the selected scope exceeded Starter or Starter+ fit.';

comment on column public.website_service_requests.service_plan_reason is
  'Short client-facing explanation for an automatic Advanced plan recommendation.';
