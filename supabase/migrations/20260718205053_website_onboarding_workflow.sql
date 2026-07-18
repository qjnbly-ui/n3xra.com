create table public.website_onboardings (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique references public.website_service_requests (id) on delete cascade,
  proposal_id uuid not null unique references public.website_proposals (id) on delete cascade,
  client_user_id uuid not null references auth.users (id) on delete cascade,
  status text not null default 'not_started',
  unlocked_by_user_id uuid not null references auth.users (id) on delete restrict default auth.uid(),
  submitted_at timestamptz,
  reviewed_by_user_id uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  admin_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_onboardings_status_check
    check (status in ('not_started', 'in_progress', 'submitted', 'needs_changes', 'approved', 'archived'))
);

create table public.website_onboarding_responses (
  onboarding_id uuid primary key references public.website_onboardings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  form_version integer not null default 1,
  answers jsonb not null default '{}'::jsonb,
  completion_percent integer not null default 0,
  last_section text not null default 'business',
  status text not null default 'draft',
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint website_onboarding_responses_answers_object_check
    check (jsonb_typeof(answers) = 'object'),
  constraint website_onboarding_responses_completion_check
    check (completion_percent between 0 and 100),
  constraint website_onboarding_responses_status_check
    check (status in ('draft', 'submitted'))
);

create table public.website_onboarding_files (
  id uuid primary key default gen_random_uuid(),
  onboarding_id uuid not null references public.website_onboardings (id) on delete cascade,
  uploaded_by_user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  category text not null default 'other',
  storage_bucket text not null default 'website-onboarding-private',
  storage_path text not null unique,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  note text,
  created_at timestamptz not null default now(),
  constraint website_onboarding_files_category_check
    check (category in ('logo', 'brand', 'photo', 'content', 'document', 'legal', 'other')),
  constraint website_onboarding_files_bucket_check
    check (storage_bucket = 'website-onboarding-private'),
  constraint website_onboarding_files_size_check
    check (size_bytes is null or size_bytes between 0 and 26214400),
  constraint website_onboarding_files_path_check
    check (
      split_part(storage_path, '/', 1)::uuid = onboarding_id
      and split_part(storage_path, '/', 2)::uuid = uploaded_by_user_id
    )
);

create index website_onboardings_client_created_idx
on public.website_onboardings (client_user_id, created_at desc);

create index website_onboardings_status_created_idx
on public.website_onboardings (status, created_at desc);

create index website_onboardings_unlocked_by_idx
on public.website_onboardings (unlocked_by_user_id);

create index website_onboardings_reviewed_by_idx
on public.website_onboardings (reviewed_by_user_id)
where reviewed_by_user_id is not null;

create index website_onboarding_responses_user_idx
on public.website_onboarding_responses (user_id);

create index website_onboarding_files_onboarding_created_idx
on public.website_onboarding_files (onboarding_id, created_at desc);

create index website_onboarding_files_uploaded_by_idx
on public.website_onboarding_files (uploaded_by_user_id);

drop trigger if exists website_onboardings_set_updated_at on public.website_onboardings;
create trigger website_onboardings_set_updated_at
before update on public.website_onboardings
for each row execute function public.set_updated_at();

drop trigger if exists website_onboarding_responses_set_updated_at on public.website_onboarding_responses;
create trigger website_onboarding_responses_set_updated_at
before update on public.website_onboarding_responses
for each row execute function public.set_updated_at();

create or replace function private.initialize_website_onboarding_response()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.website_onboarding_responses (onboarding_id, user_id)
  values (new.id, new.client_user_id);
  return new;
end;
$$;

revoke all on function private.initialize_website_onboarding_response() from public;

drop trigger if exists website_onboardings_initialize_response on public.website_onboardings;
create trigger website_onboardings_initialize_response
after insert on public.website_onboardings
for each row execute function private.initialize_website_onboarding_response();

create or replace function private.sync_website_onboarding_response_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.user_id <> (select auth.uid()) and not (select public.is_platform_admin()) then
    raise exception 'This onboarding response does not belong to the signed-in account.';
  end if;

  if new.status = 'submitted' then
    update public.website_onboardings
    set
      status = 'submitted',
      submitted_at = coalesce(new.submitted_at, now())
    where id = new.onboarding_id;
  elsif old.status = 'draft' then
    update public.website_onboardings
    set status = 'in_progress'
    where id = new.onboarding_id
      and status in ('not_started', 'needs_changes');
  end if;
  return new;
end;
$$;

revoke all on function private.sync_website_onboarding_response_status() from public;

drop trigger if exists website_onboarding_responses_sync_status on public.website_onboarding_responses;
create trigger website_onboarding_responses_sync_status
after update on public.website_onboarding_responses
for each row execute function private.sync_website_onboarding_response_status();

alter table public.website_onboardings enable row level security;
alter table public.website_onboarding_responses enable row level security;
alter table public.website_onboarding_files enable row level security;

revoke all on public.website_onboardings from anon;
revoke all on public.website_onboarding_responses from anon;
revoke all on public.website_onboarding_files from anon;

