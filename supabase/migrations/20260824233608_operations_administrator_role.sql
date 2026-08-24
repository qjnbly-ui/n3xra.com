alter table public.platform_admins
add column if not exists access_scope text not null default 'full';

alter table public.platform_admins
drop constraint if exists platform_admins_access_scope_check;

alter table public.platform_admins
add constraint platform_admins_access_scope_check
check (access_scope in ('full', 'operations'));

alter table public.platform_admin_invites
add column if not exists access_scope text not null default 'full';

alter table public.platform_admin_invites
drop constraint if exists platform_admin_invites_access_scope_check;

alter table public.platform_admin_invites
add constraint platform_admin_invites_access_scope_check
check (access_scope in ('full', 'operations'));

create or replace function public.is_full_platform_admin()
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
        and access_scope = 'full'
    );
$$;

revoke all on function public.is_full_platform_admin() from public;
grant execute on function public.is_full_platform_admin() to authenticated;

drop policy if exists "platform_admins_select_policy" on public.platform_admins;
create policy "platform_admins_select_policy"
on public.platform_admins
for select
to authenticated
using ((select public.is_full_platform_admin()));

drop policy if exists "founding_partner_applications_select_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_select_policy"
on public.founding_partner_applications
for select
to authenticated
using ((select public.is_full_platform_admin()));

drop policy if exists "founding_partner_applications_insert_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_insert_policy"
on public.founding_partner_applications
for insert
to authenticated
with check ((select public.is_full_platform_admin()));

drop policy if exists "founding_partner_applications_update_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_update_policy"
on public.founding_partner_applications
for update
to authenticated
using ((select public.is_full_platform_admin()))
with check ((select public.is_full_platform_admin()));

drop policy if exists "founding_partner_applications_delete_policy" on public.founding_partner_applications;
create policy "founding_partner_applications_delete_policy"
on public.founding_partner_applications
for delete
to authenticated
using ((select public.is_full_platform_admin()));

comment on column public.platform_admins.access_scope is
  'Full administrators can open every admin workspace. Operations administrators receive only the approved operational workspace set.';

comment on column public.platform_admin_invites.access_scope is
  'Requested administrator workspace scope applied when an invitation is redeemed.';

comment on function public.is_full_platform_admin() is
  'Returns true only for active owner or unrestricted platform administrator access.';
