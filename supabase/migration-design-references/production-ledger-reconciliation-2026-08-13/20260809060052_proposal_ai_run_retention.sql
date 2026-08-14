create or replace function private.protect_website_proposal_ai_run()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'DELETE' then
    -- An applied run with accepted changes is proposal history. It may only be
    -- removed by the proposal foreign-key cascade, whose trigger is nested.
    if old.status = 'applied'
      and old.accepted_count > 0
      and pg_trigger_depth() <= 1
    then
      raise exception 'Applied Proposal AI history cannot be removed independently.';
    end if;

    return old;
  end if;

  if new.id is distinct from old.id
    or new.proposal_id is distinct from old.proposal_id
    or new.base_version_id is distinct from old.base_version_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.base_proposal_updated_at is distinct from old.base_proposal_updated_at
    or new.base_version_updated_at is distinct from old.base_version_updated_at
    or new.base_revision_token is distinct from old.base_revision_token
    or new.instruction is distinct from old.instruction
    or new.source_manifest is distinct from old.source_manifest
    or new.model is distinct from old.model
    or new.created_at is distinct from old.created_at
  then
    raise exception 'Proposal AI run inputs and baseline are immutable.';
  end if;

  if old.status <> 'generating' and new.change_set is distinct from old.change_set then
    raise exception 'A completed Proposal AI change set is immutable.';
  end if;

  if old.status = 'failed' then
    raise exception 'A failed Proposal AI run cannot be changed.';
  end if;

  if old.status = 'applied' then
    raise exception 'An applied Proposal AI run cannot be changed.';
  end if;

  if old.status = 'ready' and new.status <> 'applied' then
    raise exception 'A ready Proposal AI run can only be applied.';
  end if;

  return new;
end;
$$;

revoke all on function private.protect_website_proposal_ai_run() from public;

alter table public.website_proposal_ai_runs
  drop constraint if exists website_proposal_ai_runs_proposal_id_fkey;

alter table public.website_proposal_ai_runs
  add constraint website_proposal_ai_runs_proposal_id_fkey
  foreign key (proposal_id)
  references public.website_proposals (id)
  on delete cascade;

create or replace function public.delete_website_proposal_draft_version(target_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  target_version public.website_proposal_versions%rowtype;
  target_proposal public.website_proposals%rowtype;
  deleted_ai_run_count integer := 0;
begin
  if auth.uid() is null or not public.is_platform_admin() then
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

  -- Failed, incomplete, unapplied, and zero-change attempts belong to the
  -- disposable draft. Applied runs with accepted changes remain as history.
  delete from public.website_proposal_ai_runs
  where base_version_id = target_version.id
    and (status <> 'applied' or accepted_count = 0);

  get diagnostics deleted_ai_run_count = row_count;

  delete from public.website_proposal_line_items
  where version_id = target_version.id;

  delete from public.website_proposal_versions
  where id = target_version.id;

  return jsonb_build_object(
    'deleted', true,
    'proposal_id', target_version.proposal_id,
    'version_id', target_version.id,
    'version_number', target_version.version_number,
    'ai_runs_deleted', deleted_ai_run_count
  );
end;
$$;

revoke all on function public.delete_website_proposal_draft_version(uuid) from public;
revoke all on function public.delete_website_proposal_draft_version(uuid) from anon;
grant execute on function public.delete_website_proposal_draft_version(uuid) to authenticated;
