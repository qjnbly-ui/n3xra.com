-- Retire the Records guided-demo claim system. Dropping the claim table does
-- not delete its referenced organizations or any Records content they own.
drop function if exists public.claim_records_demo_workspace(text, uuid, text);
drop function if exists private.claim_records_demo_workspace(text, uuid, text);
drop table if exists public.records_demo_workspace_claims;
