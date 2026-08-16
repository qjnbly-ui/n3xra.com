drop policy if exists platform_support_requests_client_select on public.platform_support_requests;
create policy platform_support_requests_client_select
on public.platform_support_requests
for select
to authenticated
using (
  client_visible = true
  and (
    requester_user_id = (select auth.uid())
    or (website_id is not null and public.can_view_client_website(website_id))
    or (organization_id is not null and public.can_view_organization(organization_id))
  )
);

drop policy if exists platform_support_requests_client_insert on public.platform_support_requests;
create policy platform_support_requests_client_insert
on public.platform_support_requests
for insert
to authenticated
with check (
  requester_user_id = (select auth.uid())
  and client_visible = true
  and source = 'client_portal'
  and origin = 'client'
  and organization_id is not null
  and public.can_view_organization(organization_id)
  and (
    website_id is null
    or (
      public.can_view_client_website(website_id)
      and exists (
        select 1
        from public.client_websites website
        where website.id = website_id
          and website.organization_id is not distinct from organization_id
      )
    )
  )
);

drop policy if exists platform_support_request_updates_client_select on public.platform_support_request_updates;
create policy platform_support_request_updates_client_select
on public.platform_support_request_updates
for select
to authenticated
using (
  visible_to_client = true
  and exists (
    select 1
    from public.platform_support_requests request
    where request.id = request_id
      and request.client_visible = true
      and (
        request.requester_user_id = (select auth.uid())
        or (request.website_id is not null and public.can_view_client_website(request.website_id))
        or (request.organization_id is not null and public.can_view_organization(request.organization_id))
      )
  )
);

comment on column public.platform_support_requests.website_id is
'Optional website context. NULL means the client-visible work applies to the broader organization or product relationship.';
