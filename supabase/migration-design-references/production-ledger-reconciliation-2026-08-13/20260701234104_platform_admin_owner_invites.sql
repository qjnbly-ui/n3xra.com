create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique
);

alter table public.platform_admins
add column if not exists role text not null default 'admin',
add column if not exists status text not null default 'active',
add column if not exists invited_by_user_id uuid references auth.users (id) on delete set null,
add column if not exists created_at timestamptz not null default now(),
add column if not exists updated_at timestamptz not null default now();

alter table public.platform_admins
drop constraint if exists platform_admins_role_check;

alter table public.platform_admins
add constraint platform_admins_role_check check (role in ('owner', 'admin'));

alter table public.platform_admins
drop constraint if exists platform_admins_status_check;

alter table public.platform_admins
add constraint platform_admins_status_check check (status in ('active', 'revoked'));

create table if not exists public.platform_admin_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  role text not null default 'admin',
  token_hash text not null unique,
  status text not null default 'pending',
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_by_user_id uuid references auth.users (id) on delete set null,
  redeemed_by_user_id uuid references auth.users (id) on delete set null,
  revoked_by_user_id uuid references auth.users (id) on delete set null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_admin_invites_role_check check (role in ('admin')),
  constraint platform_admin_invites_status_check check (status in ('pending', 'redeemed', 'revoked', 'expired'))
);

create index if not exists platform_admins_email_idx
on public.platform_admins (lower(email));

create index if not exists platform_admin_invites_email_created_idx
on public.platform_admin_invites (lower(email), created_at desc);

create index if not exists platform_admin_invites_status_created_idx
on public.platform_admin_invites (status, created_at desc);

insert into public.platform_admins (user_id, email, role, status)
select id, email, 'owner', 'active'
from auth.users
where lower(coalesce(email, '')) = 'quentin@n3xra.com'
on conflict (user_id) do update
set
  email = excluded.email,
  role = 'owner',
  status = 'active',
  updated_at = now();

insert into public.platform_admins (user_id, email, role, status)
select id, email, 'admin', 'active'
from auth.users
where lower(coalesce(email, '')) = 'quentin@quentinnichols.com'
on conflict (user_id) do update
set
  email = excluded.email,
  role = case when public.platform_admins.role = 'owner' then 'owner' else 'admin' end,
  status = 'active',
  updated_at = now();

create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'quentin@n3xra.com'
    or exists (
      select 1
      from public.platform_admins
      where user_id = auth.uid()
        and role = 'owner'
        and status = 'active'
    );
$$;

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'quentin@n3xra.com'
    or exists (
      select 1
      from public.platform_admins
      where user_id = auth.uid()
        and role in ('owner', 'admin')
        and status = 'active'
    );
$$;

revoke all on function public.is_platform_owner() from public;
grant execute on function public.is_platform_owner() to authenticated;

revoke all on function public.is_platform_admin() from public;
grant execute on function public.is_platform_admin() to authenticated;

alter table public.platform_admins enable row level security;
alter table public.platform_admin_invites enable row level security;

drop policy if exists "platform_admins_select_policy" on public.platform_admins;
create policy "platform_admins_select_policy"
on public.platform_admins
for select
to authenticated
using (public.is_platform_admin());

drop policy if exists "platform_admins_update_owner_policy" on public.platform_admins;
create policy "platform_admins_update_owner_policy"
on public.platform_admins
for update
to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner());

drop policy if exists "platform_admin_invites_select_owner_policy" on public.platform_admin_invites;
create policy "platform_admin_invites_select_owner_policy"
on public.platform_admin_invites
for select
to authenticated
using (public.is_platform_owner());

drop policy if exists "platform_admin_invites_insert_owner_policy" on public.platform_admin_invites;
create policy "platform_admin_invites_insert_owner_policy"
on public.platform_admin_invites
for insert
to authenticated
with check (public.is_platform_owner());

drop policy if exists "platform_admin_invites_update_owner_policy" on public.platform_admin_invites;
create policy "platform_admin_invites_update_owner_policy"
on public.platform_admin_invites
for update
to authenticated
using (public.is_platform_owner())
with check (public.is_platform_owner());
