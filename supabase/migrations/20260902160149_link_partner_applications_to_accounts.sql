alter table public.founding_partner_applications
add column if not exists account_user_id uuid references auth.users(id) on delete set null;

create unique index if not exists founding_partner_applications_account_user_unique
on public.founding_partner_applications(account_user_id)
where account_user_id is not null;

create or replace function private.link_partner_application_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_user_id uuid;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  if new.account_user_id is not null then
    if not exists (
      select 1
      from auth.users as account
      where account.id = new.account_user_id
        and lower(account.email) = lower(new.email)
    ) then
      raise exception 'The partner application email must match the linked account email.';
    end if;
    return new;
  end if;

  select account.id
    into matched_user_id
  from auth.users as account
  where lower(account.email) = lower(new.email)
  limit 1;

  if matched_user_id is not null
     and not exists (
       select 1
       from public.founding_partner_applications as linked_application
       where linked_application.account_user_id = matched_user_id
         and linked_application.id <> new.id
     ) then
    new.account_user_id := matched_user_id;
  end if;

  return new;
end;
$$;

revoke all on function private.link_partner_application_account() from public, anon, authenticated;

drop trigger if exists founding_partner_applications_link_account on public.founding_partner_applications;
create trigger founding_partner_applications_link_account
before insert or update of email, status, account_user_id
on public.founding_partner_applications
for each row
execute function private.link_partner_application_account();

create or replace function private.link_new_user_partner_application()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_application_id uuid;
begin
  if new.email is null or exists (
    select 1
    from public.founding_partner_applications as linked_application
    where linked_application.account_user_id = new.id
  ) then
    return new;
  end if;

  select application.id
    into matched_application_id
  from public.founding_partner_applications as application
  where application.status = 'approved'
    and application.account_user_id is null
    and lower(application.email) = lower(new.email)
  order by application.approved_at desc nulls last, application.created_at desc
  limit 1;

  if matched_application_id is not null then
    update public.founding_partner_applications
    set account_user_id = new.id
    where id = matched_application_id;
  end if;

  return new;
end;
$$;

revoke all on function private.link_new_user_partner_application() from public, anon, authenticated;

drop trigger if exists auth_users_link_partner_application on auth.users;
create trigger auth_users_link_partner_application
after insert or update of email
on auth.users
for each row
execute function private.link_new_user_partner_application();

with approved_matches as (
  select
    application.id as application_id,
    account.id as account_user_id,
    row_number() over (
      partition by account.id
      order by application.approved_at desc nulls last, application.created_at desc
    ) as match_rank
  from public.founding_partner_applications as application
  join auth.users as account
    on lower(account.email) = lower(application.email)
  where application.status = 'approved'
    and application.account_user_id is null
)
update public.founding_partner_applications as application
set account_user_id = approved_matches.account_user_id
from approved_matches
where application.id = approved_matches.application_id
  and approved_matches.match_rank = 1
  and not exists (
    select 1
    from public.founding_partner_applications as already_linked
    where already_linked.account_user_id = approved_matches.account_user_id
  );

comment on column public.founding_partner_applications.account_user_id is
  'Explicit Supabase Auth account that owns this approved partner portal. Populated from the verified account email during approval or signup.';
