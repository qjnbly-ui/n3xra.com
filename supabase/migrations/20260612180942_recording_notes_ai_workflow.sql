alter table public.meeting_recordings
  add column if not exists selected_template_id uuid references public.app_documents (id) on delete set null,
  add column if not exists notes_content_json jsonb not null default '{"type":"doc","content":[{"type":"paragraph"}]}'::jsonb,
  add column if not exists notes_plain_text text,
  add column if not exists notes_updated_at timestamptz,
  add column if not exists ai_review_status text not null default 'not_started',
  add column if not exists ai_review_json jsonb not null default '{}'::jsonb,
  add column if not exists ai_reviewed_at timestamptz,
  add column if not exists ai_draft_document_id uuid references public.app_documents (id) on delete set null,
  add column if not exists final_document_id uuid references public.app_documents (id) on delete set null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meeting_recordings_notes_content_json_object_check'
  ) then
    alter table public.meeting_recordings
      add constraint meeting_recordings_notes_content_json_object_check
      check (jsonb_typeof(notes_content_json) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'meeting_recordings_ai_review_json_object_check'
  ) then
    alter table public.meeting_recordings
      add constraint meeting_recordings_ai_review_json_object_check
      check (jsonb_typeof(ai_review_json) = 'object');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'meeting_recordings_ai_review_status_check'
  ) then
    alter table public.meeting_recordings
      add constraint meeting_recordings_ai_review_status_check
      check (ai_review_status in ('not_started', 'processing', 'ready', 'failed'));
  end if;
end $$;

create index if not exists meeting_recordings_selected_template_id_idx
on public.meeting_recordings (selected_template_id);

create index if not exists meeting_recordings_ai_draft_document_id_idx
on public.meeting_recordings (ai_draft_document_id);

create index if not exists meeting_recordings_final_document_id_idx
on public.meeting_recordings (final_document_id);

alter table public.records_ai_usage_events
  drop constraint if exists records_ai_usage_events_feature_check;

alter table public.records_ai_usage_events
  add constraint records_ai_usage_events_feature_check
  check (feature in ('help', 'search', 'recording_notes'));
