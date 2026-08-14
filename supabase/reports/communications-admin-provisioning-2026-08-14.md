# Communications Admin provisioning verification — 2026-08-14

## Scope

This repository-only release adds the first trusted Communications Admin mutation foundation. It does not apply SQL to production, activate Resend or Twilio, or deploy application code.

## Migration baseline

- The reconciled production-aligned base remains the verified 144-migration sequence ending in `20260814033028_roots_relics_communications_seed_forward.sql`.
- The repository now contains 145 migrations because `20260814173124_communications_admin_provisioning.sql` is the first new migration after that verified base.
- The new migration has not been applied to production.
- Supabase preview branch `communications-admin-replay-2026-08-14` (`yviyrwbywzkrkxfvbffz`) was created without production data from the N3XRA project.
- The branch replayed the 144-migration production-aligned base and then applied the new provisioning migration, producing 145 applied migration records.
- The applied migration SQL SHA-256 was `451c6ddcc9fe0144e24f6939f280cef931f31f5d3235baab5bd422603592696a`, exactly matching the repository file.
- The preview branch was deleted immediately after verification. A final branch listing confirmed that only the production `main` branch remained.

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
- All four trusted operations completed against disposable organizations and websites: workspace provisioning, subscription-form configuration, topic configuration, and pricing/entitlement updates.
- Reusing each operation's idempotency key returned the original result and did not duplicate the workspace, form, topic, dependencies, or audit row.
- Reusing an idempotency key for a different operation was rejected.
- A non-platform-admin actor was rejected without a topic or audit artifact.
- `anon` and `authenticated` could not execute the provisioning RPC; `service_role` could.
- A website belonging to another organization was rejected for both workspace and form provisioning without partial data.
- The saved form, website, workspace, and organization graph retained one tenant identity; no cross-tenant forms existed.
- The four primary operations each wrote one immutable audit record. Audit update and delete attempts were rejected.
- A forced subtransaction rollback removed both the test topic and its audit row.
- A temporary late-failure trigger forced workspace provisioning to fail during entitlement creation after earlier inserts. PostgreSQL rolled back the workspace, link, channel, entitlement, and audit changes. The temporary trigger and function were removed.
- Post-test integrity reported 145 migrations, RLS enabled on the audit table, zero failed-operation audit artifacts, zero cross-tenant forms, and the expected RPC grants.
- Supabase security and performance advisors reported no errors attributable to the provisioning migration. The audit table produced one intentional informational notice for RLS with no policies because all browser roles are denied and access is service-role-only. A fresh-branch unused-index notice was also informational.

## Production sequence after approval

The clean replay gate passed. Production remains unchanged. The separately authorized release sequence is:

1. Push the feature branch.
2. Merge it into `main`.
3. Apply only `20260814173124_communications_admin_provisioning.sql` to production.
4. Deploy the Communications Admin interface and mutation endpoint.
5. Smoke-test with a controlled N3XRA organization.

Twilio and Resend activation must remain disabled until their separate trusted provider adapters are ready.
