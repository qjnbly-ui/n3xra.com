alter table public.contact_card_entitlements
  add column premium_trial_started_at timestamptz,
  add column premium_trial_ends_at timestamptz,
  add constraint contact_card_entitlements_trial_window_check
    check (
      (premium_trial_started_at is null and premium_trial_ends_at is null)
      or (
        premium_trial_started_at is not null
        and premium_trial_ends_at = premium_trial_started_at + interval '7 days'
      )
    );

create or replace function public.guard_contact_card_connection_premium()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if coalesce((select public.is_platform_admin()), false) then
    return new;
  end if;

  if not exists (
    select 1
    from public.contact_card_entitlements
    where owner_user_id = new.owner_user_id
      and (
        premium_active is true
        or premium_trial_ends_at > now()
      )
  ) then
    raise exception 'Contact Card Premium is required to save contacts.' using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_contact_card_connection_premium() from public, anon, authenticated;

comment on column public.contact_card_entitlements.premium_trial_started_at is
  'Start of the account''s single self-service Contact Card Premium trial.';
comment on column public.contact_card_entitlements.premium_trial_ends_at is
  'Seven-day trial cutoff. Trial access excludes N3XRA branding removal.';
