grant delete on public.website_service_requests to authenticated;

drop policy if exists "website_service_requests_admin_delete" on public.website_service_requests;
create policy "website_service_requests_admin_delete"
on public.website_service_requests
for delete
to authenticated
using (
  (select public.is_platform_admin())
  and not exists (
    select 1
    from public.website_proposals proposal
    where proposal.request_id = website_service_requests.id
  )
);;
