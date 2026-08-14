-- Protected fields remain visually identified for deliberate admin review, but
-- source evidence is advisory rather than a database veto. The guarded apply
-- RPC still validates the operation allowlist, values, proposal baseline,
-- admin authorization, totals, dates, billing consistency, and single apply.
create or replace function private.website_proposal_ai_operation_is_protected(operation_value jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select false;
$$;

revoke all on function private.website_proposal_ai_operation_is_protected(jsonb) from public;
;
