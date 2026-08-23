with unambiguous_legacy_projects as (
  select request.id as request_id
  from public.website_service_requests request
  join public.website_proposals proposal
    on proposal.request_id = request.id
    and proposal.status = 'approved'
  join public.website_members member
    on member.user_id = request.user_id
    and member.status = 'active'
    and member.role = 'owner'
  join public.website_projects project
    on project.managed_website_id = member.website_id
    and project.source = 'existing_website'
  where request.status = 'proposal_approved'
  group by request.id
  having count(distinct project.id) = 1
)
update public.website_service_requests request
set status = 'converted'
from unambiguous_legacy_projects legacy
where request.id = legacy.request_id;
