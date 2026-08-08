-- Keep mobile-store reviewers out of platform_admins so legacy admin checks
-- cannot accidentally treat a reviewer as a full administrator.
alter table public.platform_admin_invites
drop constraint if exists platform_admin_invites_role_check;

alter table public.platform_admin_invites
add constraint platform_admin_invites_role_check
check (role in ('admin', 'reviewer'));

create table public.platform_app_reviewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  status text not null default 'active'
    check (status in ('active', 'revoked')),
  invited_by_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index platform_app_reviewers_email_idx
on public.platform_app_reviewers (lower(email));

alter table public.platform_app_reviewers enable row level security;

revoke all on table public.platform_app_reviewers from anon, authenticated;
grant all on table public.platform_app_reviewers to service_role;

comment on table public.platform_app_reviewers is
  'Isolated Apple and Google app-review identities. Membership never grants platform administration.';

create or replace function public.is_platform_reviewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.platform_app_reviewers
    where user_id = (select auth.uid())
      and status = 'active'
  );
$$;

revoke all on function public.is_platform_reviewer() from public;
grant execute on function public.is_platform_reviewer() to authenticated;

create table public.admin_review_notifications (
  id uuid primary key default gen_random_uuid(),
  reviewer_user_id uuid not null references auth.users (id) on delete cascade,
  seed_key text not null,
  title text not null,
  summary text not null default '',
  priority text not null default 'activity'
    check (priority in ('important', 'activity', 'system')),
  product text not null default 'platform',
  action_url text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reviewer_user_id, seed_key)
);

create index admin_review_notifications_inbox_idx
on public.admin_review_notifications (reviewer_user_id, created_at desc);

alter table public.admin_review_notifications enable row level security;

create policy "admin_review_notifications_select_own"
on public.admin_review_notifications
for select
to authenticated
using (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
);

create policy "admin_review_notifications_update_own"
on public.admin_review_notifications
for update
to authenticated
using (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
)
with check (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
);

revoke all on table public.admin_review_notifications from anon, authenticated;
grant select on table public.admin_review_notifications to authenticated;
grant update (read_at) on table public.admin_review_notifications to authenticated;
grant all on table public.admin_review_notifications to service_role;

comment on table public.admin_review_notifications is
  'Synthetic, per-user notifications for Apple and Google app review accounts. Never contains live platform data.';

create table public.admin_review_push_devices (
  id uuid primary key default gen_random_uuid(),
  reviewer_user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  unique (reviewer_user_id, expo_push_token)
);

create index admin_review_push_devices_active_idx
on public.admin_review_push_devices (reviewer_user_id, last_seen_at desc)
where disabled_at is null;

alter table public.admin_review_push_devices enable row level security;

create policy "admin_review_push_devices_insert_own"
on public.admin_review_push_devices
for insert
to authenticated
with check (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
);

create policy "admin_review_push_devices_update_own"
on public.admin_review_push_devices
for update
to authenticated
using (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
)
with check (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
);

create policy "admin_review_push_devices_delete_own"
on public.admin_review_push_devices
for delete
to authenticated
using (
  reviewer_user_id = (select auth.uid())
  and (select public.is_platform_reviewer())
);

revoke all on table public.admin_review_push_devices from anon, authenticated;
grant insert, update, delete on table public.admin_review_push_devices to authenticated;
grant all on table public.admin_review_push_devices to service_role;

comment on table public.admin_review_push_devices is
  'Isolated Expo push tokens for app reviewers; live admin notification dispatchers must not read this table.';
