create table if not exists public.careers_applications (
  id uuid primary key default gen_random_uuid(),
  account_user_id uuid references auth.users (id) on delete set null,
  full_name text not null,
  email text not null,
  location_timezone text,
  role_interest text not null,
  work_arrangement text not null default 'flexible',
  availability text,
  message text not null,
  portfolio_url text,
  github_url text,
  cv_url text,
  cv_storage_path text,
  cv_filename text,
  source_url text,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint careers_applications_email_check check (email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint careers_applications_role_check check (role_interest in ('frontend_developer', 'design', 'software_developer', 'internship', 'other')),
  constraint careers_applications_arrangement_check check (work_arrangement in ('remote', 'flexible', 'onsite')),
  constraint careers_applications_status_check check (status in ('new', 'reviewing', 'contacted', 'interviewing', 'talent_pool', 'declined', 'hired'))
);

create table if not exists public.careers_application_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.careers_applications (id) on delete cascade,
  author_user_id uuid references auth.users (id) on delete set null default auth.uid(),
  body text not null,
  source_url text,
  created_at timestamptz not null default now(),
  constraint careers_application_notes_body_check check (length(trim(body)) between 1 and 10000)
);

create index if not exists careers_applications_status_created_idx
on public.careers_applications (status, created_at desc);
create index if not exists careers_applications_account_user_idx
on public.careers_applications (account_user_id) where account_user_id is not null;
create index if not exists careers_application_notes_application_created_idx
on public.careers_application_notes (application_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('careers-files', 'careers-files', false, 10485760, array['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.careers_applications enable row level security;
alter table public.careers_application_notes enable row level security;

revoke all on public.careers_applications from anon;
revoke all on public.careers_application_notes from anon;
grant insert on public.careers_applications to anon;
grant select, insert, update on public.careers_applications to authenticated;
grant select, insert, update, delete on public.careers_application_notes to authenticated;
grant all on public.careers_applications, public.careers_application_notes to service_role;

create policy "careers_public_application_submit"
on public.careers_applications for insert to anon
with check (account_user_id is null and status = 'new');

create policy "careers_signed_in_application_submit"
on public.careers_applications for insert to authenticated
with check (account_user_id = (select auth.uid()) and status = 'new');

create policy "careers_admin_application_access"
on public.careers_applications for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "careers_admin_note_access"
on public.careers_application_notes for all to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "careers_files_submit"
on storage.objects for insert to anon, authenticated
with check (bucket_id = 'careers-files' and (storage.foldername(name))[1] = 'applications');

create policy "careers_files_admin_read"
on storage.objects for select to authenticated
using (bucket_id = 'careers-files' and (select public.is_platform_admin()));

drop trigger if exists careers_applications_set_updated_at on public.careers_applications;
create trigger careers_applications_set_updated_at
before update on public.careers_applications
for each row execute function public.set_updated_at();
