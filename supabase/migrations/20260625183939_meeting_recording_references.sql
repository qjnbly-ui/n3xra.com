create table if not exists public.meeting_recording_references (
  id uuid primary key default gen_random_uuid(),
  meeting_recording_id uuid not null references public.meeting_recordings (id) on delete cascade,
  app_document_id uuid not null references public.app_documents (id) on delete cascade,
  reference_type text not null default 'supporting_document',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (meeting_recording_id, app_document_id),
  constraint meeting_recording_references_type_check
    check (reference_type in ('agenda', 'supporting_document')),
  constraint meeting_recording_references_sort_order_check check (sort_order >= 0)
);

create index if not exists meeting_recording_references_recording_idx
on public.meeting_recording_references (meeting_recording_id, sort_order);

create index if not exists meeting_recording_references_document_idx
on public.meeting_recording_references (app_document_id);

drop trigger if exists meeting_recording_references_set_updated_at on public.meeting_recording_references;
create trigger meeting_recording_references_set_updated_at
before update on public.meeting_recording_references
for each row execute procedure public.set_updated_at();

alter table public.meeting_recording_references enable row level security;

grant select, insert, update, delete on public.meeting_recording_references to authenticated;
grant select, insert, update, delete on public.meeting_recording_references to service_role;

drop policy if exists "meeting_recording_references_select_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_select_policy"
on public.meeting_recording_references
for select
to authenticated
using (
  exists (
    select 1
    from public.meeting_recordings mr
    where mr.id = meeting_recording_id
      and public.can_view_organization(mr.organization_id)
  )
);

drop policy if exists "meeting_recording_references_insert_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_insert_policy"
on public.meeting_recording_references
for insert
to authenticated
with check (
  exists (
    select 1
    from public.meeting_recordings mr
    join public.app_documents ad on ad.id = app_document_id
    where mr.id = meeting_recording_id
      and ad.organization_id = mr.organization_id
      and ad.document_kind = 'document'
      and ad.status <> 'archived'
      and public.can_manage_documents(mr.organization_id)
  )
);

drop policy if exists "meeting_recording_references_update_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_update_policy"
on public.meeting_recording_references
for update
to authenticated
using (
  exists (
    select 1
    from public.meeting_recordings mr
    where mr.id = meeting_recording_id
      and public.can_manage_documents(mr.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.meeting_recordings mr
    join public.app_documents ad on ad.id = app_document_id
    where mr.id = meeting_recording_id
      and ad.organization_id = mr.organization_id
      and ad.document_kind = 'document'
      and ad.status <> 'archived'
      and public.can_manage_documents(mr.organization_id)
  )
);

drop policy if exists "meeting_recording_references_delete_policy" on public.meeting_recording_references;
create policy "meeting_recording_references_delete_policy"
on public.meeting_recording_references
for delete
to authenticated
using (
  exists (
    select 1
    from public.meeting_recordings mr
    where mr.id = meeting_recording_id
      and public.can_manage_documents(mr.organization_id)
  )
);
