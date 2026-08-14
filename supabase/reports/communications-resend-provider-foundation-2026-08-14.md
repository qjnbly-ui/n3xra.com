# Communications Resend provider foundation — 2026-08-14

## Scope

This repository-only feature builds the trusted Resend delivery adapter, signed webhook receiver, suppression synchronization, permanent delivery idempotency, webhook deduplication, and immutable provider audit history.

It does not apply migration `20260814184353_communications_resend_provider_foundation.sql`, deploy the new server route, configure provider credentials, verify a Resend domain, activate email delivery, or send an email.

## Production boundary

- A read-only Supabase migration-ledger check on 2026-08-14 confirmed that N3XRA production contains 145 applied migrations.
- Production still ends at `20260814173124_communications_admin_provisioning`.
- The repository contains 146 migrations; the only new migration is `20260814184353_communications_resend_provider_foundation.sql`.
- Disposable branch `communications-resend-replay-2026-08-14` was created without production data after explicit approval of the $0.01344 branch-hour cost plus metered usage.
- The branch replayed the production-aligned 145 migrations, then applied the corrected provider migration as its 146th ledger entry.
- Supabase assigned the preview ledger version `20260814192004` to the migration named `communications_resend_provider_foundation`; the repository release filename remains `20260814184353_communications_resend_provider_foundation.sql`.
- The exact final repository migration SQL had SHA-256 `5c8b4f300396aa1e28ced6a5464c5edf14914adc1d1b293cf26c1c8381b8cec0` when applied for final verification.
- The branch was deleted immediately after verification. A branch listing confirmed only production `main` remained.

## Trusted delivery path

- New provider logic is TypeScript compiled to server-only CommonJS for the existing Vercel API runtime.
- `COMMUNICATIONS_RESEND_API_KEY` and `COMMUNICATIONS_RESEND_WEBHOOK_SECRET` are read only in trusted server code.
- Before a provider request, one atomic database operation requires an active Communications workspace, active email channel, exact verified Resend sending domain, active subscriber email consent, and no local or provider-account suppression.
- A workspace-scoped idempotency key is permanent in N3XRA. Resend receives the same key through its `Idempotency-Key` request header.
- Atomic claiming prevents concurrent duplicate sends. Retries are limited to five attempts and 23 hours so the provider retry window never exceeds Resend's 24-hour idempotency retention.
- Message bodies are not stored in delivery or audit tables.

## Webhooks and suppressions

- The endpoint disables body parsing and verifies the exact raw request bytes with `svix-id`, `svix-timestamp`, and `svix-signature` before parsing JSON.
- Signatures use constant-time comparison and a five-minute timestamp tolerance.
- Verified events are deduplicated permanently by `svix-id`; reusing an event ID with a different payload is rejected.
- Delivery state is ordered by the provider event timestamp, so a late older event cannot regress a newer state.
- Hard bounces, complaints, and provider-suppressed deliveries create active local suppressions.
- Resend `suppression.added` and `suppression.removed` events synchronize an account-wide suppression record. A removal clears matching local rows only when it is the newest provider event.
- Unknown signed provider-message events are retained as ignored history and audited instead of mutating a tenant.

## Database security and audit

- The four new tables have RLS enabled and no browser-role privileges.
- Only `service_role` can execute the four trusted RPC operations.
- The provider audit log and verified webhook receipt table grant `service_role` only `SELECT` and `INSERT`.
- Row update, row deletion, and table truncation are rejected on both immutable history tables.
- Audit identity fields are historical values without lifecycle foreign keys.

## Verification completed

- Focused Communications provider tests: 8 of 8 passed.
- Full repository tests: 343 of 343 passed.
- Full TypeScript typecheck passed.
- `git diff --check` passed.
- The final disposable database contained 146 applied migrations and the exact corrected provider schema.
- Two disposable organizations, websites, workspaces, domains, channels, and subscribers were created with no production data.
- An inactive workspace, cross-tenant subscriber, and cross-tenant sending domain were rejected before delivery creation.
- Reusing a workspace idempotency key with the same payload returned the original request; a changed payload was rejected; the same key remained independent in a second workspace.
- Atomic claiming authorized one send attempt and refused a concurrent duplicate claim.
- Provider success, duplicate success, retryable failure, retry claim, and terminal failure paths produced the expected delivery and audit states without contacting Resend.
- Duplicate `svix-id` delivery returned the original result without a second receipt. Reusing the ID with a changed payload was rejected.
- A newer delivery event advanced state; an older late event was retained without regressing current delivery or usage state.
- Bounce suppression blocked a later delivery. Account-level suppression addition blocked the second tenant, verified removal unblocked it, and a late older addition could not reactivate it.
- A signed event for an unknown provider message was retained as ignored history without tenant mutation.
- A forced subtransaction rollback removed both the prepared delivery and its audit record.
- `anon` and `authenticated` had no RPC execution. `service_role` had execution on all four security-invoker operations.
- All four tables had RLS enabled. Browser roles had no table read access.
- `service_role` had no update or delete privilege on provider audit or verified webhook history.
- Privileged update, delete, and truncate attempts were rejected by immutable-history triggers.
- Deleting a referenced test workspace cascaded its operational rows while all 12 audit rows and three webhook receipts remained byte-for-byte unchanged.
- Immutable history tables had no lifecycle foreign keys.
- Security advisors produced only the expected informational RLS-without-policy notices for the server-only tables; no warning named a new Resend function.
- Performance advisors produced no unindexed-foreign-key finding for any new table. Fresh-branch unused-index notices were informational.
- A final read-only production check still reported 145 migrations ending at `20260814173124`; no production schema was changed.

## Replay corrections

The replay caught and corrected two unreleased migration issues in place:

1. Delivery preparation now explicitly requires the Communications workspace itself to be active, in addition to its channel and domain readiness.
2. PostgreSQL `LEAST` and `GREATEST` suppression-ordering expressions are used without an invalid `pg_catalog` function qualification.

Migration 146 remains unapplied to production. No provider activation, deployment, email, push, or merge occurred.
