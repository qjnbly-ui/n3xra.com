alter table public.organizations
  add column if not exists records_default_minutes_style text not null default 'standard';

alter table public.organizations
  drop constraint if exists organizations_records_default_minutes_style_check;

alter table public.organizations
  add constraint organizations_records_default_minutes_style_check
  check (records_default_minutes_style in ('brief', 'standard', 'detailed'));

alter table public.meeting_recordings
  add column if not exists minutes_style text;

alter table public.meeting_recordings
  drop constraint if exists meeting_recordings_minutes_style_check;

alter table public.meeting_recordings
  add constraint meeting_recordings_minutes_style_check
  check (minutes_style is null or minutes_style in ('brief', 'standard', 'detailed'));;
