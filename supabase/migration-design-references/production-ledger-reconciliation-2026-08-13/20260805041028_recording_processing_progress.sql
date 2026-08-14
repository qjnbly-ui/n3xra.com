alter table public.meeting_recordings
  add column if not exists processing_stage text,
  add column if not exists processing_progress smallint not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_updated_at timestamptz,
  add column if not exists processing_completed_at timestamptz;

alter table public.meeting_recordings
  drop constraint if exists meeting_recordings_processing_stage_check,
  add constraint meeting_recordings_processing_stage_check
    check (processing_stage is null or processing_stage in ('uploading', 'assembling', 'transcribing', 'complete', 'failed')),
  drop constraint if exists meeting_recordings_processing_progress_check,
  add constraint meeting_recordings_processing_progress_check
    check (processing_progress between 0 and 100);
