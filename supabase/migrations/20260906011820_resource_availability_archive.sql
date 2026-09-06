-- Source exports are immutable history, separate from current availability.
create table public.ra_archive_batches (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ra_workspaces(id),
 source_sheet text not null,
 file_sha256 text not null check (file_sha256 ~ '^[a-f0-9]{64}$'),
 expected_rows integer not null check (expected_rows >= 0),
 verified boolean not null default false,
 metadata jsonb not null default '{}',
 imported_at timestamptz not null default now(),
 unique(workspace_id,file_sha256), unique(id,workspace_id)
);
create table public.ra_archived_reports (
 id uuid primary key default gen_random_uuid(),
 workspace_id uuid not null references public.ra_workspaces(id),
 batch_id uuid not null,
 source_sheet text not null,
 source_row integer not null check(source_row>0),
 record_hash text not null check(record_hash ~ '^[a-f0-9]{64}$'),
 occurrence integer not null default 1 check(occurrence>0),
 source_created_at timestamp without time zone,
 agency_name text,
 submitted_by text,
 raw jsonb not null check(jsonb_typeof(raw)='object'),
 foreign key(batch_id,workspace_id) references public.ra_archive_batches(id,workspace_id),
 unique(batch_id,source_row),
 unique(workspace_id,source_sheet,record_hash,occurrence)
);
create index ra_archived_reports_period on public.ra_archived_reports(workspace_id,source_created_at desc,id);
create index ra_archived_reports_agency on public.ra_archived_reports(workspace_id,agency_name,source_created_at desc);
create index ra_archived_reports_batch on public.ra_archived_reports(batch_id,workspace_id);
alter table public.ra_archive_batches enable row level security;
alter table public.ra_archived_reports enable row level security;
revoke all on public.ra_archive_batches,public.ra_archived_reports from public,anon,authenticated;
grant select on public.ra_archive_batches,public.ra_archived_reports to authenticated;
grant all on public.ra_archive_batches,public.ra_archived_reports to service_role;
create policy ra_archive_batches_read on public.ra_archive_batches for select to authenticated
 using(verified and resource_availability_private.access(workspace_id));
create policy ra_archived_reports_read on public.ra_archived_reports for select to authenticated
 using(resource_availability_private.access(workspace_id) and exists(select 1 from public.ra_archive_batches b where b.id=batch_id and b.workspace_id=ra_archived_reports.workspace_id and b.verified));
