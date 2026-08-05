alter table public.meeting_recordings
  add column if not exists transcript_timing_json jsonb not null default '{}'::jsonb,
  add column if not exists speaker_transcript_text text,
  add column if not exists speaker_identification_status text not null default 'not_started',
  add column if not exists speaker_identification_job_id text,
  add column if not exists speaker_identification_model text,
  add column if not exists speaker_identification_threshold numeric(5, 2),
  add column if not exists speaker_identification_json jsonb not null default '{}'::jsonb,
  add column if not exists speaker_identification_error text,
  add column if not exists speaker_identified_at timestamptz,
  add column if not exists speaker_identification_updated_at timestamptz;

alter table public.meeting_recordings
  drop constraint if exists meeting_recordings_speaker_identification_status_check,
  add constraint meeting_recordings_speaker_identification_status_check
    check (speaker_identification_status in ('not_started', 'processing', 'ready', 'skipped', 'failed')),
  drop constraint if exists meeting_recordings_transcript_timing_json_object_check,
  add constraint meeting_recordings_transcript_timing_json_object_check
    check (jsonb_typeof(transcript_timing_json) = 'object'),
  drop constraint if exists meeting_recordings_speaker_identification_json_object_check,
  add constraint meeting_recordings_speaker_identification_json_object_check
    check (jsonb_typeof(speaker_identification_json) = 'object'),
  drop constraint if exists meeting_recordings_speaker_identification_threshold_check,
  add constraint meeting_recordings_speaker_identification_threshold_check
    check (speaker_identification_threshold is null or speaker_identification_threshold between 0 and 100);

comment on column public.meeting_recordings.transcript_timing_json is
  'Server-produced Groq word and segment timestamps used to align transcript text with speaker turns.';
comment on column public.meeting_recordings.speaker_identification_json is
  'Sanitized speaker names, confidence, and utterance timestamps. Never stores biometric voiceprints.';
