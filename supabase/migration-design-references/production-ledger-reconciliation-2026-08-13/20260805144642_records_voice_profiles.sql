create table if not exists public.records_voice_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null default 'pyannote' check (provider = 'pyannote'),
  provider_model text not null default 'precision-2' check (char_length(trim(provider_model)) between 1 and 80),
  status text not null default 'processing' check (status in ('processing', 'enrolled', 'failed', 'revoked')),
  voiceprint text,
  provider_job_id text,
  consent_version text not null default 'records-voice-profile-v1',
  consented_at timestamptz not null,
  enrolled_at timestamptz,
  revoked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint records_voice_profiles_state_check check (
    (status = 'processing' and voiceprint is null and revoked_at is null)
    or (status = 'enrolled' and voiceprint is not null and enrolled_at is not null and revoked_at is null)
    or (status = 'failed' and voiceprint is null and revoked_at is null)
    or (status = 'revoked' and voiceprint is null and revoked_at is not null)
  )
);

create index if not exists records_voice_profiles_status_idx
  on public.records_voice_profiles (status, updated_at desc);

drop trigger if exists records_voice_profiles_set_updated_at on public.records_voice_profiles;
create trigger records_voice_profiles_set_updated_at
before update on public.records_voice_profiles
for each row execute function public.set_updated_at();

alter table public.records_voice_profiles enable row level security;

revoke all on table public.records_voice_profiles from public, anon, authenticated;
grant select, insert, update, delete on table public.records_voice_profiles to service_role;

comment on table public.records_voice_profiles is
  'Server-only biometric voiceprints used to identify consenting N3XRA Records speakers. Raw enrollment audio is not stored here.';
comment on column public.records_voice_profiles.voiceprint is
  'Sensitive pyannoteAI biometric voice signature. Never expose through client-side Data API access.';
