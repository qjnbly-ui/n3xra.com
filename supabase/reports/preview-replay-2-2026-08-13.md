# Second disposable preview replay report

Date: 2026-08-13 (America/Los_Angeles)  
Production project: `vdbjlgmbpykjblprqnak`  
Preview branch: `communications-full-replay-2`  
Preview project ref: `wucewbsomwgnsvknkfam`  
Preview branch id: `7d4bc346-887e-4bfb-b3b6-e916522df1e0`

## Outcome

The complete active migration sequence did **not** rebuild successfully.

The preview branch's automatic production-ledger bootstrap reported `MIGRATIONS_FAILED`, while the disposable database itself was `ACTIVE_HEALTHY`. A read-only migration query confirmed its migration ledger was empty.

The repository was linked to the preview project and the normal CLI workflow was used:

1. `supabase db push --linked --include-all --dry-run --yes`
2. Dry-run succeeded and listed all 144 active migrations.
3. `supabase db push --linked --include-all --yes`
4. Replay stopped in the first foundational migration.

Exact failure:

```text
Applying migration 20260515052659_foundational_schema_baseline.sql...
ERROR: function gen_random_bytes(integer) does not exist (SQLSTATE 42883)
At statement: 9
public_embed_token text unique default encode(gen_random_bytes(12), 'hex')
```

The fresh Supabase Postgres 17 environment has `pgcrypto` in the `extensions` schema, so the unqualified function was not available on the migration runner's search path.

## Branch deletion

The branch was deleted immediately after the replay failure, before any local repair.

Deletion returned `success: true`. A follow-up branch listing contains only `main`; no preview branch remains.

## Local repair after deletion

The smallest local-only portability repair was applied:

- `supabase/migrations/20260515052659_foundational_schema_baseline.sql`: `extensions.gen_random_bytes(12)`
- `supabase/migrations/20260814033024_communications_and_universal_forms_foundation.sql`: `extensions.gen_random_bytes(24)`
- `supabase/schema.sql`: matching aggregate-schema qualification

A repository-wide scan found no remaining unqualified `gen_random_bytes` calls in active migrations or `supabase/schema.sql`.

## Tests

Completed locally after the repair:

- Full regression suite: 338/338 passed
- Communications static integration/security regression: 11/11 passed
- TypeScript typecheck: passed
- Normal migration dry-run against the empty preview branch: 144/144 migrations enumerated
- Complete migration execution: failed at migration 1/144
- Hosted Communications integration: not reached
- Hosted RLS and tenant-isolation flows: not reached
- Preview security/performance advisors: not reached

Because the database replay did not complete, hosted Communications and advisor results cannot be represented as passing.

## Launch-critical findings

No new launch-critical security vulnerability was identified during this attempt. However, hosted security verification is incomplete and production deployment remains blocked until a corrected clean replay succeeds.

The replay-blocking extension-schema portability defect was launch-critical operationally and is repaired locally, but not yet reverified on a branch.

Existing production security findings remain preserved separately in `supabase/reports/production-security-read-only-2026-08-13.md`; none were changed.

## Production unchanged

A post-attempt read-only production query confirmed:

- Migration count: 131
- Latest migration: `20260813191255`
- `public.communication_topics`: absent
- `public.communication_subscribers`: absent
- `public.form_submissions`: absent

No production migration, schema, data, route, environment variable, Auth setting, provider integration, or outbound delivery configuration was changed.

## Production deployment gate

Production deployment is not approved or ready. A new disposable preview branch must first execute all 144 active migrations from empty state and pass the hosted Communications, RLS, tenant-isolation, regression, and advisor checks.

The current quote for another Micro preview branch is $0.01344 per hour plus metered Database Disk Size, Storage, and Egress usage.
