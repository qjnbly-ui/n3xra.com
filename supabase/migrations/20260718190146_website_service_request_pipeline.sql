create table if not exists public.website_service_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  contact_name text not null,
  business_name text not null,
  contact_email text not null,
  contact_phone text,
  project_type text not null default 'new_website',
  existing_website_url text,
  primary_goal text not null,
  audience text,
  requested_pages text[] not null default '{}'::text[],
  requested_features text[] not null default '{}'::text[],
  budget_range text,
  target_launch_date date,
  additional_notes text,
  status text not null default 'submitted',
  admin_notes text,
  reviewed_by_user_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_service_requests_project_type_check check (project_type in ('new_website', 'redesign', 'landing_page', 'ecommerce', 'maintenance', 'other')),
  constraint website_service_requests_status_check check (status in ('draft', 'submitted', 'reviewing', 'needs_info', 'qualified', 'declined', 'converted', 'archived')),
  constraint website_service_requests_email_check check (contact_email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')
);
create index if not exists website_service_requests_user_created_idx on public.website_service_requests (user_id, created_at desc);
create index if not exists website_service_requests_status_created_idx on public.website_service_requests (status, created_at desc);
create index if not exists website_service_requests_reviewed_by_idx on public.website_service_requests (reviewed_by_user_id);
drop trigger if exists website_service_requests_set_updated_at on public.website_service_requests;
create trigger website_service_requests_set_updated_at before update on public.website_service_requests for each row execute function public.set_updated_at();
alter table public.website_service_requests enable row level security;
revoke all on public.website_service_requests from anon;
grant select, insert, update on public.website_service_requests to authenticated;
grant all on public.website_service_requests to service_role;
drop policy if exists "website_service_requests_select" on public.website_service_requests;
create policy "website_service_requests_select" on public.website_service_requests for select to authenticated using (user_id = auth.uid() or public.is_platform_admin());
drop policy if exists "website_service_requests_insert" on public.website_service_requests;
create policy "website_service_requests_insert" on public.website_service_requests for insert to authenticated with check (user_id = auth.uid() and status in ('draft', 'submitted') and reviewed_by_user_id is null and reviewed_at is null);
drop policy if exists "website_service_requests_update" on public.website_service_requests;
create policy "website_service_requests_update" on public.website_service_requests for update to authenticated using (public.is_platform_admin() or (user_id = auth.uid() and status in ('draft', 'submitted', 'needs_info'))) with check (public.is_platform_admin() or (user_id = auth.uid() and status in ('draft', 'submitted') and reviewed_by_user_id is null and reviewed_at is null and admin_notes is null));;
