-- A meeting_recordings delete sets phone_meeting_sessions.meeting_recording_id
-- to null through its foreign key. That unlink must not re-queue an internal
-- retention job under the deleting user's RLS context.
drop trigger if exists phone_meeting_sessions_queue_retention_job on public.phone_meeting_sessions;
create trigger phone_meeting_sessions_queue_retention_job
after insert or update of retention_until, status
on public.phone_meeting_sessions
for each row execute function public.queue_phone_meeting_retention_job();
