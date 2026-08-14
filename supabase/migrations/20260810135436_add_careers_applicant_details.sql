alter table public.careers_applications
  add column if not exists linkedin_url text,
  add column if not exists current_school_company text,
  add column if not exists experience_level text not null default 'entry_level',
  add column if not exists primary_skills text,
  add column if not exists referral_source text,
  add column if not exists information_retention_consent boolean not null default false;

alter table public.careers_applications
  drop constraint if exists careers_applications_experience_level_check;

alter table public.careers_applications
  add constraint careers_applications_experience_level_check
  check (experience_level in ('student', 'entry_level', 'junior', 'mid_level', 'senior'));

drop policy if exists "careers_public_application_submit" on public.careers_applications;
create policy "careers_public_application_submit"
on public.careers_applications for insert to anon
with check (account_user_id is null and status = 'new' and information_retention_consent is true);

drop policy if exists "careers_signed_in_application_submit" on public.careers_applications;
create policy "careers_signed_in_application_submit"
on public.careers_applications for insert to authenticated
with check (account_user_id = (select auth.uid()) and status = 'new' and information_retention_consent is true);;
