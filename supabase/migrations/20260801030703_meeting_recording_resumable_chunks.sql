alter table public.meeting_recordings
  drop constraint if exists meeting_recordings_status_check;

alter table public.meeting_recordings
  add constraint meeting_recordings_status_check
  check (status in (
    'created', 'recording', 'interrupted', 'recorded', 'uploading',
    'finalizing', 'uploaded', 'transcribing', 'ready', 'failed'
  ));

create table if not exists public.meeting_recording_chunks (
  id uuid primary key default gen_random_uuid(),
  meeting_recording_id uuid not null references public.meeting_recordings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  capture_session_id uuid not null,
  sequence_number integer not null,
  storage_path text not null unique,
  mime_type text not null,
  file_size bigint not null,
  checksum_sha256 text,
  captured_started_at timestamptz not null,
  captured_ended_at timestamptz not null,
  status text not null default 'uploaded',
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_recording_chunks_sequence_check check (sequence_number >= 0),
  constraint meeting_recording_chunks_size_check check (file_size > 0),
  constraint meeting_recording_chunks_time_check check (captured_ended_at >= captured_started_at),
  constraint meeting_recording_chunks_status_check check (status in ('uploaded', 'assembled')),
  constraint meeting_recording_chunks_recording_sequence_uidx unique (meeting_recording_id, sequence_number)
);

create table if not exists public.meeting_recording_interruptions (
  id uuid primary key default gen_random_uuid(),
  meeting_recording_id uuid not null references public.meeting_recordings (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by_user_id uuid not null references auth.users (id) on delete cascade,
  interruption_number integer not null,
  reason text not null default 'microphone_interrupted',
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint meeting_recording_interruptions_number_check check (interruption_number > 0),
  constraint meeting_recording_interruptions_time_check check (ended_at is null or ended_at >= started_at),
  constraint meeting_recording_interruptions_recording_number_uidx unique (meeting_recording_id, interruption_number)
);

create index if not exists meeting_recording_chunks_recording_sequence_idx
  on public.meeting_recording_chunks (meeting_recording_id, sequence_number);
create index if not exists meeting_recording_chunks_expiry_idx
  on public.meeting_recording_chunks (expires_at);
create index if not exists meeting_recording_interruptions_recording_idx
  on public.meeting_recording_interruptions (meeting_recording_id, interruption_number);

drop trigger if exists meeting_recording_chunks_set_updated_at on public.meeting_recording_chunks;
create trigger meeting_recording_chunks_set_updated_at
before update on public.meeting_recording_chunks
for each row execute function public.set_updated_at();

drop trigger if exists meeting_recording_interruptions_set_updated_at on public.meeting_recording_interruptions;
create trigger meeting_recording_interruptions_set_updated_at
before update on public.meeting_recording_interruptions
for each row execute function public.set_updated_at();

alter table public.meeting_recording_chunks enable row level security;
alter table public.meeting_recording_interruptions enable row level security;

grant select, insert, update, delete on public.meeting_recording_chunks to authenticated;
grant select, insert, update, delete on public.meeting_recording_interruptions to authenticated;

create policy "meeting_recording_chunks_select_policy"
on public.meeting_recording_chunks for select to authenticated
using (public.can_view_records_recordings(organization_id));

create policy "meeting_recording_chunks_insert_policy"
on public.meeting_recording_chunks for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and public.can_change_records_recordings(organization_id)
  and exists (
    select 1 from public.meeting_recordings mr
    where mr.id = meeting_recording_id and mr.organization_id = organization_id
  )
);

create policy "meeting_recording_chunks_update_policy"
on public.meeting_recording_chunks for update to authenticated
using (public.can_change_records_recordings(organization_id))
with check (public.can_change_records_recordings(organization_id));

create policy "meeting_recording_chunks_delete_policy"
on public.meeting_recording_chunks for delete to authenticated
using (public.can_change_records_recordings(organization_id));

create policy "meeting_recording_interruptions_select_policy"
on public.meeting_recording_interruptions for select to authenticated
using (public.can_view_records_recordings(organization_id));

create policy "meeting_recording_interruptions_insert_policy"
on public.meeting_recording_interruptions for insert to authenticated
with check (
  created_by_user_id = (select auth.uid())
  and public.can_change_records_recordings(organization_id)
  and exists (
    select 1 from public.meeting_recordings mr
    where mr.id = meeting_recording_id and mr.organization_id = organization_id
  )
);

create policy "meeting_recording_interruptions_update_policy"
on public.meeting_recording_interruptions for update to authenticated
using (public.can_change_records_recordings(organization_id))
with check (public.can_change_records_recordings(organization_id));

create policy "meeting_recording_interruptions_delete_policy"
on public.meeting_recording_interruptions for delete to authenticated
using (public.can_change_records_recordings(organization_id));
