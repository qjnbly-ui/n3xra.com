# Resource Availability

Organization: **Klamath County Fire Defense Board**, `f30f90e6-c13b-4142-a258-9e93d2ba5f12`, on the N3XRA Supabase project `vdbjlgmbpykjblprqnak`.

## Access and workflow

Every current organization member has identical Resource Availability permissions, regardless of their portal role, agency, or duty assignment. All members can submit, correct, review, approve, record OSFM submission, and edit settings. Organization membership and product/account status remain server-enforced boundaries. No public or cross-organization access is granted. Existing organization invitation/administration permissions elsewhere in N3XRA are unchanged.

Both pages are gated until the portal session and app membership are checked. Copied URLs require the same checks as portal launch links. Sign-out clears the loaded app state; database RPCs verify current membership for every request. A draft product is visible only to platform administrators until publication/activation.

There are two main pages: Reporting form and Duty chief review. Review has Agency reports, OSFM summary, and Settings tabs. Settings contains collapsible sections for agencies, duty rotation, periods/deadlines, contacts, and change history. Report corrections stay beside submitted report details; OSFM summary editing stays on the summary tab. A duty assignment communicates responsibility and never locks other members out.

## Source-backed configuration

The live weekly Smartsheet form was read on September 5, 2026:
https://app.smartsheet.com/b/form/84dc3e63f0034fb29fa4ca62b6358400

It supplies the exact 25-agency dropdown, equipment/deployment questions, 12 overhead choices, and conditional additional-personnel details. The source workbook contains a broader, different list; its example availability is not imported as current data.

The supplied `Klamath_Lake_Responce_Guide_2026.docx` supplies Monday reporting, updates when availability changes, the before-1000 Monday OSFM deadline, the mixed one-/two-week duty assignments, and seven duty chiefs' business contact details. The initial database contains:

- 25 reporting agencies.
- 33 Monday–Sunday reporting periods, March 30–November 15, 2026.
- 20 duty assignments; the final November 10 assignment has no specified end date.
- Seven business contacts with guide-provided names, phones, and emails.
- No operational reports, approvals, or OSFM submission records.

Contacts can optionally link to an existing Board account. Their phone/name/email remain editable; no automatic website/account synchronization is claimed. No account or membership was created during setup.

Harney participates in collection but is excluded from the combined Klamath/Lake OSFM summary. Harney reports remain available for separate handling.

## Editing and consistency

Settings use per-row versions to reject stale contact, roster, and rotation edits. Rotation date ranges cannot overlap. Changing the chief updates open periods and invalidates any affected approval; closed periods retain their historical name. Period dates cannot overlap and are limited to 32 days. The expected roster is explicitly editable; an agency with a saved report cannot be removed from that period. Agency activation applies to newly created periods; pre-existing periods retain their roster until explicitly edited.

Agency corrections require a reason in the UI, carry the prior response version, and preserve earlier payloads in history. A repeated shared submission replaces the current agency/week response, so totals never count duplicates. Shared intake accepts the current open Pacific reporting week. Members can reopen another period and use Edit report for historical corrections.

Approval captures the reviewed roster and submissions. Counts cannot exceed submitted availability or simultaneous capacity; trainees cannot become qualified leaders. Missing reports and shared staffing require explanation. Changes invalidate stale approvals. Manual state submission records require a current approval and confirmation reference.

All tables use RLS. Direct mutations are revoked from browser roles; checked RPCs in a non-exposed schema control changes. Public RPC wrappers use security invoker. `ra_snapshot` returns one coherent statement snapshot, including saved contacts, rotation, and the latest 100 audit events. Full audit history is retained in the database. There is no hard-delete UI.

## Installed Supabase migrations

Applied and verified September 5, 2026 (Pacific):

- `20260906005357_resource_availability.sql`
- `20260906005411_resource_availability_shared_settings.sql`

Local filenames match the versions assigned by Supabase. The pre-existing organization-private-products registry was reused. Supabase security advisors reported no findings for these new app objects; unrelated project findings were left untouched. Verification confirmed RLS on all app tables, no anonymous reads, and no direct browser inserts.

## Build and verification

```sh
npm run build:availability
npx tsc -p availability-app/tsconfig.json --noEmit
npm run test:availability
```

`tests/resource-availability/database.mjs` verifies the base workflow in disposable PGlite. `shared-database.mjs` applies both migrations and verifies equal editor/viewer access, settings updates, contact links, stale edits, overlapping dates, corrections, approvals, history, and outsider/signed-out/revoked-member denial. Set `RA_PGLITE_PATH` to a temporary `@electric-sql/pglite@0.3.14` installation's `dist/index.js`. These tests never write production reports.

## Current release status

**Supabase is installed and populated. The updated website has not been published by this task. The private product remains Draft until the site is deployed and its portal launch is verified.**

The localhost-only `/resource-availability/preview/?view=review` view uses the actual review components with the documented roster/rotation when there is no session. It uses names-only reference contacts, explicitly marks live reports as not loaded, and disables all writes. It does not grant production access or fabricate submissions.

Publishing the existing site build and activating its private product remain release steps. The application has no OSFM API connection and sends no external notifications. The duty chief still completes the official state form and records its confirmation. Smartsheet and OSFM records were not changed.
