create or replace function private.protect_website_onboarding_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.request_id is distinct from old.request_id
    or new.proposal_id is distinct from old.proposal_id
    or new.client_user_id is distinct from old.client_user_id
    or new.unlocked_by_user_id is distinct from old.unlocked_by_user_id
  then
    raise exception 'Website onboarding project ownership is read-only after creation.';
  end if;

  if new.status is distinct from old.status
    and not (
      (old.status = 'not_started' and new.status in ('in_progress', 'submitted', 'archived'))
      or (old.status = 'in_progress' and new.status in ('submitted', 'archived'))
      or (old.status = 'submitted' and new.status in ('needs_changes', 'approved', 'archived'))
      or (old.status = 'needs_changes' and new.status in ('in_progress', 'submitted', 'archived'))
      or (old.status = 'approved' and new.status = 'archived')
    )
  then
    raise exception 'Invalid website onboarding status transition: % to %.', old.status, new.status;
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_onboarding_lifecycle() from public;

drop trigger if exists website_onboardings_protect_lifecycle on public.website_onboardings;
create trigger website_onboardings_protect_lifecycle
before update on public.website_onboardings
for each row execute function private.protect_website_onboarding_lifecycle();

create or replace function private.protect_website_onboarding_response_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.onboarding_id is distinct from old.onboarding_id
    or new.user_id is distinct from old.user_id
  then
    raise exception 'Website onboarding response ownership is read-only.';
  end if;
  return new;
end;
$$;

revoke all on function private.protect_website_onboarding_response_identity() from public;

drop trigger if exists website_onboarding_responses_protect_identity on public.website_onboarding_responses;
create trigger website_onboarding_responses_protect_identity
before update on public.website_onboarding_responses
for each row execute function private.protect_website_onboarding_response_identity();

alter table public.website_onboarding_responses
add constraint website_onboarding_responses_submission_time_check
check (
  (status = 'draft' and submitted_at is null)
  or (status = 'submitted' and submitted_at is not null)
);

drop policy if exists "website_onboardings_admin_insert" on public.website_onboardings;
create policy "website_onboardings_admin_insert"
on public.website_onboardings
for insert
to authenticated
with check (
  (select public.is_platform_admin())
  and unlocked_by_user_id = (select auth.uid())
  and exists (
    select 1
    from public.website_proposals proposal
    where proposal.id = proposal_id
      and proposal.request_id = request_id
      and proposal.client_user_id = client_user_id
      and proposal.status = 'approved'
  )
);;
