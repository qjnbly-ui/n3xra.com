# Migration-history reconciliation — 2026-08-23

## Scope

This was a local-only repository reconciliation against Supabase production project `vdbjlgmbpykjblprqnak`.

Production remained read-only. No migration repair, migration push, schema change, data change, branch creation, route deployment, environment-variable change, Auth change, Resend activation, Twilio activation, or outbound delivery occurred.

## Restored production-ledger versions

Twelve repository migrations had the same production migration names but different local timestamps. They were restored under the exact versions already recorded in production:

- `20260817020428_recurring_service_review_policy.sql`
- `20260817020721_copy_recurring_review_policy_to_proposal_revisions.sql`
- `20260817155835_protect_career_applications_from_automated_submissions.sql`
- `20260817192024_durable_public_ai_rate_limits.sql`
- `20260817192847_fix_public_ai_rate_limit_clock_name.sql`
- `20260817195644_fix_client_support_update_policy.sql`
- `20260817200734_harden_client_support_update_policy.sql`
- `20260818011348_admin_remove_communications_enrollment.sql`
- `20260818011356_admin_provision_career_applicant.sql`
- `20260818015517_remove_records_demo_workspace_claims.sql`
- `20260823044649_public_counter_all_time_visitors.sql`
- `20260823050418_hide_progress_when_project_completed.sql`

The recorded production SQL length and MD5 were compared with the corresponding repository SQL. Two local files had accumulated source drift in addition to timestamp drift:

1. The career-application protection migration contained only explanatory comments not present in the production statement. The restored version now matches the production statement.
2. The durable public-AI rate-limit migration had incorporated the later `now_at` correction too early. The restored version now matches production's original `current_time` statement, followed by the separately recorded correction migration.

Already-applied production migrations were not changed. Local tests that referenced the former filenames were updated to use the production-ledger filenames.

## Remaining ledger-only discrepancy

`20260817032752_support_separate_domain_subscriptions.sql` exists locally but has no production ledger record.

A read-only production inspection confirmed that every schema effect represented by this migration is already present:

- `public.website_subscriptions.subscription_type`
- `website_subscriptions_subscription_type_check`
- `website_subscriptions_project_type_key`
- `website_subscriptions_snapshot_type_key`

No production migration statement contains those definitions, so this is verified unledgered production schema drift rather than a pending schema feature.

After restoring the twelve production versions:

- `supabase migration list --linked` shows every other local/remote migration aligned.
- Normal `supabase db push --linked --dry-run --yes` stops only because this older version is not in the production ledger.
- `supabase db push --linked --include-all --dry-run --yes` selects exactly `20260817032752_support_separate_domain_subscriptions.sql` and nothing else.

The repository file remains active so a clean database replay retains the real production schema. Production requires a separately approved ledger-only repair after a disposable full replay confirms the complete sequence.

## Communications portal correction

The customer Communications portal previously trusted a stored organization after checking membership only. A user belonging to multiple organizations could therefore be routed to an organization without an active Communications entitlement.

The portal now requires both current organization membership and an enabled Communications entitlement before accepting the stored organization. Otherwise it falls back to an entitled organization visible through RLS.

## Local verification

- Client-portal TypeScript build: passed.
- Full TypeScript typecheck: passed.
- Focused Communications tests: 17/17 passed.
- Full repository tests: 464/464 passed.
- `git diff --check`: passed.
- Linked normal migration dry run: only the known older unledgered version blocks normal mode.
- Linked include-all dry run: exactly one migration selected.

## Required next gate

Before any new production migration:

1. Create a separately approved disposable Micro preview branch.
2. Replay the complete active repository sequence from empty state through the normal workflow.
3. Repeat Communications integration, RLS, tenant-isolation, regression, and advisor checks.
4. Delete the branch immediately after verification.
5. If the replay passes, request separate approval for the production ledger-only repair of `20260817032752`.
