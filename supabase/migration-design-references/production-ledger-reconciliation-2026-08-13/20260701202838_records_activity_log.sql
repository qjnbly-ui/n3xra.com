create table if not exists public.records_activity_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_email text,
  actor_name text,
  action_type text not null,
  target_type text,
  target_id text,
  target_label text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint records_activity_log_action_type_check check (
    action_type in (
      'upload',
      'delete',
      'visibility_change',
      'invite_sent',
      'invite_redeemed',
      'ai_search_used',
      'billing_change'
    )
  ),
  constraint records_activity_log_metadata_object_check check (jsonb_typeof(metadata) = 'object')
);

create index if not exists records_activity_log_organization_created_idx
on public.records_activity_log (organization_id, created_at desc);

create index if not exists records_activity_log_action_created_idx
on public.records_activity_log (organization_id, action_type, created_at desc);

create index if not exists records_activity_log_actor_created_idx
on public.records_activity_log (organization_id, actor_user_id, created_at desc);

alter table public.records_activity_log enable row level security;

drop policy if exists "records_activity_log_select_policy" on public.records_activity_log;
create policy "records_activity_log_select_policy"
on public.records_activity_log
for select
to authenticated
using (
  public.is_platform_admin()
  or public.organization_role(organization_id) = 'account_admin'
);

drop policy if exists "records_activity_log_insert_policy" on public.records_activity_log;
create policy "records_activity_log_insert_policy"
on public.records_activity_log
for insert
to authenticated
with check (
  actor_user_id = auth.uid()
  and public.can_view_organization(organization_id)
);
