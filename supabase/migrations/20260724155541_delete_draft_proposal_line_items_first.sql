create or replace function public.delete_website_proposal_draft_version(target_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_version public.website_proposal_versions%rowtype;
  target_proposal public.website_proposals%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Website proposal administration access is required.';
  end if;

  select *
  into target_version
  from public.website_proposal_versions
  where id = target_version_id
  for update;

  if target_version.id is null then
    raise exception 'This proposal version no longer exists.';
  end if;

  if target_version.status <> 'draft' then
    raise exception 'Only an unsent draft version can be deleted.';
  end if;

  select *
  into target_proposal
  from public.website_proposals
  where id = target_version.proposal_id
  for update;

  if target_proposal.current_version_id = target_version.id then
    raise exception 'The active client proposal version cannot be deleted.';
  end if;

  delete from public.website_proposal_line_items
  where version_id = target_version.id;

  delete from public.website_proposal_versions
  where id = target_version.id;

  return jsonb_build_object(
    'deleted', true,
    'proposal_id', target_version.proposal_id,
    'version_id', target_version.id,
    'version_number', target_version.version_number
  );
end;
$$;

revoke all on function public.delete_website_proposal_draft_version(uuid) from public;
grant execute on function public.delete_website_proposal_draft_version(uuid) to authenticated;;
