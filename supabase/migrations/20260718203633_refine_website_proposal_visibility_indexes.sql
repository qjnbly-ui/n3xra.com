create index if not exists website_proposals_current_version_idx
on public.website_proposals (current_version_id)
where current_version_id is not null;

create index if not exists website_proposals_created_by_idx
on public.website_proposals (created_by_user_id);

create index if not exists website_proposal_versions_created_by_idx
on public.website_proposal_versions (created_by_user_id);

create index if not exists website_proposal_decisions_proposal_idx
on public.website_proposal_decisions (proposal_id);

drop policy if exists "website_proposals_select" on public.website_proposals;
create policy "website_proposals_select"
on public.website_proposals
for select
to authenticated
using (
  (select auth.uid()) is not null
  and (
    (select public.is_platform_admin())
    or (
      client_user_id = (select auth.uid())
      and current_version_id is not null
      and status in ('sent', 'changes_requested', 'approved', 'declined', 'expired', 'withdrawn')
    )
  )
);
