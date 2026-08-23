create or replace function public.can_view_client_support_request(target_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.platform_support_requests request
    where request.id = target_request_id
      and request.client_visible = true
      and (select auth.uid()) is not null
      and (
        request.requester_user_id = (select auth.uid())
        or (
          request.website_id is not null
          and public.can_view_client_website(request.website_id)
        )
        or (
          request.organization_id is not null
          and public.can_view_organization(request.organization_id)
        )
      )
  );
$$;

revoke all on function public.can_view_client_support_request(uuid) from public, anon;
grant execute on function public.can_view_client_support_request(uuid) to authenticated, service_role;

drop policy if exists platform_support_request_updates_client_select
on public.platform_support_request_updates;

create policy platform_support_request_updates_client_select
on public.platform_support_request_updates
for select
to authenticated
using (
  visible_to_client = true
  and public.can_view_client_support_request(request_id)
);

comment on function public.can_view_client_support_request(uuid) is
'Checks client access to a support request without exposing protected requester identity columns.';
