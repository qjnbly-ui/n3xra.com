create table if not exists public.admin_voice_configuration (
  singleton boolean primary key default true check (singleton),
  twilio_api_key_sid text not null,
  twilio_api_key_secret text not null,
  twilio_twiml_app_sid text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint admin_voice_configuration_key_sid_check check (twilio_api_key_sid ~ '^SK[0-9a-fA-F]{32}$'),
  constraint admin_voice_configuration_app_sid_check check (twilio_twiml_app_sid ~ '^AP[0-9a-fA-F]{32}$')
);

alter table public.admin_voice_configuration enable row level security;
revoke all on table public.admin_voice_configuration from public, anon, authenticated;
grant select, insert, update on table public.admin_voice_configuration to service_role;

comment on table public.admin_voice_configuration is
  'Server-only Twilio Voice signing configuration. Never expose through a browser client.';
