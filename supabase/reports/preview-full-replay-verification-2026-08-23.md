# Disposable preview full replay verification — 2026-08-23

## Outcome

The disposable hosted Supabase verification passed. The complete active repository migration sequence rebuilt a data-free preview database through the normal Supabase remote reset workflow. Communications integration, RLS, tenant isolation, regression, and advisor checks also passed.

Production remained read-only and unchanged. No Twilio or Resend credentials, production routes, production environment variables, or outbound delivery were configured or activated.

## Preview branch

- Name: `migration-reconciliation-replay-2026-08-23`
- Branch id: `93c8ceca-8905-4772-bf01-026818ebfe89`
- Project ref: `qoinbwstfppdnwttnetz`
- Parent production project: `vdbjlgmbpykjblprqnak`
- Approved compute price: `$0.01344` per hour, plus metered Database Disk Size, Storage, and Egress
- Data copy: disabled
- Final state: deleted successfully

A final branch listing contained only production `main`, so preview compute billing stopped.

## Migration replay

- The preview database was reset and rebuilt with `supabase db reset --linked --no-seed --yes` while the repository was linked only to the disposable branch.
- All 167 active repository migrations applied in timestamp order.
- Replay began with `20260515052659_foundational_schema_baseline.sql`.
- Replay ended with `20260823050418_hide_progress_when_project_completed.sql`.
- `20260817032752_support_separate_domain_subscriptions.sql` applied successfully in sequence.
- The post-replay local and preview ledgers aligned for all 167 versions.
- A normal `supabase db push --linked --dry-run --yes` reported that the preview database was up to date.

## Hosted Communications integration

The disposable fixture used two organizations, two websites, two Communications workspaces, three test users, one active subscription form, one verified QR source, and topics belonging to separate workspaces.

Positive checks passed:

- Email-only consent was stored independently from SMS consent.
- A later SMS opt-in merged with the existing email subscriber without duplicating the subscriber.
- Combined email and SMS consent created separate channel-specific consent events.
- Idempotent resubmission returned the original submission without duplicating rows.
- Exact email and SMS disclosure text and checkbox labels were retained in consent history.
- All three successful submissions stored the verified QR signup-source identifier.
- QR attribution resolved to a real `qr_campaign` source rather than an illustrative value.
- No phone-number record was fabricated.

Resulting preview fixture state:

- Roots preview subscribers: 2
- Roots preview submissions: 3
- Roots preview consent events: 4
- Verified QR-attributed submissions: 3
- Fabricated Communications numbers: 0

Negative checks passed:

- Forged signup token rejected.
- Unapproved request origin rejected.
- Stale consent version rejected.
- Cross-workspace topic rejected.
- Paused form rejected.

## Hosted RLS and tenant isolation

- Intended Roots preview member saw the Roots preview workspace: 1.
- Unrelated organization member saw the Roots preview workspace: 0.
- Platform administrator saw the Roots preview workspace: 1.
- The unrelated member saw no Roots subscribers, submissions, or consent events.
- `authenticated` cannot insert or update Communications subscribers.
- `authenticated` cannot insert Communications consent events.
- `anon` and `authenticated` cannot execute the trusted ingestion RPC.
- `service_role` can execute the trusted ingestion RPC.

## Regression and advisor results

- TypeScript typecheck: passed.
- Focused Communications tests: 17/17 passed.
- Complete repository build and regression suite: 464/464 passed.
- `git diff --check`: passed.
- Security advisor: 102 total notices, including 90 warnings and 12 informational notices.
- Communications security findings: five informational `rls_enabled_no_policy` notices on intentionally server-only tables; no Communications warning-level finding.
- Performance advisor: 416 total notices, including 38 warnings and 378 informational notices.
- Communications performance findings: informational unused-index notices expected on a fresh database with almost no query history; no Communications warning-level finding.
- Launch-critical Communications security finding: none identified.

The existing global production security findings remain a separate read-only remediation report and were not changed as part of this verification.

## No preview-only required state

The preview contained only disposable verification users, organizations, workspaces, subscribers, submissions, and consent events. No required customer data, provider configuration, application secret, route setting, or outbound delivery state existed only on the preview branch.

The preview ledger contained one version that production does not currently record: `20260817032752`. Its `website_subscriptions.subscription_type` column and check constraint already exist in production. Therefore, the remaining difference is migration-ledger metadata, not a missing production schema change.

Immediately before deletion:

- Preview: 167 migrations, including `20260817032752`.
- Production: 166 migrations, not including `20260817032752`.
- Both databases contained the same required `subscription_type` column and check constraint.

## Production state

Production was queried read-only and remained at 166 migration records ending at `20260823050418`. No production schema, data, Auth setting, route, environment variable, Twilio setting, Resend setting, or delivery behavior was changed.

The repository's local Supabase link was restored to production project `vdbjlgmbpykjblprqnak` after all preview writes ended and before the preview branch was deleted.

## Exact production deployment plan requiring separate approval

No step below is authorized by this report.

1. Freeze and review the reconciled repository changes, including the 12 canonical production-ledger filenames and the Communications portal organization-selection fix.
2. Run a read-only production preflight confirming 166 ledger rows ending at `20260823050418`, confirming `20260817032752` is absent from the ledger, and reconfirming that its column, check constraint, and indexes already exist.
3. After explicit production approval, reconcile only the missing ledger entry with `supabase migration repair 20260817032752 --status applied --linked --yes`. This records already-present schema and does not rerun its SQL.
4. Immediately verify that production and the repository both show 167 aligned migration versions, ending at `20260823050418`.
5. Run a normal production `supabase db push --linked --dry-run --yes` and require `Remote database is up to date`. Stop if it proposes any SQL migration.
6. After separate application-deployment approval, deploy the reviewed repository revision through the existing Vercel workflow. This deploys the Communications portal organization-selection fix and reconciled migration files; it does not activate providers.
7. Smoke-test sign-in, entitled-organization selection, the existing Communications workspace reads, and tenant isolation in production using read-only application flows.
8. Keep Twilio, Resend outbound delivery, new production secrets, and provider activation disabled until separately configured, approved, and tested.
