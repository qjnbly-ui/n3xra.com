# Local full migration replay — 2026-08-13

## Outcome

The complete local Supabase replay passed from an empty database through all 144 active migrations. The Communications schema and the Roots & Relics preview integration flows also passed. Production was queried read-only after verification and remained unchanged.

## Clean-database compatibility repairs

- Qualified `pgcrypto` calls through the `extensions` schema where required by fresh Supabase Postgres 17 databases.
- Restored the four production-present legacy per-user Records storage policies in the reconstructed foundational baseline and aggregate schema so the later production-ledger migration can replay safely.
- Made the unapplied Roots & Relics customer seed skip cleanly when its website is absent in a data-free database. It still aborts on ambiguous ownership and still performs the complete seed when exactly one verified website and owner exist.
- Updated the non-production fixture for the current `client_websites.portal_slug` requirement and qualified its `pgcrypto` fixture helpers.

No production-ledger migration file was changed by these repairs.

## Verification completed

- Empty local database reset: passed.
- Active migration ledger: 144 migrations, from `20260515052659` through `20260814033028`.
- Communications tables created: 15.
- Communications and universal-form RLS policies present: 16.
- Roots & Relics forward seed with preview identities: passed.
- Positive integration flows: passed, including email-only, SMS-only, combined consent, QR attribution, idempotency, subscriber merging, consent snapshots, Records-contact separation, and workspace metrics.
- Negative integration flows: passed, including forged QR source, cross-workspace topic, unapproved origin, stale consent, disabled form, cross-organization website link, consent-history mutation, and overly broad grants.
- Live RLS checks: the Roots & Relics owner saw one workspace; an unrelated organization saw zero; the platform administrator saw one. Direct authenticated table updates were not granted.
- Communications static integration/security tests: 11/11 passed.
- Complete repository tests: 338/338 passed.
- TypeScript typecheck: passed.
- Local schema lint: passed with no schema errors.
- Local security advisor: 10 existing warnings, none attached to Communications or universal-form objects.
- Local performance advisor: 38 existing warnings, none attached to Communications or universal-form objects.

## Production read-only confirmation

- Production migration count: 131.
- Latest production migration: `20260813191255`.
- `public.communications_workspaces`: absent.
- `public.website_forms`: absent.
- No production schema, data, environment variables, routes, authentication settings, Twilio configuration, Resend configuration, or delivery behavior changed.

## Remaining deployment gate

The clean local replay gate is satisfied. Before production deployment, run the same 144-migration replay and integration suite once on a disposable hosted preview branch. If that passes, production migration-history repair and the two new Communications migrations remain separate, explicit production actions.
