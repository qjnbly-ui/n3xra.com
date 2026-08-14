-- Push tokens used by the N3XRA Admin mobile companion app.
create table if not exists public.admin_push_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text not null check (platform in ('ios', 'android')),
  last_seen_at timestamptz not null default now(),
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, expo_push_token)
);

create index if not exists admin_push_devices_active_idx
on public.admin_push_devices (user_id, last_seen_at desc)
where disabled_at is null;

alter table public.admin_push_devices enable row level security;

drop policy if exists "admin_push_devices_insert_own" on public.admin_push_devices;
create policy "admin_push_devices_insert_own"
on public.admin_push_devices
for insert to authenticated
with check (user_id = auth.uid() and public.is_platform_admin());

drop policy if exists "admin_push_devices_update_own" on public.admin_push_devices;
create policy "admin_push_devices_update_own"
on public.admin_push_devices
for update to authenticated
using (user_id = auth.uid() and public.is_platform_admin())
with check (user_id = auth.uid() and public.is_platform_admin());

drop policy if exists "admin_push_devices_delete_own" on public.admin_push_devices;
create policy "admin_push_devices_delete_own"
on public.admin_push_devices
for delete to authenticated
using (user_id = auth.uid() and public.is_platform_admin());

revoke all on table public.admin_push_devices from anon;
grant insert, update, delete on table public.admin_push_devices to authenticated;
grant select, insert, update, delete on table public.admin_push_devices to service_role;

comment on table public.admin_push_devices is 'Expo push tokens registered by platform-admin mobile devices; service_role reads this table when dispatching pushes.';
