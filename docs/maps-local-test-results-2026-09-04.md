# Isolated Maps verification — September 4, 2026

## Isolation boundary

- Database: `maps_test_20260904`, inside the existing local Docker PostgreSQL container.
- Copied schema only from the existing local database; no organization or customer data copied.
- Applied the repository's Maps SQL files plus the organization-files prerequisite directly to the test database.
- Created synthetic identities, one synthetic organization, and two test layers only in that database.
- No production database calls, deployments, commits, or pushes were performed.
- The schema-only restore reported a denied `log_min_messages` setting. Maps schema loading and the functional checks below subsequently succeeded. This is not a complete platform migration replay or production-parity certification.

## Passed

- All 46 Maps automated tests, including five new tests of the actual workspace isolation calculation.
- Connect crossing, disconnect, repeat disconnect, and reconnect against real local PostGIS.
- A nonmember identity is rejected by the disconnect function.
- Removing one crossing preserves the other crossing and the original line geometry.
- Rebuilding endpoint connections does not recreate the removed manual crossing.
- Inserting a valve on either side of a junction preserves its connection to the correct resulting segment.
- Inserting a valve exactly at a junction is rejected as ambiguous.
- The other crossing line's geometry remains unchanged after a valve insertion.
- Confirmed branch connections include both connected meters in the predicted affected area.
- Unconnected crossings exclude the other branch's meter.
- An inoperable valve expands the estimate to the next usable valve.
- An alternate route around a valve prevents that valve from being treated as an isolation boundary.
- Unknown main endpoints keep the topology estimate incomplete.

The SQL fixture geometry is rolled back after each suite. The test database retains only its synthetic identities, organization, and empty layers. Latest Maps function definitions were restored after the transactional migration tests.

## Test maintenance

Updated one outdated roadmap wording assertion to match the documented distinction between connected meters and distinct customer references. No product behavior changed.

## Remaining verification

- Signed-in browser testing at desktop and mobile sizes, including map clicks and branch highlighting.
- A test-only frontend configuration and Mapbox token are needed before those browser tests; the current app page embeds shared platform configuration.
- End-to-end Auth/PostgREST/RLS testing. The SQL suites use database-admin connections with synthetic JWT identity settings; they verify function authorization, not the entire browser authentication or RLS path.
- Full-platform clean migration replay, concurrency tests, and production deployment remain separate gates.

These checks validate mapped-network estimates, not hydraulic accuracy or field isolation safety.

## Follow-up browser verification and approved deployment

- A loopback-only test server and separate PostgREST container were connected to the synthetic database. The browser used a synthetic authenticated JWT, not a production session. Login/password authentication itself was not tested.
- Restored existing local platform schema grants and added the synthetic organization membership for authenticated API access. No production data was copied.
- Chrome: connected the two synthetic pipes, inspected the junction, confirmed disconnect, reconnected, and inserted a valve on the east branch through the actual interface/API.
- Verified the resulting valve and two split segments, with the crossing connection retained.
- Verified all four branch choices and Cancel fit at 390×844; restored the viewport afterward.
- Found and fixed a missing branch highlight when map tiles were pending. The effect now retries on map idle as well as style load. Browser retest confirmed the orange north-branch highlight.
- All 46 tests, Maps build, TypeScript check, and whitespace check passed.
- Applied approved production migrations `20260904221239_maps_disconnect_crossing` and `20260904221258_maps_valve_preserve_crossings`; verified both function changes are present. Local migration filenames match the deployed ledger.
- Security advisor comparison: no new findings. Existing activation/team security-definer notices remain: https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable

The earlier remaining-verification list records the first test pass. This follow-up completes the targeted desktop workflow and phone-width branch-dialog check, not an exhaustive mobile, authentication, concurrency, or field test.
