# Migration-history reconciliation — 2026-08-31

## Scope

The linked production project `vdbjlgmbpykjblprqnak` was inspected before the Project Cards foundation was prepared and again after its approved deployment.

The only production writes were the four approved migration-history repairs and the application of `20260831130251_project_cards_foundation.sql`. No customer project, card, resource, storage object, or Auth record was created or changed.

## Production-ledger filename normalization

Thirty-one repository migrations had the same migration name and intent as production but used a different timestamp. Their prior local versions are preserved under:

`supabase/migration-design-references/production-ledger-reconciliation-2026-08-31/`

The active files now use these production versions:

- `20260824131658_connect_website_to_existing_organization.sql`
- `20260824193739_add_admin_calls_and_messages.sql`
- `20260824211313_add_admin_notification_sms_delivery.sql`
- `20260824212031_admin_notification_delivery_preferences.sql`
- `20260824214001_track_website_change_production_deployment.sql`
- `20260824214727_remove_website_change_building_email_tracking.sql`
- `20260825031036_add_n3xra_live_website_previews.sql`
- `20260825033536_auto_start_client_fast_previews.sql`
- `20260825040530_allow_admin_immediate_failed_preview_retry.sql`
- `20260825043902_reusable_fast_preview_sessions.sql`
- `20260826115940_contact_card_profiles.sql`
- `20260826120111_index_contact_card_audit_users.sql`
- `20260826124758_allow_admin_partial_contact_cards.sql`
- `20260826130905_notify_admin_on_contact_card_request.sql`
- `20260826151643_communications_product_billing.sql`
- `20260826151819_communications_product_billing_indexes.sql`
- `20260826170812_communications_twilio_onboarding.sql`
- `20260826204348_build_studio_foundation.sql`
- `20260826232224_add_contact_card_extra_contacts.sql`
- `20260827032424_allow_customer_profile_updates_during_fulfillment.sql`
- `20260827034813_grant_contact_card_admin_owner_updates.sql`
- `20260827052555_contact_card_commerce.sql`
- `20260827053121_index_contact_card_order_profiles.sql`
- `20260827153004_organization_admin_product_overview.sql`
- `20260827213257_organization_product_member_permissions.sql`
- `20260827213352_index_organization_product_access_grantor.sql`
- `20260828152417_contact_card_scanned_contacts.sql`
- `20260829010505_unified_product_access_grants.sql`
- `20260830203919_website_publishing_foundation.sql`
- `20260830204253_website_publishing_foreign_key_indexes.sql`
- `20260830221944_isolate_website_publishing_assets.sql`

Repository tests that referenced the former timestamps were updated to the production-ledger versions.

## Same-version replay SQL

The fetched production statements were compared with active same-version files. Some production ledger entries contain only a note because the actual change was applied through the hosted SQL editor. For example, production migration `20260828160512_contact_card_premium_subscription.sql` contains only an application note, while the repository version contains the schema required to rebuild Contact Card Premium.

The active same-version repository files therefore retain the replay-capable SQL. The reconciliation archive contains only the 31 replaced timestamp variants; unchanged active replay files were not duplicated.

## Verified unledgered production schema

Four active repository migrations still have no production ledger row. A read-only production schema dump confirmed their effects are already present:

- `20260824171623_gate_website_ai_preview_and_use_connected_repository.sql`
  - The website-change claim function exists and has since been superseded by later revisions.
- `20260824172433_track_website_change_client_emails.sql`
  - All three client-email delivery columns, comments, and authenticated column grants exist.
- `20260824173413_add_website_change_progress_tracking.sql`
  - The repository, workflow, progress, and failure columns and constraints exist and have since been extended.
- `20260824195612_add_admin_voice_configuration.sql`
  - The server-only table, checks, RLS state, and service-role grants exist.

These were repaired as applied in the production migration ledger without executing their SQL, because their schema effects already existed.

## Project Cards foundation

Created locally as:

`20260831130251_project_cards_foundation.sql`

It adds:

- Organization-owned projects and ordered resources.
- Permanent cryptographically random physical-card identities.
- Reassignment, unassignment, deactivation, and irreversible retirement.
- Immutable card lifecycle events.
- Product-role-aware tenant isolation and RLS.
- Narrow public resolver/page functions that do not grant anonymous table access.
- Explicit Data API grants for authenticated users and public functions.

## Verification

- Project Cards migration applied successfully to the local Supabase database.
- The local RLS verification transaction passed:
  - editor create and assignment;
  - viewer mutation denial;
  - public resource output;
  - permanent token generation;
  - irreversible card retirement;
  - lifecycle audit events.
- Local Supabase security advisor reported no new Project Cards warnings. The production advisor identifies the five intentional Project Cards `SECURITY DEFINER` RPC grants: anonymous and authenticated execution of the two read-only public lookup functions, plus authenticated execution of card creation. These are the designed API boundary and retain explicit authorization checks and fixed search paths.
- Local performance advisor reported no Project Cards warnings.
- Focused application and migration suite: 189/189 passed.
- Full build completed; the full repository test run has one unrelated existing footer-consistency failure because several legacy pages have not yet copied the homepage's Communications footer link.
- The approved production ledger repair marked only versions `20260824171623`, `20260824172433`, `20260824173413`, and `20260824195612` as applied.
- The post-repair dry run selected exactly `20260831130251_project_cards_foundation.sql`, which was then applied successfully.
- Production verification confirmed all four Project Cards tables exist with RLS enabled.
- Anonymous direct table reads and authenticated card deletion are denied; the two intended anonymous resolver/page RPCs are executable.
- Invalid token and invalid slug lookups fail closed, the product catalog entry exists, and the migration ledger records version `20260831130251`.
- The production performance advisor reported no Project Cards warnings.

## Existing clean-replay limitation

The historical Communications carrier-onboarding migration assumes the Roots & Relics organization already exists before inserting its pricing override. A blank local database therefore needs that organization fixture inserted before the migration can replay. This is pre-existing production-data coupling and is separate from Project Cards.

## Production deployment

Completed on 2026-08-31:

1. Reconfirmed the four unledgered schema effects in production.
2. Applied the four history-only repairs.
3. Confirmed a normal dry run contained only the Project Cards migration.
4. Applied `20260831130251_project_cards_foundation.sql`.
5. Verified production schema presence, RLS, grants, fail-closed lookups, catalog registration, migration history, and advisor results.
