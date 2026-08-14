# Final disposable preview replay — 2026-08-14

## Outcome

The final hosted Supabase verification passed. A fresh, data-free preview database executed all 144 active migrations in order and completed the Communications integration and tenant-isolation suite successfully. Production was not changed.

Preview branch:

- Name: `communications-full-replay-final`
- Project ref: `lfrdbiushfqopxurbbpf`
- Branch id: `640b0e21-b3a4-43c7-8530-9361af2deefe`
- Parent production project: `vdbjlgmbpykjblprqnak`

## Migration replay

- Pre-replay migration count: 0.
- Dry-run: all 144 active migrations listed in the expected order.
- Actual replay: passed from `20260515052659_foundational_schema_baseline.sql` through `20260814033028_roots_relics_communications_seed_forward.sql`.
- The Roots & Relics seed correctly skipped on the initially data-free branch, then completed after the non-production website and owner fixture was loaded.
- Post-replay migration count: 144.

## Hosted Communications verification

The preview-only fixture and both positive and negative integration suites completed without SQL errors.

Verified resulting state:

- Communications workspaces: 1.
- Subscribers: 5.
- Website form submissions: 6.
- Independent consent events: 7.
- Fabricated phone numbers: 0.

Verified flows included email-only, SMS-only, combined consent, verified QR attribution, idempotent submission handling, subscriber channel merging, immutable consent snapshots, accurate workspace metrics, Records-contact separation, forged-source rejection, cross-workspace topic rejection, origin allowlisting, stale-consent rejection, disabled-form rejection, and cross-organization link rejection.

## Hosted tenant isolation

- Roots & Relics owner: 1 visible Communications workspace.
- Unrelated organization member: 0 visible Communications workspaces.
- Platform administrator: 1 visible Communications workspace.
- Browser roles do not receive direct table-mutation grants for Communications ingestion.

## Tests, lint, and advisors

- Complete repository tests: 338/338 passed.
- TypeScript typecheck: passed.
- Hosted schema lint: no schema errors.
- Hosted security advisor: no advisory unique to the preview compared with production, and no Communications security advisory.
- Hosted performance advisor: no new warning compared with production. New preview-only notices were informational unused-index results expected on a newly created database with almost no query history.

Existing production security and performance findings were not changed and remain tracked separately.

## Safety and deployment state

- No production migration, schema, data, route, environment variable, Auth setting, Twilio configuration, Resend configuration, or outbound delivery behavior changed.
- This verification does not authorize production deployment.
- The preview branch was deleted successfully after verification. A final branch listing contains only `main`, so preview compute billing has stopped.
- A post-deletion production query still reported 131 migrations ending at `20260813191255`; `public.communications_workspaces` and `public.website_forms` remain absent.
- The repository's local Supabase link was restored to production project `vdbjlgmbpykjblprqnak`.
- Production deployment remains a separate approval covering migration-history repair, a dry-run showing only the two Communications migrations, application of those two migrations, production verification, and separately approved route/environment deployment.
