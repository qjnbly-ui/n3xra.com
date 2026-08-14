# Communications production database release — 2026-08-14

## Outcome

The N3XRA Communications database foundation and the forward-only Roots & Relics setup were released to production successfully. This release changed only the Supabase migration ledger and database objects/data defined by the two approved Communications migrations.

No website/API route was deployed. No Vercel environment variable, Supabase Auth setting, Twilio configuration, Resend configuration, phone number, sending domain, inbound webhook, or outbound delivery setting was created or changed.

## Approved scope

The user explicitly approved:

1. Marking the 11 verified historical migrations as applied in the N3XRA production migration ledger without executing their SQL.
2. Applying only the two Communications migrations if the production dry run showed exactly those two files.

## Production preflight

- Linked project: `vdbjlgmbpykjblprqnak`
- Starting migration count: 131
- Starting latest migration: `20260813191255`
- `public.communications_workspaces`: absent
- `public.website_forms`: absent

The local/remote migration comparison showed only the known 11 historical ledger gaps and the two pending Communications migrations.

## Ledger-only reconciliation

The following versions were marked `applied` with `supabase migration repair`. Their SQL was not executed:

- `20260515052659`
- `20260701202838`
- `20260701234104`
- `20260719175940`
- `20260725233043`
- `20260727172223`
- `20260727181158`
- `20260727212113`
- `20260805041028`
- `20260805144642`
- `20260805150308`

Post-repair checks confirmed:

- Migration count: 142
- Latest migration remained `20260813191255`
- `public.communications_workspaces`: still absent
- `public.website_forms`: still absent

This confirms the repair changed migration history only.

## Required dry-run gate

The production dry run listed exactly:

- `20260814033024_communications_and_universal_forms_foundation.sql`
- `20260814033028_roots_relics_communications_seed_forward.sql`

No other migration was listed. Both files were then applied successfully with the normal linked database push.

## Production database verification

- Migration count: 144
- Latest migration: `20260814033028`
- Roots & Relics Communications workspaces: 1
- Workspace status: `active`
- Active Communications product entitlements: 1
- Active workspace-to-website links: 1
- SMS channels in `pending_setup`: 1
- Email channels in `pending_verification`: 1
- Active topics: 3
- Active subscription forms: 1
- Active verified signup sources: 3
- Communications phone numbers: 0
- Communications sending domains: 0
- Subscribers: 0
- Form submissions: 0

The seed therefore created the organization-owned workspace, entitlement, website link, form definition, topics, consent configuration, and verified sources without pretending that Twilio or Resend was already configured.

## Access-control verification

- All 18 new base tables have row-level security enabled.
- The Roots & Relics owner can see exactly one Roots workspace, one form, and three topics.
- A real user from another production organization can see zero Roots workspaces.
- The platform administrator can see the Roots workspace.
- The metrics view is `security_invoker=true`.
- `anon` cannot execute the ingestion function or read submissions.
- `authenticated` cannot execute the ingestion function, insert subscribers, or update consent history.
- `service_role` can execute the ingestion function.

These checks were read-only and did not create test subscribers or submissions in production.

## Automated verification

- Repository tests: 338/338 passed.
- TypeScript typecheck: passed.
- Production security advisors at warning level: 136 existing warnings; zero matched Communications or universal-form objects.
- Production performance advisors at warning level: 122 existing warnings; zero matched Communications or universal-form objects.

The advisor counts match the pre-release production counts recorded during preview verification, so this release introduced no new warning-level advisor finding.

The production database lint still reports two existing errors unrelated to Communications:

- `public.auto_sign_out_open_rows` references the absent `public.timesheet_entries` relation.
- `public.sync_current_memberships_to_app_tables` references a temporary relation that the static linter cannot resolve.

It also reports existing warnings in membership parsing functions. No lint finding names a Communications or universal-form object. These unrelated findings were not changed in this release.

## Current launch state

The production database is ready for the Communications application routes. The customer-facing form and portal cannot use this production foundation until a separately approved route/environment deployment is completed.

Still intentionally disabled or absent:

- Public Communications API routes in production
- `COMMUNICATIONS_HASH_SECRET` production configuration
- Twilio number provisioning and carrier registration
- Twilio inbound/status webhooks
- Resend sending-domain verification and outbound email delivery
- Outbound SMS, MMS, email, and voice delivery

