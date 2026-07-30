-- Per-library controls for N3XRA Records Phone Meetings. The feature remains
-- internal: only platform administrators can update this configuration.

alter table public.organization_phone_meeting_settings
  add column if not exists allowed_start_roles text[] not null default array['account_admin', 'editor']::text[];

alter table public.organization_phone_meeting_settings
  drop constraint if exists organization_phone_meeting_settings_allowed_start_roles_check;

alter table public.organization_phone_meeting_settings
  add constraint organization_phone_meeting_settings_allowed_start_roles_check
  check (allowed_start_roles <@ array['account_admin', 'editor']::text[]);
