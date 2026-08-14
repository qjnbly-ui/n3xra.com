alter table public.website_service_requests
  add column if not exists referral_code text,
  add column if not exists partner_application_id uuid references public.founding_partner_applications(id) on delete set null;

alter table public.partner_referrals
  add column if not exists website_request_id uuid references public.website_service_requests(id) on delete set null;

create unique index if not exists partner_referrals_website_request_unique
  on public.partner_referrals (website_request_id)
  where website_request_id is not null;

alter table public.website_service_requests
  drop constraint if exists website_service_requests_referral_code_format;

alter table public.website_service_requests
  add constraint website_service_requests_referral_code_format
  check (referral_code is null or referral_code ~ '^[A-Z0-9-]{4,24}$');

create or replace function private.validate_website_referral_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  matched_application_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.referral_code is distinct from new.referral_code
       or old.partner_application_id is distinct from new.partner_application_id then
      raise exception 'Referral attribution cannot be changed after submission.' using errcode = '23514';
    end if;
    return new;
  end if;

  new.partner_application_id := null;
  new.referral_code := nullif(upper(regexp_replace(btrim(coalesce(new.referral_code, '')), '[^A-Za-z0-9-]', '', 'g')), '');

  if new.referral_code is null then
    return new;
  end if;

  select application.id
    into matched_application_id
  from public.founding_partner_applications application
  where application.status = 'approved'
    and upper(application.referral_code) = new.referral_code
    and application.interested_products @> '["Website Referral Program"]'::jsonb
  limit 1;

  if matched_application_id is null then
    raise exception 'That partner referral code is not valid for website referrals.' using errcode = '23514';
  end if;

  new.partner_application_id := matched_application_id;
  return new;
end;
$$;

revoke all on function private.validate_website_referral_attribution() from public, anon, authenticated;

drop trigger if exists validate_website_referral_attribution on public.website_service_requests;
create trigger validate_website_referral_attribution
before insert or update of referral_code, partner_application_id
on public.website_service_requests
for each row execute function private.validate_website_referral_attribution();

create or replace function private.create_website_partner_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.partner_application_id is not null then
    insert into public.partner_referrals (
      partner_application_id,
      website_request_id,
      referred_name,
      referred_email,
      program,
      status,
      notes
    ) values (
      new.partner_application_id,
      new.id,
      new.contact_name,
      new.contact_email,
      'website_referral',
      'submitted',
      'Attributed automatically from website request code ' || new.referral_code
    ) on conflict (website_request_id) where website_request_id is not null do nothing;
  end if;
  return new;
end;
$$;

revoke all on function private.create_website_partner_referral() from public, anon, authenticated;

drop trigger if exists create_website_partner_referral on public.website_service_requests;
create trigger create_website_partner_referral
after insert on public.website_service_requests
for each row execute function private.create_website_partner_referral();;
