create table public.investment_interest_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  email text not null check (email = lower(trim(email)) and char_length(email) between 3 and 320),
  connection_type text
    check (connection_type is null or connection_type in ('customer', 'partner', 'team', 'community', 'other')),
  email_updates boolean not null default true,
  status text not null default 'interested'
    check (status in ('interested', 'withdrawn')),
  acknowledged_not_offering_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  withdrawn_at timestamptz,
  updated_at timestamptz not null default now(),
  check (
    (status = 'interested' and withdrawn_at is null)
    or (status = 'withdrawn' and withdrawn_at is not null)
  )
);

create unique index investment_interest_profiles_email_idx
  on public.investment_interest_profiles (lower(email));

create index investment_interest_profiles_status_submitted_idx
  on public.investment_interest_profiles (status, submitted_at desc);

create trigger investment_interest_profiles_set_updated_at
before update on public.investment_interest_profiles
for each row execute function public.set_updated_at();

alter table public.investment_interest_profiles enable row level security;

create policy "investment_interest_select_own_or_admin"
on public.investment_interest_profiles
for select
to authenticated
using (
  (select auth.uid()) = user_id
  or (select public.is_platform_admin())
);

create policy "investment_interest_insert_own"
on public.investment_interest_profiles
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and lower(email) = lower(coalesce(((select auth.jwt()) ->> 'email'), ''))
);

create policy "investment_interest_update_own_or_admin"
on public.investment_interest_profiles
for update
to authenticated
using (
  (select auth.uid()) = user_id
  or (select public.is_platform_admin())
)
with check (
  (
    (select auth.uid()) = user_id
    and lower(email) = lower(coalesce(((select auth.jwt()) ->> 'email'), ''))
  )
  or (select public.is_platform_admin())
);

revoke all on table public.investment_interest_profiles from anon;
grant select, insert, update on table public.investment_interest_profiles to authenticated;
grant all on table public.investment_interest_profiles to service_role;
