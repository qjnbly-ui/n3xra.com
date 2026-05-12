create table if not exists public.records_ai_usage_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  feature text not null,
  model text,
  prompt_tokens integer not null default 0,
  completion_tokens integer not null default 0,
  total_tokens integer not null default 0,
  created_at timestamptz not null default now(),
  constraint records_ai_usage_events_feature_check
    check (feature in ('help', 'search')),
  constraint records_ai_usage_events_token_check
    check (prompt_tokens >= 0 and completion_tokens >= 0 and total_tokens >= 0)
);

create index if not exists records_ai_usage_events_org_created_at_idx
on public.records_ai_usage_events (organization_id, created_at desc);

create index if not exists records_ai_usage_events_user_created_at_idx
on public.records_ai_usage_events (user_id, created_at desc);

alter table public.records_ai_usage_events enable row level security;

drop policy if exists "records_ai_usage_events_select_policy" on public.records_ai_usage_events;
create policy "records_ai_usage_events_select_policy"
on public.records_ai_usage_events
for select
using (public.can_view_organization(organization_id));