grant select, insert, update on public.website_onboardings to authenticated;
grant select, insert, update on public.website_onboarding_responses to authenticated;
grant select, insert, delete on public.website_onboarding_files to authenticated;

grant all on public.website_onboardings to service_role;
grant all on public.website_onboarding_responses to service_role;
grant all on public.website_onboarding_files to service_role;

create policy "website_onboardings_select"
on public.website_onboardings
for select
to authenticated
using (
  client_user_id = (select auth.uid())
  or (select public.is_platform_admin())
);

create policy "website_onboardings_admin_insert"
on public.website_onboardings
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  and exists (
    select 1
    from public.website_proposals proposal
    where proposal.id = proposal_id
      and proposal.request_id = request_id
      and proposal.client_user_id = client_user_id
      and proposal.status = 'approved'
  )
);

create policy "website_onboardings_admin_update"
on public.website_onboardings
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create policy "website_onboarding_responses_select"
on public.website_onboarding_responses
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_platform_admin())
);

create policy "website_onboarding_responses_admin_insert"
on public.website_onboarding_responses
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  and exists (
    select 1
    from public.website_onboardings onboarding
    where onboarding.id = onboarding_id
      and onboarding.client_user_id = user_id
  )
);

create policy "website_onboarding_responses_update"
on public.website_onboarding_responses
for update
to authenticated
using (
  (select public.is_platform_admin())
  or (
    user_id = (select auth.uid())
    and status = 'draft'
    and exists (
      select 1
      from public.website_onboardings onboarding
      where onboarding.id = onboarding_id
        and onboarding.client_user_id = (select auth.uid())
        and onboarding.status in ('not_started', 'in_progress', 'needs_changes')
    )
  )
)
with check (
  (select public.is_platform_admin())
  or (
    user_id = (select auth.uid())
    and status in ('draft', 'submitted')
    and exists (
      select 1
      from public.website_onboardings onboarding
      where onboarding.id = onboarding_id
        and onboarding.client_user_id = (select auth.uid())
        and onboarding.status in ('not_started', 'in_progress', 'needs_changes')
    )
  )
);

create policy "website_onboarding_files_select"
on public.website_onboarding_files
for select
to authenticated
using (
  exists (
    select 1
    from public.website_onboardings onboarding
    where onboarding.id = onboarding_id
      and (
        onboarding.client_user_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  )
);

create policy "website_onboarding_files_insert"
on public.website_onboarding_files
for insert
to authenticated
with check (
  uploaded_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.website_onboardings onboarding
    where onboarding.id = onboarding_id
      and onboarding.client_user_id = (select auth.uid())
      and onboarding.status in ('not_started', 'in_progress', 'needs_changes')
  )
);

create policy "website_onboarding_files_delete"
on public.website_onboarding_files
for delete
to authenticated
using (
  (select public.is_platform_admin())
  or (
    uploaded_by_user_id = (select auth.uid())
    and exists (
      select 1
      from public.website_onboardings onboarding
      where onboarding.id = onboarding_id
        and onboarding.client_user_id = (select auth.uid())
        and onboarding.status in ('not_started', 'in_progress', 'needs_changes')
    )
  )
);

create or replace function public.onboarding_storage_path_id(storage_path text)
returns uuid
language sql
stable
set search_path = ''
as $$
  select case
    when split_part(storage_path, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then split_part(storage_path, '/', 1)::uuid
    else null
  end;
$$;

revoke all on function public.onboarding_storage_path_id(text) from public;
grant execute on function public.onboarding_storage_path_id(text) to authenticated, service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'website-onboarding-private',
  'website-onboarding-private',
  false,
  26214400,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/svg+xml',
    'application/pdf',
    'application/zip',
    'text/plain',
    'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "website_onboarding_storage_select"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'website-onboarding-private'
  and exists (
    select 1
    from public.website_onboardings onboarding
    where onboarding.id = public.onboarding_storage_path_id(name)
      and (
        onboarding.client_user_id = (select auth.uid())
        or (select public.is_platform_admin())
      )
  )
);

create policy "website_onboarding_storage_insert"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'website-onboarding-private'
  and owner_id = (select auth.uid()::text)
  and (storage.foldername(name))[2] = (select auth.uid()::text)
  and exists (
    select 1
    from public.website_onboardings onboarding
    where onboarding.id = public.onboarding_storage_path_id(name)
      and onboarding.client_user_id = (select auth.uid())
      and onboarding.status in ('not_started', 'in_progress', 'needs_changes')
  )
);

create policy "website_onboarding_storage_delete"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'website-onboarding-private'
  and (
    (select public.is_platform_admin())
    or (
      owner_id = (select auth.uid()::text)
      and exists (
        select 1
        from public.website_onboardings onboarding
        where onboarding.id = public.onboarding_storage_path_id(name)
          and onboarding.client_user_id = (select auth.uid())
          and onboarding.status in ('not_started', 'in_progress', 'needs_changes')
      )
    )
  )
);
