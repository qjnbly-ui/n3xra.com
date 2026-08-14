create table if not exists public.platform_support_requests (
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid references auth.users (id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  organization_name text,
  topic text not null,
  subject text not null,
  message text not null,
  status text not null default 'new',
  priority text not null default 'normal',
  assigned_to_user_id uuid references auth.users (id) on delete set null,
  internal_notes text,
  source text not null default 'website',
  email_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint platform_support_requests_status_check
    check (status in ('new', 'in_progress', 'waiting', 'resolved', 'closed')),
  constraint platform_support_requests_priority_check
    check (priority in ('low', 'normal', 'high', 'urgent'))
);

create index if not exists platform_support_requests_status_created_idx
on public.platform_support_requests (status, created_at desc);

create index if not exists platform_support_requests_email_created_idx
on public.platform_support_requests (lower(requester_email), created_at desc);

alter table public.platform_support_requests enable row level security;

revoke all on public.platform_support_requests from anon, authenticated;
grant all on public.platform_support_requests to service_role;
