-- Keep the public founding offer separate from partner referral attribution.
-- FREEBUILD is carried in offer_code and may coexist with a valid partner
-- referral_code entered by the client for attribution. The two benefits are
-- still kept separate by the proposal/billing workflow.
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
       or old.partner_application_id is distinct from new.partner_application_id
       or old.offer_code is distinct from new.offer_code then
      if old.partner_application_id is not null
         and new.partner_application_id is null
         and old.referral_code is not distinct from new.referral_code
         and old.offer_code is not distinct from new.offer_code
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
  new.offer_code := nullif(upper(regexp_replace(btrim(coalesce(new.offer_code, '')), '[^A-Za-z0-9-]', '', 'g')), '');
  new.referral_code := nullif(upper(regexp_replace(btrim(coalesce(new.referral_code, '')), '[^A-Za-z0-9-]', '', 'g')), '');

  -- The founding offer is an offer marker, not a partner referral code.
  if new.offer_code = 'FREEBUILD' then
    if new.referral_code = 'FREEBUILD' then
      raise exception 'The FREEBUILD code must be stored as the founding offer, not a partner referral.' using errcode = '23514';
    end if;
    if new.referral_code is null then
      return new;
    end if;
  elsif new.referral_code = 'FREEBUILD' then
    raise exception 'The FREEBUILD code must be submitted through the founding offer.' using errcode = '23514';
  elsif new.referral_code is null then
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

revoke all on function private.validate_website_referral_attribution() from public, anon, authenticated;;
