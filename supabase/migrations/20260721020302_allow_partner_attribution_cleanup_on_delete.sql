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
      if old.partner_application_id is not null
         and new.partner_application_id is null
         and old.referral_code is not distinct from new.referral_code
         and not exists (
           select 1 from public.founding_partner_applications
           where id = old.partner_application_id
         ) then
        return new;
      end if;
      raise exception 'Referral attribution cannot be changed after submission.' using errcode = '23514';
    end if;
    return new;
  end if;

  new.partner_application_id := null;
  new.referral_code := nullif(upper(regexp_replace(btrim(coalesce(new.referral_code, '')), '[^A-Za-z0-9-]', '', 'g')), '');
  if new.referral_code is null then return new; end if;

  select application.id into matched_application_id
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
      if old.partner_application_id is not null
         and new.partner_application_id is null
         and old.referral_code is not distinct from new.referral_code
         and old.referral_attributed_at is not distinct from new.referral_attributed_at
         and not exists (
           select 1 from public.founding_partner_applications
           where id = old.partner_application_id
         ) then
        return new;
      end if;
      raise exception 'Account referral attribution cannot be changed.';
    end if;
    return new;
  end if;

  normalized_code := nullif(upper(regexp_replace(btrim(coalesce(new.referral_code, '')), '[^A-Za-z0-9-]', '', 'g')), '');
  new.referral_code := null;
  new.partner_application_id := null;
  new.referral_attributed_at := null;
  if normalized_code is null then return new; end if;

  select application.id into matched_application_id
  from public.founding_partner_applications as application
  where application.status = 'approved'
    and upper(application.referral_code) = normalized_code
  limit 1;

  if matched_application_id is null then raise exception 'Invalid partner referral code.'; end if;
  new.referral_code := normalized_code;
  new.partner_application_id := matched_application_id;
  new.referral_attributed_at := now();
  return new;
end;
$$;

revoke all on function private.validate_website_referral_attribution() from public, anon, authenticated;
revoke all on function private.attribute_profile_partner_referral() from public, anon, authenticated;
