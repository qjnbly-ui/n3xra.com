alter table public.organizations
  add column if not exists records_speaker_detection_enabled boolean not null default true;

comment on column public.organizations.records_speaker_detection_enabled is
  'When enabled, new meeting transcripts are diarized into generic speakers and matched to consenting enrolled voice profiles when available.';
