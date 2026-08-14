-- Restore the last known-good website-to-organization behavior that was removed
-- by the two 2026-08-13 account-routing experiments. Website membership remains
-- the website authorization boundary; a single unambiguous owner membership may
-- populate the optional organization reference used for portal app discovery.
create or replace function private.link_owned_websites_to_single_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  target_user_id uuid;
  target_organization_id uuid;
begin
  target_user_id := new.user_id;

  select min(membership.organization_id::text)::uuid
  into target_organization_id
  from public.organization_memberships membership
  where membership.user_id = target_user_id
  having count(distinct membership.organization_id) = 1;

  if target_organization_id is null then
    return new;
  end if;

  update public.client_websites website
  set organization_id = target_organization_id,
      updated_at = now()
  where website.organization_id is null
    and exists (
      select 1
      from public.website_members website_member
      where website_member.website_id = website.id
        and website_member.user_id = target_user_id
        and website_member.role = 'owner'
        and website_member.status = 'active'
    );

  return new;
end;
$$;

revoke all on function private.link_owned_websites_to_single_organization() from public, anon, authenticated;

drop trigger if exists organization_memberships_link_owned_websites on public.organization_memberships;
create trigger organization_memberships_link_owned_websites
after insert or update of organization_id, user_id on public.organization_memberships
for each row execute function private.link_owned_websites_to_single_organization();

drop trigger if exists website_members_link_single_organization on public.website_members;
create trigger website_members_link_single_organization
after insert or update of user_id, role, status on public.website_members
for each row
when (new.role = 'owner' and new.status = 'active')
execute function private.link_owned_websites_to_single_organization();

comment on column public.client_websites.organization_id is
'Optional parent N3XRA organization. Website membership remains the required website authorization boundary.';
