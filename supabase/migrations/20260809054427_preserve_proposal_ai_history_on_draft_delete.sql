-- Proposal AI runs are immutable audit snapshots. Their version IDs must remain
-- available as historical identifiers even when an administrator deletes an
-- unsent draft. Keeping foreign keys on those snapshot columns made the normal
-- guarded draft-deletion RPC fail before it could remove the version.
alter table public.website_proposal_ai_runs
  drop constraint if exists website_proposal_ai_runs_base_version_id_fkey,
  drop constraint if exists website_proposal_ai_runs_applied_version_id_fkey;

comment on column public.website_proposal_ai_runs.base_version_id is
  'Historical baseline version identifier retained after an unsent draft is deleted; integrity was verified when the run was created.';

comment on column public.website_proposal_ai_runs.applied_version_id is
  'Historical applied version identifier retained after an unsent draft is deleted; null until a run is applied.';;
