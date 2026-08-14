create table if not exists public.website_request_ai_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  contact_email text,
  project_snapshot jsonb not null,
  review_snapshot jsonb not null,
  model text not null,
  created_at timestamptz not null default now(),
  constraint website_request_ai_reviews_project_object_check
    check (jsonb_typeof(project_snapshot) = 'object'),
  constraint website_request_ai_reviews_review_object_check
    check (jsonb_typeof(review_snapshot) = 'object')
);

create index if not exists website_request_ai_reviews_created_idx
on public.website_request_ai_reviews (created_at desc);

create index if not exists website_request_ai_reviews_user_created_idx
on public.website_request_ai_reviews (user_id, created_at desc)
where user_id is not null;

create index if not exists website_request_ai_reviews_email_created_idx
on public.website_request_ai_reviews (lower(contact_email), created_at desc)
where contact_email is not null;

alter table public.website_request_ai_reviews enable row level security;

revoke all on public.website_request_ai_reviews from anon;
revoke all on public.website_request_ai_reviews from authenticated;
grant select on public.website_request_ai_reviews to authenticated;
grant all on public.website_request_ai_reviews to service_role;

drop policy if exists "website_request_ai_reviews_admin_select" on public.website_request_ai_reviews;
create policy "website_request_ai_reviews_admin_select"
on public.website_request_ai_reviews
for select
to authenticated
using ((select public.is_platform_admin()));

alter table public.website_service_requests
add column if not exists ai_review_id uuid
references public.website_request_ai_reviews (id) on delete set null;

create index if not exists website_service_requests_ai_review_idx
on public.website_service_requests (ai_review_id)
where ai_review_id is not null;;
