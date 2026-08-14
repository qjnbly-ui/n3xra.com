# Communications Admin provisioning verification — 2026-08-14

## Scope

This repository-only release adds the first trusted Communications Admin mutation foundation. It does not apply SQL to production, activate Resend or Twilio, or deploy application code.

## Migration baseline

- The reconciled production-aligned base remains the verified 144-migration sequence ending in `20260814033028_roots_relics_communications_seed_forward.sql`.
- The repository now contains 145 migrations because `20260814173124_communications_admin_provisioning.sql` is the first new migration after that verified base.
- The new migration has not been applied to production.
- A local database replay was not run because the local Docker daemon was unavailable. The migration received static contract and security verification only and must be replayed in an isolated Supabase environment before production application.

## Security boundaries

- Browser code sends bearer-authenticated requests only to the N3XRA server endpoint.
- The server endpoint revalidates an active platform owner/admin and maps an operation allowlist to fixed database RPC names.
- Each database operation independently revalidates the platform administrator, runs atomically, uses an idempotency key, and writes an immutable audit record.
- RPC execution is revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execution permission.
- No Supabase service credential, Resend key, Twilio credential, provider phone SID, or messaging service SID is returned to or accepted from browser code.
- Workspace provisioning cannot set the workspace to provider-backed `active` status.

## Included operations

- Create or update a Communications workspace, optional website link, pending channel records, and Communications entitlement.
- Create or update a universal subscription form with standard fields, consent configuration, actions, and signup sources.
- Create or update subscriber topics.
- Update stored usage pricing and Communications portal entitlement.

## Verification completed

- TypeScript typecheck passed.
- Communications Admin tests passed: 8 of 8.
- Full repository tests passed: 335 of 335.
- Desktop and 390-pixel responsive visual smoke checks passed with no horizontal overflow.
- `git diff --check` passed.

## Required next gate

Before any production database change or deployment, replay all 145 migrations in an isolated Supabase environment, exercise each RPC against disposable records, verify rollback/failure behavior and audit immutability, then obtain separate production authorization.
