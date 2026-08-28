alter table public.contact_card_profiles
  add column exchange_enabled boolean not null default true;

grant update (exchange_enabled)
on table public.contact_card_profiles
to authenticated;

create table public.contact_card_connections (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.contact_card_profiles(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  email text,
  phone_e164 text,
  company_name text not null default '',
  message text not null default '',
  private_note text not null default '',
  status text not null default 'new' check (status in ('new', 'contacted', 'archived')),
  source text not null default 'public_card' check (source in ('public_card')),
  privacy_notice_version text not null default '2026-08-28',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint contact_card_connections_name_check check (length(btrim(name)) between 1 and 180),
  constraint contact_card_connections_email_check check (email is null or email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
  constraint contact_card_connections_phone_check check (phone_e164 is null or phone_e164 ~ E'^\\+[1-9][0-9]{7,14}$'),
  constraint contact_card_connections_contact_method_check check (email is not null or phone_e164 is not null),
  constraint contact_card_connections_company_check check (length(company_name) <= 220),
  constraint contact_card_connections_message_check check (length(message) <= 800),
  constraint contact_card_connections_private_note_check check (length(private_note) <= 2000)
);

create index contact_card_connections_owner_submitted_idx
on public.contact_card_connections (owner_user_id, submitted_at desc);

create index contact_card_connections_profile_submitted_idx
on public.contact_card_connections (profile_id, submitted_at desc);

drop trigger if exists contact_card_connections_set_updated_at on public.contact_card_connections;
create trigger contact_card_connections_set_updated_at
before update on public.contact_card_connections
for each row execute function public.set_updated_at();

create or replace function public.guard_contact_card_connection_changes()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_owner uuid;
begin
  if tg_op = 'INSERT' then
    select owner_user_id into expected_owner
    from public.contact_card_profiles
    where id = new.profile_id;

    if expected_owner is null or new.owner_user_id is distinct from expected_owner then
      raise exception 'Contact Card connection ownership is invalid.' using errcode = '23514';
    end if;
    return new;
  end if;

  if coalesce((select public.is_platform_admin()), false) is false then
    if new.profile_id is distinct from old.profile_id
      or new.owner_user_id is distinct from old.owner_user_id
      or new.name is distinct from old.name
      or new.email is distinct from old.email
      or new.phone_e164 is distinct from old.phone_e164
      or new.company_name is distinct from old.company_name
      or new.message is distinct from old.message
      or new.source is distinct from old.source
      or new.privacy_notice_version is distinct from old.privacy_notice_version
      or new.submitted_at is distinct from old.submitted_at then
      raise exception 'Only connection status and private notes can be changed.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists contact_card_connections_guard_changes on public.contact_card_connections;
create trigger contact_card_connections_guard_changes
before insert or update on public.contact_card_connections
for each row execute function public.guard_contact_card_connection_changes();

revoke all on function public.guard_contact_card_connection_changes() from public, anon, authenticated;

alter table public.contact_card_connections enable row level security;

create policy "contact_card_connections_owner_select"
on public.contact_card_connections for select to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

create policy "contact_card_connections_owner_update"
on public.contact_card_connections for update to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()))
with check ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

create policy "contact_card_connections_owner_delete"
on public.contact_card_connections for delete to authenticated
using ((select auth.uid()) = owner_user_id or (select public.is_platform_admin()));

revoke all on table public.contact_card_connections from public, anon, authenticated;
grant select, delete on table public.contact_card_connections to authenticated;
grant update (status, private_note) on table public.contact_card_connections to authenticated;
grant all on table public.contact_card_connections to service_role;

create table if not exists private.contact_card_connection_rate_limits (
  key_hash text primary key,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint contact_card_connection_rate_key_check check (key_hash ~ '^[a-f0-9]{64}$'),
  constraint contact_card_connection_rate_count_check check (request_count >= 0)
);

revoke all on private.contact_card_connection_rate_limits from public, anon, authenticated;

create or replace function public.consume_contact_card_connection_rate_limit(
  input_key_hash text,
  input_limit integer default 8,
  input_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  current_count integer;
  current_time timestamptz := clock_timestamp();
begin
  if input_key_hash !~ '^[a-f0-9]{64}$'
    or input_limit < 1 or input_limit > 30
    or input_window_seconds < 60 or input_window_seconds > 86400 then
    raise exception 'Invalid Contact Card rate limit input';
  end if;

  insert into private.contact_card_connection_rate_limits as limits (
    key_hash, window_started_at, request_count, updated_at
  ) values (
    input_key_hash, current_time, 1, current_time
  )
  on conflict (key_hash) do update
  set
    window_started_at = case
      when limits.window_started_at <= current_time - make_interval(secs => input_window_seconds) then current_time
      else limits.window_started_at
    end,
    request_count = case
      when limits.window_started_at <= current_time - make_interval(secs => input_window_seconds) then 1
      else limits.request_count + 1
    end,
    updated_at = current_time
  returning request_count into current_count;

  return current_count <= input_limit;
end;
$$;

revoke all on function public.consume_contact_card_connection_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_contact_card_connection_rate_limit(text, integer, integer) to service_role;
