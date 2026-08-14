# Communications Admin provisioning verification — 2026-08-14

## Scope

This repository-only release adds the first trusted Communications Admin mutation foundation. It does not apply SQL to production, activate Resend or Twilio, or deploy application code.

## Migration baseline

- The reconciled production-aligned base remains the verified 144-migration sequence ending in `20260814033028_roots_relics_communications_seed_forward.sql`.
- The repository now contains 145 migrations because `20260814173124_communications_admin_provisioning.sql` is the first new migration after that verified base.
- The new migration has not been applied to production.
- Final Supabase preview branch `communications-admin-audit-replay-final-2026-08-14` (`deiqwvotbdhmbpmaryby`) was created without production data from the N3XRA project.
- The branch replayed the 144-migration production-aligned base and then applied the new provisioning migration, producing 145 applied migration records.
- The applied migration SQL SHA-256 was `2cc26ca6dcfca231d9da4af3db2f6aba55db1eb8d92b508938fb29df2593cc46`, exactly matching the repository file.
- The preview branch was deleted immediately after verification. A final branch listing confirmed that only the production `main` branch remained.
- A final read-only production query confirmed 144 applied migrations ending at `20260814033028`. A linked production dry run listed only `20260814173124_communications_admin_provisioning.sql`.

## Security boundaries

- Browser code sends bearer-authenticated requests only to the N3XRA server endpoint.
- The server endpoint revalidates an active platform owner/admin and maps an operation allowlist to fixed database RPC names.
- Each database operation independently revalidates the platform administrator, runs atomically, uses an idempotency key, and writes an immutable audit record.
- RPC execution is revoked from `public`, `anon`, and `authenticated`; only `service_role` receives execution permission.
- Audit actor, organization, and workspace IDs are permanent historical UUID values without lifecycle foreign keys. A required identity snapshot preserves the actor email/role, organization name/slug, and workspace program/sender labels recorded at operation time.
- The audit table grants `service_role` only `SELECT` and `INSERT`; browser roles receive no table privileges. Row and statement triggers reject update, delete, and truncate attempts.
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
- Audit truncate attempts were also rejected.
- Deleting the referenced disposable workspace, organization, and actor user succeeded. All four audit records remained byte-for-byte unchanged, retained their historical UUIDs, and preserved their actor, organization, and workspace labels.
- A forced subtransaction rollback removed both the test topic and its audit row.
- A temporary late-failure trigger forced workspace provisioning to fail during entitlement creation after earlier inserts. PostgreSQL rolled back the workspace, link, channel, entitlement, and audit changes. The temporary trigger and function were removed.
- Post-test integrity reported 145 migrations, RLS enabled on the audit table, no audit foreign keys, zero failed-operation audit artifacts, zero cross-tenant forms, two immutability guards, and the expected RPC grants.
- Direct privilege checks confirmed `anon` and `authenticated` cannot select or insert audit rows. `service_role` can select and insert but cannot update or delete. All four RPCs are security-invoker functions executable only by `service_role` among those roles.
- An initial corrected replay exposed Supabase default table privileges that still allowed `service_role` update/delete at the privilege layer. Migration 145 was revised in place to revoke all service-role table privileges before granting only `SELECT` and `INSERT`, and the final clean replay confirmed the correction.
- Supabase security and performance advisors reported no error or warning attributable to the provisioning migration. The audit table produced one intentional informational notice for RLS with no policies because browser roles are denied and access is service-role-only. Fresh-branch unused-index notices were also informational.

## Production sequence after approval

The clean replay gate passed. Production remains unchanged. The separately authorized release sequence is:

1. Freeze the approved feature commit and reconfirm that production ends at migration 144 and the dry run lists only migration 145.
2. Apply only `20260814173124_communications_admin_provisioning.sql` while the existing application remains live.
3. Verify production ends at migration 145 and confirm the audit table, RPC definitions, RLS, and grants.
4. Merge the approved PR into `main` and verify the resulting Vercel deployment.
5. Smoke-test reads and all four operations with a controlled N3XRA organization.

Twilio and Resend activation must remain disabled until their separate trusted provider adapters are ready.
