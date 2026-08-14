-- A website member can belong to several unrelated N3XRA organizations. Do not
-- infer a website's app account from that person's current memberships. The
-- website-to-organization connection is selected explicitly by a platform admin.
drop trigger if exists organization_memberships_link_owned_websites on public.organization_memberships;
drop trigger if exists website_members_link_single_organization on public.website_members;

drop function if exists private.link_owned_websites_to_single_organization();

comment on column public.client_websites.organization_id is
'Optional explicitly selected N3XRA business account whose app entitlements may appear in this website portal. Website membership remains the website authorization boundary.';;
