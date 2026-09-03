create table if not exists public.maps_access_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  requester_email text not null,
  status text not null default 'pending',
  admin_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  requested_at timestamptz not null default now(),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint maps_access_requests_status_check
    check (status in ('pending', 'approved', 'declined')),
  constraint maps_access_requests_email_check
    check (char_length(trim(requester_email)) between 3 and 320),
  constraint maps_access_requests_admin_note_check
    check (admin_note is null or char_length(admin_note) <= 2000),
  constraint maps_access_requests_review_check check (
    (status = 'pending' and reviewed_at is null and reviewed_by is null)
    or (status in ('approved', 'declined') and reviewed_at is not null and reviewed_by is not null)
  )
);

create index if not exists maps_access_requests_status_requested_idx
  on public.maps_access_requests (status, requested_at desc);
create index if not exists maps_access_requests_reviewed_by_idx
  on public.maps_access_requests (reviewed_by)
  where reviewed_by is not null;

drop trigger if exists maps_access_requests_set_updated_at on public.maps_access_requests;
create trigger maps_access_requests_set_updated_at
before update on public.maps_access_requests
for each row execute function public.set_updated_at();

alter table public.maps_access_requests enable row level security;
revoke all on public.maps_access_requests from public, anon, authenticated;
grant select on public.maps_access_requests to authenticated;
grant update (status, admin_note, reviewed_by, reviewed_at) on public.maps_access_requests to authenticated;
grant all on public.maps_access_requests to service_role;

drop policy if exists "maps_access_requests_select" on public.maps_access_requests;
create policy "maps_access_requests_select"
on public.maps_access_requests
for select
to authenticated
using (
  user_id = (select auth.uid())
  or (select public.is_platform_admin())
);

drop policy if exists "maps_access_requests_admin_update" on public.maps_access_requests;
create policy "maps_access_requests_admin_update"
on public.maps_access_requests
for update
to authenticated
using ((select public.is_platform_admin()))
with check ((select public.is_platform_admin()));

create or replace function public.maps_request_early_access()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  requesting_user_id uuid := auth.uid();
  requesting_email text;
  access_request public.maps_access_requests%rowtype;
begin
  if requesting_user_id is null then
    raise exception 'Sign in before requesting Maps access.' using errcode = '42501';
  end if;

  select nullif(trim(user_record.email), '')
  into requesting_email
  from auth.users user_record
  where user_record.id = requesting_user_id;

  if requesting_email is null then
    raise exception 'Your N3XRA account needs an email address before requesting Maps access.'
      using errcode = '22023';
  end if;

  insert into public.maps_access_requests (
    user_id,
    requester_email,
    status,
    admin_note,
    reviewed_by,
    reviewed_at,
    requested_at
  ) values (
    requesting_user_id,
    requesting_email,
    'pending',
    null,
    null,
    null,
    now()
  )
  on conflict (user_id) do update
  set requester_email = excluded.requester_email,
      status = case
        when public.maps_access_requests.status = 'approved' then 'approved'
        else 'pending'
      end,
      admin_note = case
        when public.maps_access_requests.status = 'approved' then public.maps_access_requests.admin_note
        else null
      end,
      reviewed_by = case
        when public.maps_access_requests.status = 'approved' then public.maps_access_requests.reviewed_by
        else null
      end,
      reviewed_at = case
        when public.maps_access_requests.status = 'approved' then public.maps_access_requests.reviewed_at
        else null
      end,
      requested_at = case
        when public.maps_access_requests.status = 'approved' then public.maps_access_requests.requested_at
        else now()
      end
  returning * into access_request;

  return jsonb_build_object(
    'id', access_request.id,
    'status', access_request.status,
    'requestedAt', access_request.requested_at,
    'reviewedAt', access_request.reviewed_at
  );
end;
$$;

revoke all on function public.maps_request_early_access() from public, anon;
grant execute on function public.maps_request_early_access() to authenticated;
