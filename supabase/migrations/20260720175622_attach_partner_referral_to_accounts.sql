alter table public.profiles
  add column if not exists referral_code text,
  add column if not exists partner_application_id uuid references public.founding_partner_applications(id) on delete set null,
  add column if not exists referral_attributed_at timestamptz;

alter table public.profiles
  drop constraint if exists profiles_referral_code_format;

alter table public.profiles
  add constraint profiles_referral_code_format
  check (referral_code is null or referral_code ~ '^[A-Z0-9-]{4,24}$');

create index if not exists profiles_partner_application_idx
  on public.profiles (partner_application_id)
  where partner_application_id is not null;

create or replace function private.attribute_profile_partner_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  normalized_code text;
  matched_application_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.referral_code is distinct from new.referral_code
       or old.partner_application_id is distinct from new.partner_application_id
       or old.referral_attributed_at is distinct from new.referral_attributed_at then
      raise exception 'Account referral attribution cannot be changed.';
    end if;
    return new;
  end if;

  normalized_code := nullif(
    upper(regexp_replace(btrim(coalesce(new.referral_code, '')), '[^A-Za-z0-9-]', '', 'g')),
    ''
  );

  new.referral_code := null;
  new.partner_application_id := null;
  new.referral_attributed_at := null;

  if normalized_code is null then
    return new;
  end if;

  select application.id
    into matched_application_id
  from public.founding_partner_applications as application
  where application.status = 'approved'
    and upper(application.referral_code) = normalized_code
  limit 1;

  if matched_application_id is null then
    raise exception 'Invalid partner referral code.';
  end if;

  new.referral_code := normalized_code;
  new.partner_application_id := matched_application_id;
  new.referral_attributed_at := now();
  return new;
end;
$$;

revoke all on function private.attribute_profile_partner_referral() from public, anon, authenticated;

drop trigger if exists profiles_attribute_partner_referral on public.profiles;
create trigger profiles_attribute_partner_referral
before insert or update of referral_code, partner_application_id, referral_attributed_at
on public.profiles
for each row
execute function private.attribute_profile_partner_referral();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, referral_code)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', null),
    nullif(new.raw_user_meta_data ->> 'referral_code', '')
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name),
        updated_at = now();

  if lower(coalesce(new.email, '')) = 'quentin@quentinnichols.com' then
    insert into public.platform_admins (user_id, email)
    values (new.id, new.email)
    on conflict (user_id) do update set email = excluded.email;
  end if;

  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;;
