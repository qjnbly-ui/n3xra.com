create table if not exists public.admin_notification_delivery_settings (
  id text primary key default 'primary' check (id = 'primary'),
  email_enabled boolean not null default true,
  sms_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by_user_id uuid references auth.users(id) on delete set null
);

alter table public.admin_notification_delivery_settings enable row level security;

insert into public.admin_notification_delivery_settings (id, email_enabled, sms_enabled)
values ('primary', true, true)
on conflict (id) do nothing;

drop policy if exists "admin_notification_delivery_settings_select_admin" on public.admin_notification_delivery_settings;
create policy "admin_notification_delivery_settings_select_admin"
on public.admin_notification_delivery_settings
for select
to authenticated
using ((select public.is_platform_admin()));

drop policy if exists "admin_notification_delivery_settings_update_admin" on public.admin_notification_delivery_settings;
create policy "admin_notification_delivery_settings_update_admin"
on public.admin_notification_delivery_settings
for update
to authenticated
using ((select public.is_platform_admin()))
with check (
  (select public.is_platform_admin())
  and updated_by_user_id = (select auth.uid())
);

revoke all on table public.admin_notification_delivery_settings from public, anon, authenticated;
grant select on table public.admin_notification_delivery_settings to authenticated;
grant update (email_enabled, sms_enabled, updated_at, updated_by_user_id)
  on table public.admin_notification_delivery_settings to authenticated;
grant all on table public.admin_notification_delivery_settings to service_role;

alter table public.admin_notifications
  drop constraint if exists admin_notifications_email_delivery_status_check,
  add constraint admin_notifications_email_delivery_status_check
    check (email_delivery_status in ('pending', 'queued', 'sending', 'sent', 'failed', 'unconfigured', 'disabled')),
  drop constraint if exists admin_notifications_sms_delivery_status_check,
  add constraint admin_notifications_sms_delivery_status_check
    check (sms_delivery_status in ('pending', 'queued', 'sending', 'sent', 'failed', 'unconfigured', 'disabled'));

comment on table public.admin_notification_delivery_settings is
  'Admin-controlled email and text delivery preferences for the private Admin Inbox.';
;
