import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Maps starts as an empty reusable N3XRA product", async () => {
  const [workspace, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("supabase/migrations/20260903042333_maps_foundation.sql"),
  ]);

  assert.match(workspace, /No layers yet/);
  assert.match(workspace, /className="maps-gate-logo"/);
  assert.doesNotMatch(workspace, /className="maps-gate-mark"/);
  assert.doesNotMatch(workspace, /maps-empty-list"><span>◇/);
  assert.match(workspace, /maps_access_list/);
  assert.match(workspace, /maps_workspace_snapshot/);
  assert.doesNotMatch(workspace, /Bly Water|sample organization|demo organization/i);
  assert.match(migration, /values \(\s*'maps'/);
  assert.doesNotMatch(migration, /insert into public\.organization_product_entitlements/i);
  assert.doesNotMatch(migration, /insert into public\.organization_product_member_access/i);
});

test("Maps supports secure tenant layers, field pins, and future connections", async () => {
  const [workspace, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("supabase/migrations/20260903042333_maps_foundation.sql"),
  ]);

  assert.match(workspace, /watchPosition/);
  assert.match(workspace, /getCurrentPosition/);
  assert.match(workspace, /enableHighAccuracy: true/);
  assert.match(workspace, /enableHighAccuracy: false/);
  assert.match(workspace, /Cancel location search/);
  assert.doesNotMatch(workspace, /navigator\.permissions\.query/);
  assert.match(workspace, /window\.isSecureContext/);
  assert.match(workspace, /locationRequestIdRef/);
  assert.match(workspace, /stopLocating/);
  assert.match(workspace, /new mapboxgl\.Marker\(\{ element \}\)[\s\S]*?\.setLngLat\(coordinates\)[\s\S]*?\.addTo\(map\)/);
  assert.match(workspace, /Center on me/);
  assert.match(workspace, /If your browser asks to use your location, choose Allow/);
  assert.match(workspace, /Allow Location in your browser settings/);
  assert.match(workspace, /Satellite/);
  assert.match(workspace, /attributionControl: false/);
  assert.match(workspace, /logoPosition: "top-right"/);
  assert.match(workspace, /new mapboxgl\.AttributionControl\(\), "top-right"/);
  assert.match(workspace, /create_map_point/);
  assert.match(workspace, /Edit item/);
  assert.match(workspace, /saveFeatureDetails/);
  assert.match(workspace, /\.from\("map_features"\)[\s\S]*?\.update\(\{/);
  assert.match(workspace, /\.eq\("organization_id", activeAccess\.organizationId\)/);
  assert.match(workspace, /Mapped item updated/);
  assert.match(migration, /create extension if not exists postgis/);
  assert.match(migration, /geometry extensions\.geometry\(Geometry, 4326\)/);
  assert.match(migration, /future_customer_account_id uuid/);
  assert.match(migration, /future_work_order_id uuid/);
  assert.match(migration, /alter table public\.map_layers enable row level security/);
  assert.match(migration, /alter table public\.map_features enable row level security/);
  assert.doesNotMatch(migration, /grant delete/i);
});

test("Maps is discoverable from the dashboard, homepage, and standard footer", async () => {
  const [home, account, accountSource, navigation, landing] = await Promise.all([
    read("index.html"),
    read("account/index.html"),
    read("account/account.js"),
    read("assets/site-nav.js"),
    read("maps-app/src/pages/index.astro"),
  ]);

  assert.match(home, /<strong>N3XRA Maps<\/strong>/);
  assert.match(account, /id="maps-product-card"/);
  assert.match(account, /Paid plans are coming soon/);
  assert.match(accountSource, /rpc\("maps_access_list"\)/);
  assert.match(accountSource, /Request Maps Access/);
  assert.match(home, /<nav class="footer-nav" aria-label="Software">[\s\S]*?<a href="\/maps\/">Maps<\/a>/);
  assert.doesNotMatch(navigation, /footer-product-grid|Products built for real work|ensureProductFooterCards/);
  assert.match(landing, /<nav class="footer-nav" aria-label="Software"><p>Software<\/p><a href="\/maps\/">Maps<\/a>/);
  await assert.rejects(access(new URL("../../assets/product-footer.css", import.meta.url)));
});

test("Maps has a public product presentation and a separate signed-in workspace", async () => {
  const [landing, app, accountSource, routeMigration] = await Promise.all([
    read("maps-app/src/pages/index.astro"),
    read("maps-app/src/pages/app/index.astro"),
    read("account/account.js"),
    read("supabase/migrations/20260903050033_maps_public_landing_route.sql"),
  ]);

  assert.match(landing, /Know the system\.<br \/><em>Find the asset\.<\/em><br \/>Run the response\./);
  assert.match(landing, /The map is only the beginning/);
  assert.match(landing, /standards-based layers for meters, valves, hydrants, mains/i);
  assert.match(landing, /maps-workspace-live\.jpg/);
  assert.match(landing, /maps-asset-history-panel\.png/);
  assert.match(landing, /One utility system instead of disconnected software/);
  assert.match(landing, /customer portal, account management, billing, meter data, Maps, files, service requests, and communications/);
  assert.match(landing, /Available through guided N3XRA onboarding/);
  assert.match(landing, /href="\/maps\/app\/"/);
  assert.match(app, /<MapsWorkspace client:load/);
  assert.match(accountSource, /mapsProductLink\.href = "\/maps\/app\/"/);
  assert.match(routeMigration, /portal_path = '\/maps\/app\/'/);
  assert.doesNotMatch(landing, /Bly Water|sample organization|demo organization/i);
});

test("Maps presentation is native-width on phones with the standard N3XRA footer and polished icons", async () => {
  const [landing, productStyles, projectCards, navigation] = await Promise.all([
    read("maps-app/src/pages/index.astro"),
    read("maps-app/src/styles/maps-product.css"),
    read("project-cards/index.html"),
    read("assets/site-nav.js"),
  ]);

  assert.match(landing, /\/assets\/project-cards\.css\?v=4/);
  assert.match(landing, /class="site-topbar home-topbar cards-topbar maps-topbar"/);
  assert.match(landing, /<nav class="desktop-nav" aria-label="Primary"><a href="\/projects\/">Projects<\/a><a href="\/services\/">Services<\/a><a href="\/support\/">Support<\/a><a href="\/#software">Software<\/a><\/nav>/);
  assert.match(landing, /class="site-footer home-footer"/);
  assert.match(landing, /id="maps-icon-meter"/);
  assert.match(landing, /id="maps-icon-valve"/);
  assert.match(landing, /id="maps-icon-boundary"/);
  assert.match(landing, /id="maps-icon-locate"/);
  assert.doesNotMatch(landing, /class="step-icon">[▧＋⌖]/);
  assert.match(productStyles, /--maps-public-navy: #0b1219/);
  assert.match(productStyles, /--maps-public-mint: #69d2c4/);
  assert.match(productStyles, /--maps-public-orange: #f0a03b/);
  assert.match(productStyles, /\.maps-live-frame img/);
  assert.match(productStyles, /@media \(max-width: 720px\)/);
  assert.match(productStyles, /\.maps-icon \{/);
  assert.doesNotMatch(productStyles, /--ml-|transform: scale/);
  assert.match(projectCards, /site-nav\.js\?v=7/);
  assert.doesNotMatch(navigation, /Products built for real work/);
});

test("Every public Software footer lists Maps as one ordinary link", async () => {
  const footerPages = [
    "index.html", "account/index.html", "account/notifications/index.html",
    "ai-music-generator/index.html", "careers/index.html", "contact-card/index.html",
    "invest/index.html", "n3xra-records/login.html", "nexra-communications/index.html",
    "partners/change-of-control/index.html", "partners/index.html", "partners/terms/index.html",
    "privacy/index.html", "privacy/n3xra-admin/index.html", "project-pulse/index.html",
    "projects/index.html", "records/index.html", "services/index.html", "support/index.html",
    "terms/index.html", "updates/index.html", "utilities/index.html",
    "utilities/onboarding/index.html", "virals/index.html",
  ];

  for (const page of footerPages) {
    const html = await read(page);
    const softwareFooter = html.match(/<nav[^>]+aria-label="Software"[^>]*>[\s\S]*?<\/nav>/)?.[0] || "";
    assert.match(softwareFooter, /<a href="\/maps\/">Maps<\/a>/, `${page} should list Maps in Software`);
    assert.equal((softwareFooter.match(/href="\/maps\/"/g) || []).length, 1, `${page} should list Maps once`);
  }
});

test("Maps early access is requested by the account and decided in a dedicated admin workspace", async () => {
  const [migration, account, accountPage, adminPage, adminComponent, adminNavigation, landing] = await Promise.all([
    read("supabase/migrations/20260903140400_maps_early_access_approval.sql"),
    read("account/account.js"),
    read("account/index.html"),
    read("maps-app/src/pages/admin/index.astro"),
    read("maps-app/src/components/MapsAdmin.tsx"),
    read("account/admin/admin-navigation.js"),
    read("maps-app/src/pages/index.astro"),
  ]);

  assert.match(migration, /create table(?: if not exists)? public\.maps_access_requests/);
  assert.match(migration, /status in \('pending', 'approved', 'declined'\)/);
  assert.match(migration, /alter table public\.maps_access_requests enable row level security/);
  assert.match(migration, /user_id = \(select auth\.uid\(\)\)/);
  assert.match(migration, /or \(select public\.is_platform_admin\(\)\)/);
  assert.match(migration, /create or replace function public\.maps_request_early_access\(\)/);
  assert.match(migration, /revoke all on function public\.maps_request_early_access\(\) from public, anon/);
  assert.doesNotMatch(migration, /insert into public\.organizations|Bly Water|sample organization/i);

  assert.match(account, /rpc\("maps_request_early_access"\)/);
  assert.match(account, /maps_access_requests/);
  assert.match(account, /Pending Approval/);
  assert.match(account, /mapsAccessRequest\?\.status === "approved"/);
  assert.match(accountPage, /id="maps-product-link" href="#">Request Early Access/);
  assert.match(landing, /href="\/account\/\?product=maps#available-apps-section">Get N3XRA Maps/);

  assert.match(adminPage, /<MapsAdmin client:load/);
  assert.match(adminComponent, /Approve access/);
  assert.match(adminComponent, /No organization, customer, layer, pin, or example data will be created/);
  assert.match(adminComponent, /\.from\("maps_access_requests"\)/);
  assert.match(adminComponent, /classList\.remove\("portal-loading"\)/);
  assert.match(adminComponent, /n3xra:product-shell-ready/);
  assert.match(adminNavigation, /label: "Maps"/);
  assert.match(adminNavigation, /"\/maps\/admin\/"/);
});

test("Approved users can activate a blank Maps workspace on an existing or new organization", async () => {
  const [migration, workspace, styles] = await Promise.all([
    read("supabase/migrations/20260903150109_maps_workspace_activation.sql"),
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
  ]);

  assert.match(migration, /create or replace function public\.maps_activation_options\(\)/);
  assert.match(migration, /create or replace function public\.activate_maps_workspace\(/);
  assert.match(migration, /access_request\.status <> 'approved'/);
  assert.match(migration, /membership\.role = 'account_admin'/);
  assert.match(migration, /insert into public\.organization_product_entitlements/);
  assert.match(migration, /insert into public\.organization_product_member_access/);
  assert.match(migration, /'product_key',[\s\S]*'maps'|product_key,[\s\S]*'maps'/);
  assert.doesNotMatch(migration, /insert into public\.map_layers|insert into public\.map_features|Bly Water/i);
  assert.match(migration, /revoke all on function public\.activate_maps_workspace\(uuid, text\) from public, anon/);

  assert.match(workspace, /rpc\("maps_activation_options"\)/);
  assert.match(workspace, /rpc\("activate_maps_workspace"/);
  assert.match(workspace, /Existing organization/);
  assert.match(workspace, /New organization/);
  assert.match(workspace, /Your workspace starts empty/);
  assert.match(workspace, /Create blank Maps workspace/);
  assert.match(styles, /\.maps-activation-modes/);
});

test("Maps uses a clean N3XRA product header without the user identity block", async () => {
  const [workspace, styles] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
  ]);

  assert.match(workspace, /n3xra_logo_transparent_small\.png/);
  assert.match(workspace, /activeAccess\?\.organizationName/);
  assert.match(workspace, /isBrandedPortalHostname/);
  assert.match(workspace, /href: "\/client-portal\/", label: "Return to dashboard"/);
  assert.match(workspace, /href: "\/account\/", label: "Dashboard"/);
  assert.match(workspace, /href=\{dashboardDestination\.href\}/);
  assert.doesNotMatch(workspace, /className="maps-account-context"/);
  assert.doesNotMatch(workspace, /from\("profiles"\)/);
  assert.match(styles, /\.maps-header \{[^}]*background: #0b1219/);
  assert.doesNotMatch(styles, /\.maps-header \{[^}]*radial-gradient/);
  assert.match(styles, /--maps-gold: #ea9b3f/);
  assert.doesNotMatch(styles, /\.maps-account-avatar/);
});

test("Maps keeps all field controls visible above mobile browser chrome", async () => {
  const styles = await read("maps-app/src/styles/maps.css");

  assert.match(styles, /height: calc\(100dvh - 64px\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.maps-field-tools \{ left: \.65rem; right: \.65rem/);
  assert.doesNotMatch(styles, /\.maps-field-tools button span \{ display: none; \}/);
});

test("Maps keeps saved points anchored, frames saved data, and archives deleted items", async () => {
  const [workspace, styles] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
  ]);

  assert.match(workspace, /new mapboxgl\.LngLatBounds/);
  assert.match(workspace, /map\.fitBounds\(bounds/);
  assert.match(workspace, /fittedOrganizationRef/);
  assert.match(workspace, /projection: "mercator"/);
  assert.match(workspace, /anchor: "center",[\s\S]*?offset: \[0, 0\]/);
  assert.match(styles, /\.maps-marker \{[^}]*position: absolute/);
  assert.doesNotMatch(styles, /\.maps-marker \{[^}]*position: relative/);
  assert.match(workspace, /Delete item/);
  assert.match(workspace, /\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(workspace, /Its saved record is archived so it can be recovered later/);
  assert.doesNotMatch(styles, /\.maps-marker::before/);
  assert.match(styles, /\.maps-marker > span[^}]*width: 31px/);
  assert.doesNotMatch(styles, /\.maps-marker \{[^}]*transition:\s*transform/);
  assert.match(styles, /\.maps-marker\.is-selected > span[^}]*transform: scale/);
  assert.doesNotMatch(styles, /\.maps-marker \{[^}]*rotate:/);
  assert.doesNotMatch(styles, /\.maps-marker\.is-selected \{[^}]*scale:/);
});

test("Maps layers can be edited, archived, restored, and permanently deleted by account admins", async () => {
  const [workspace, styles, migration, purgeMigration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903192631_maps_layer_archive_management.sql"),
    read("supabase/migrations/20260904153451_maps_permanent_layer_purge.sql"),
  ]);

  assert.match(workspace, /Edit layer/);
  assert.match(workspace, /Archive layer/);
  assert.match(workspace, /maps_archive_layer/);
  assert.match(workspace, /maps_restore_layer/);
  assert.match(workspace, /Delete forever/);
  assert.match(workspace, /canPermanentlyDelete = activeAccess\?\.role === "account_admin"/);
  assert.match(workspace, /maps_archived_layer_storage_manifest/);
  assert.match(workspace, /maps_permanently_delete_archived_layer/);
  assert.match(workspace, /immutable history, incidents, updates, tasks, photos, and linked file records/);
  assert.match(workspace, /\.from\("map_layers"\)[\s\S]*?\.not\("archived_at", "is", null\)/);
  assert.match(workspace, /\.from\("map_features"\)[\s\S]*?\.not\("archived_at", "is", null\)/);
  assert.match(styles, /\.maps-archive-dialog/);

  assert.match(migration, /create policy "map_layers_delete_archived"/);
  assert.match(migration, /create policy "map_features_delete_archived"/);
  assert.match(migration, /organization_product_role\(organization_id, 'maps'\)\) = 'account_admin'/);
  assert.match(migration, /archived_at is not null/);
  assert.match(migration, /security invoker/g);
  assert.match(migration, /and archived_at = archived_timestamp/);
  assert.match(migration, /revoke all on function public\.maps_archive_layer\(uuid, uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.maps_restore_layer\(uuid, uuid\) to authenticated/);

  assert.match(purgeMigration, /create or replace function private\.maps_permanently_delete_archived_layer/);
  assert.match(purgeMigration, /security definer/);
  assert.match(purgeMigration, /organization_product_role\(input_organization_id, 'maps'\) is distinct from 'account_admin'/);
  assert.match(purgeMigration, /layer\.archived_at is not null/);
  assert.match(purgeMigration, /delete from public\.map_incident_updates/);
  assert.match(purgeMigration, /delete from public\.map_incidents/);
  assert.match(purgeMigration, /delete from public\.map_tasks/);
  assert.match(purgeMigration, /delete from public\.map_events/);
  assert.match(purgeMigration, /delete from public\.map_feature_photos/);
  assert.match(purgeMigration, /delete from public\.organization_file_folders/);
  assert.match(purgeMigration, /delete from public\.map_features/);
  assert.match(purgeMigration, /delete from public\.map_layers/);
  assert.match(purgeMigration, /revoke all on function private\.maps_permanently_delete_archived_layer\(uuid, uuid\) from public, anon/);
});

test("Maps permanent layer purge safely defers self-referential event checks", async () => {
  const migration = await read("supabase/migrations/20260904154334_fix_maps_layer_purge_deferred_constraints.sql");

  assert.match(migration, /create or replace function private\.maps_permanently_delete_archived_layer/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /set constraints all deferred/);
  assert.doesNotMatch(migration, /set constraints map_events_amends_fkey deferred/);
});

test("Mapped points can be repositioned with review before saving", async () => {
  const [workspace, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903193434_maps_move_point.sql"),
  ]);

  assert.match(workspace, /Move point/);
  assert.match(workspace, /draggable: isMoving/);
  assert.match(workspace, /marker\.on\("dragend"/);
  assert.match(workspace, /Drag the selected point or click its new position/);
  assert.match(workspace, /Use GPS/);
  assert.match(workspace, /Keep original/);
  assert.match(workspace, /Save new location/);
  assert.match(workspace, /rpc\("move_map_point"/);
  assert.match(styles, /\.maps-marker\.is-moving/);
  assert.match(styles, /\.maps-move-banner/);

  assert.match(migration, /create or replace function public\.move_map_point/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /organization_product_role\(input_organization_id, 'maps'\) not in \('account_admin', 'editor'\)/);
  assert.match(migration, /extensions\.st_setsrid/);
  assert.match(migration, /extensions\.st_makepoint\(input_longitude, input_latitude\)/);
  assert.match(migration, /feature\.archived_at is null/);
  assert.match(migration, /layer\.archived_at is null/);
  assert.match(migration, /revoke all on function public\.move_map_point[\s\S]*from public, anon/);
});

test("Maps provides internal driving directions to a selected point", async () => {
  const [workspace, styles] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
  ]);

  assert.match(workspace, /directions\/v5\/mapbox\/driving-traffic/);
  assert.match(workspace, /geometries: "geojson"/);
  assert.match(workspace, /overview: "full"/);
  assert.match(workspace, /steps: "true"/);
  assert.match(workspace, /DRIVING_ROUTE_SOURCE_ID = "maps-driving-route"/);
  assert.match(workspace, />Directions<\/button>/);
  assert.match(workspace, /Update route/);
  assert.match(workspace, /Close directions/);
  assert.match(workspace, /Finding your location before building the route/);
  assert.match(workspace, /voice_instructions: "true"/);
  assert.match(workspace, /banner_instructions: "true"/);
  assert.match(workspace, /Start navigation/);
  assert.match(workspace, /LIVE NAVIGATION/);
  assert.match(workspace, /navigator\.geolocation\.watchPosition/);
  assert.match(workspace, /You left the route\. Finding a new one/);
  assert.match(workspace, /speechSynthesis\.speak/);
  assert.match(workspace, /Stop navigation/);
  assert.match(workspace, /Keep this page open while navigating/);
  assert.match(styles, /\.maps-route-card/);
  assert.match(styles, /\.maps-route-steps/);
  assert.match(styles, /\.maps-current-turn/);
});

test("Maps asset records support custom fields, private photos, and future customer references", async () => {
  const [workspace, types, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/maps-types.ts"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903203527_maps_asset_records.sql"),
  ]);

  assert.match(workspace, /Custom asset fields/);
  assert.match(workspace, /Customer\/account reference/);
  assert.match(workspace, /MAPS_PHOTO_BUCKET = "maps-asset-photos"/);
  assert.match(workspace, /createSignedUrl/);
  assert.match(workspace, /uploadFeaturePhoto/);
  assert.match(workspace, /Object\.values\(feature\.properties/);
  assert.match(types, /interface MapLayerField/);
  assert.match(types, /customer_reference: string \| null/);
  assert.match(styles, /\.maps-asset-photos/);
  assert.match(styles, /\.maps-custom-fields-editor/);
  assert.match(workspace, /Available choices/);
  assert.match(workspace, /Separate each choice with a comma/);

  assert.match(migration, /create table public\.map_layer_fields/);
  assert.match(migration, /create table public\.map_feature_photos/);
  assert.match(migration, /alter table public\.map_layer_fields enable row level security/);
  assert.match(migration, /alter table public\.map_feature_photos enable row level security/);
  assert.match(migration, /grant select, insert, update, delete on public\.map_layer_fields to authenticated/);
  assert.match(migration, /'maps-asset-photos'/);
  assert.match(migration, /public\.organization_product_role\(feature\.organization_id, 'maps'\)/);
  assert.match(migration, /owner_id = \(select auth\.uid\(\)\)::text/);
});

test("Maps draws and securely saves line and polygon features", async () => {
  const [workspace, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903205103_maps_shape_drawing.sql"),
  ]);

  assert.match(workspace, /SAVED_SHAPES_SOURCE_ID = "maps-saved-shapes"/);
  assert.match(workspace, /DRAFT_SHAPE_SOURCE_ID = "maps-draft-shape"/);
  assert.match(workspace, /DRAFT_SHAPE_CASING_ID = "maps-draft-shape-casing"/);
  assert.match(workspace, /shapeHoverCoordinate/);
  assert.match(workspace, /map\.on\("mousemove", handleShapeMove\)/);
  assert.match(workspace, /Draw line/);
  assert.match(workspace, /Draw boundary/);
  assert.match(workspace, />Undo<\/span>/);
  assert.match(workspace, /Finish line/);
  assert.match(workspace, /Finish boundary/);
  assert.match(workspace, /rpc\("create_map_shape"/);
  assert.match(workspace, /geometryCoordinates\(selectedFeature\.geometry\)/);
  assert.match(styles, /\.maps-drawing-banner/);

  assert.match(migration, /create or replace function public\.create_map_shape/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /layer\.geometry_type in \('line', 'polygon'\)/);
  assert.match(migration, /extensions\.st_geomfromgeojson/);
  assert.match(migration, /extensions\.st_isvalid/);
  assert.match(migration, /extensions\.st_npoints\(parsed_geometry\) > 5001/);
  assert.match(migration, /revoke all on function public\.create_map_shape[\s\S]*from public, anon/);
});

test("Saved line and polygon geometry can be reviewed and edited", async () => {
  const [workspace, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903211217_maps_shape_editing.sql"),
  ]);

  assert.match(workspace, /Edit shape/);
  assert.match(workspace, /maps-shape-vertex/);
  assert.match(workspace, /draggable: true/);
  assert.match(workspace, /Remove point/);
  assert.match(workspace, /Drag points · select a point to remove · click map to add/);
  assert.match(workspace, /Save shape changes/);
  assert.match(workspace, /rpc\("update_map_shape"/);
  assert.match(styles, /\.maps-shape-vertex\.is-selected/);

  assert.match(migration, /create or replace function public\.update_map_shape/);
  assert.match(migration, /security invoker/);
  assert.match(migration, /layer\.geometry_type = feature\.geometry_type/);
  assert.match(migration, /extensions\.st_geomfromgeojson/);
  assert.match(migration, /extensions\.st_isvalid/);
  assert.match(migration, /updated_by_user_id = auth\.uid\(\)/);
  assert.match(migration, /revoke all on function public\.update_map_shape[\s\S]*from public, anon/);
});

test("Compatible utility lines snap together and persist network connections", async () => {
  const [workspace, types, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/maps-types.ts"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260904155633_maps_network_line_connections.sql"),
  ]);

  assert.match(workspace, /nearestLineSnap/);
  assert.match(workspace, /LINE_SNAP_PIXELS = 18/);
  assert.match(workspace, /LINE_SNAP_METERS = 3/);
  assert.match(workspace, /Connect to \$\{shapeSnapTarget\.title\}/);
  assert.match(workspace, /map_network_connections/);
  assert.match(workspace, /Saved as utility-network relationships for future flow and shutoff analysis/);
  assert.match(types, /interface MapNetworkConnection/);
  assert.match(styles, /\.maps-network-status\.is-connected/);

  assert.match(migration, /create table public\.map_network_connections/);
  assert.match(migration, /alter table public\.map_network_connections enable row level security/);
  assert.match(migration, /grant select on public\.map_network_connections to authenticated/);
  assert.match(migration, /create policy "map_network_connections_select"/);
  assert.match(migration, /private\.maps_snap_line_geometry/);
  assert.match(migration, /extensions\.st_closestpoint/);
  assert.match(migration, /extensions\.st_dwithin[\s\S]*input_tolerance_m/);
  assert.match(migration, /private\.maps_rebuild_line_connections/);
  assert.match(migration, /connected_fraction/);
  assert.match(migration, /map_features_refresh_network_connections/);
  assert.match(migration, /layer_geometry_type = 'line'[\s\S]*private\.maps_snap_line_geometry/);
  assert.match(migration, /feature_geometry_type = 'line'[\s\S]*private\.maps_snap_line_geometry/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.map_network_connections to authenticated/i);
});

test("Maps administrators assign product roles while editors and viewers remain scoped", async () => {
  const [workspace, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903215319_maps_team_access_roles.sql"),
  ]);

  assert.match(workspace, /maps_team_snapshot/);
  assert.match(workspace, /maps_set_member_role/);
  assert.match(workspace, /Team access/);
  assert.match(workspace, /No one is assigned automatically/);
  assert.match(workspace, /Administrator[\s\S]*Manages Maps users, layers, archives, and assets/);
  assert.match(workspace, /Editor[\s\S]*Places and edits mapped assets without changing layer structure/);
  assert.match(workspace, /Viewer[\s\S]*without changing data/);
  assert.match(workspace, /canManageLayers && <button[^>]+maps-add-layer-button/);
  assert.match(workspace, /canManageLayers && <button[^>]+maps-layer-settings/);
  assert.match(styles, /\.maps-team-dialog/);

  assert.match(migration, /create or replace function public\.maps_team_snapshot\(input_organization_id uuid\)/);
  assert.match(migration, /create or replace function public\.maps_set_member_role\(/);
  assert.match(migration, /security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(migration, /input_role not in \('account_admin', 'editor', 'viewer'\)/);
  assert.match(migration, /Choose an existing organization member/);
  assert.match(migration, /The organization owner always has Maps administrator access/);
  assert.match(migration, /revoke all on function public\.maps_team_snapshot\(uuid\) from public, anon/);
  assert.match(migration, /grant execute on function public\.maps_team_snapshot\(uuid\) to authenticated/);
  assert.match(migration, /map_layers_insert[\s\S]*organization_product_role\(organization_id, 'maps'\)\) = 'account_admin'/);
  assert.match(migration, /map_layer_fields_insert[\s\S]*organization_product_role\(organization_id, 'maps'\)\) = 'account_admin'/);
});

test("Maps provides original standards-based symbols, presets, and a live legend", async () => {
  const [workspace, standards, styles] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/map-standards.tsx"),
    read("maps-app/src/styles/maps.css"),
  ]);

  assert.match(standards, /STANDARD_LAYER_PRESETS/);
  assert.match(standards, /Blue follows the APWA\/811 potable-water identification convention/);
  assert.match(standards, /Green follows the APWA\/811 sewer and drainage convention/);
  assert.match(standards, /Purple follows the APWA\/811 reclaimed-water convention/);
  assert.match(standards, /Water meters/);
  assert.match(standards, /Water valves/);
  assert.match(standards, /Fire hydrants/);
  assert.match(standards, /Sewer manholes/);
  assert.match(standards, /Tax parcels/);
  assert.match(standards, /mapSymbolMarkup/);
  assert.match(workspace, /N3XRA recommended standard/);
  assert.match(workspace, /Names, details, and line or boundary colors can be adapted for your system/);
  assert.match(workspace, /Choose an asset symbol/);
  assert.match(workspace, /geometryType === "point"/);
  assert.match(workspace, /mapSymbolColor\(newLayerDraft\.iconKey\)/);
  assert.doesNotMatch(styles, /\.maps-marker::before/);
  assert.match(styles, /\.maps-symbol-picker/);
  assert.match(workspace, /Legend updates automatically|Updates automatically from your visible layers/);
  assert.match(workspace, /map_layer_fields/);
  assert.match(styles, /\.maps-legend/);
  assert.match(styles, /\.maps-standard-note/);
});

test("Maps photos are registered in each organization's Files and Assets library", async () => {
  const [migration, filesApp, workspace] = await Promise.all([
    read("supabase/migrations/20260903222840_link_maps_photos_to_organization_files.sql"),
    read("client-portal/files-app.js"),
    read("maps-app/src/components/MapsWorkspace.tsx"),
  ]);

  assert.match(migration, /source_product in \('files_assets', 'websites', 'project_cards', 'maps'\)/);
  assert.match(migration, /organization_file_id uuid[\s\S]*references public\.organization_files\(id\) on delete cascade/);
  assert.match(migration, /private\.link_map_photo_to_organization_files/);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/);
  assert.match(migration, /organization_product_role\(new\.organization_id, 'maps'\) not in \('account_admin', 'editor'\)/);
  assert.match(migration, /'maps-asset-photos'/);
  assert.match(migration, /revoke all on function private\.link_map_photo_to_organization_files\(\) from public, anon, authenticated/);
  assert.match(filesApp, /activeLocation === "maps"/);
  assert.match(filesApp, /button\("maps", "Maps"/);
  assert.match(workspace, /organization_file_id/);
});

test("Maps ties permanent operational history and completable tasks to assets", async () => {
  const [workspace, types, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/maps-types.ts"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260904000840_maps_events_and_tasks.sql"),
  ]);

  assert.match(types, /export interface MapEvent/);
  assert.match(types, /export interface MapTask/);
  assert.match(workspace, /\["details", "history", "tasks", "files"\]/);
  assert.match(workspace, /Permanent history/);
  assert.match(workspace, /Submitted records cannot be edited or deleted/);
  assert.match(workspace, /Water-main response/);
  assert.match(workspace, /Overflow response/);
  assert.match(workspace, /Valve inspection/);
  assert.match(workspace, /Hydrant inspection/);
  assert.match(workspace, /future requests/);
  assert.match(workspace, /rpc\("maps_complete_task"/);
  assert.match(workspace, /Complete and record/);
  assert.match(styles, /\.maps-asset-tabs/);
  assert.match(styles, /\.maps-history-list/);
  assert.match(styles, /\.maps-task-list/);

  assert.match(migration, /create table public\.map_events/);
  assert.match(migration, /create table public\.map_tasks/);
  assert.match(migration, /foreign key \(organization_id, feature_id\)[\s\S]*references public\.map_features/);
  assert.match(migration, /future_customer_account_id uuid/);
  assert.match(migration, /future_customer_request_id uuid/);
  assert.match(migration, /before update or delete on public\.map_events/);
  assert.match(migration, /Submitted map history is permanent/);
  assert.match(migration, /Add a correction or void record instead/);
  assert.match(migration, /create or replace function public\.maps_complete_task/);
  assert.match(migration, /insert into public\.map_events/);
  assert.match(migration, /completion_event_id = created_event\.id/);
  assert.match(migration, /alter table public\.map_events enable row level security/);
  assert.match(migration, /alter table public\.map_tasks enable row level security/);
  assert.match(migration, /grant select, insert on public\.map_events to authenticated/);
  assert.doesNotMatch(migration, /grant[^;]*update[^;]*on public\.map_events/);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*on public\.map_events/);
});

test("Water-main breaks remain one highlighted incident until closure creates permanent history", async () => {
  const [workspace, types, styles, migration, classificationMigration, roadmap] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/maps-types.ts"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260904011540_maps_break_incident_workflow.sql"),
    read("supabase/migrations/20260904135103_maps_layer_system_classification.sql"),
    read("docs/maps-product-roadmap.md"),
  ]);

  assert.match(types, /export interface MapIncident/);
  assert.match(types, /export interface MapIncidentUpdate/);
  assert.match(types, /export type MapSystemType/);
  assert.match(workspace, /Active incidents/);
  assert.match(workspace, /Start water-main break/);
  assert.match(workspace, /Start break/);
  assert.doesNotMatch(workspace, /maps-detail-break/);
  assert.match(workspace, /Past breaks/);
  assert.match(workspace, /View break location on map/);
  assert.match(workspace, /openHistoricalIncident/);
  assert.match(workspace, /historicalIncidentByEventId/);
  assert.match(workspace, /RESOLVED BREAK/);
  assert.match(workspace, /Active water-main break/);
  assert.match(workspace, /formatIncidentAge/);
  assert.match(workspace, /WATER_BREAK_ICON_MARKUP/);
  assert.match(workspace, /selectedFeatureSupportsWaterBreak/);
  assert.match(workspace, /Infrastructure system/);
  assert.match(workspace, /Click the exact break location on the selected line/);
  assert.match(workspace, /maps_start_break_incident/);
  assert.match(workspace, /maps_add_incident_update/);
  assert.match(workspace, /maps_close_break_incident/);
  assert.match(workspace, /Incident timeline/);
  assert.match(workspace, /Resolve and lock/);
  assert.match(workspace, /activeIncident: activeIncidentFeatureIds\.has/);
  assert.match(styles, /\.maps-active-incidents/);
  assert.match(styles, /\.maps-incident-marker/);
  assert.match(styles, /\.maps-water-break-icon/);
  assert.match(styles, /\.maps-past-breaks-toggle/);
  assert.match(styles, /\.maps-incident-marker\.is-resolved/);
  assert.match(styles, /\.maps-history-record/);
  assert.match(styles, /\.maps-incident-card/);

  assert.match(migration, /create table public\.map_incidents/);
  assert.match(migration, /create table public\.map_incident_updates/);
  assert.match(migration, /reported_geometry extensions\.geometry\(Point, 4326\)/);
  assert.match(migration, /geometry extensions\.geometry\(Point, 4326\)/);
  assert.match(migration, /extensions\.st_closestpoint/);
  assert.match(migration, /future_isolation_valve_ids uuid\[\]/);
  assert.match(migration, /future_affected_customer_account_ids uuid\[\]/);
  assert.match(migration, /future_notification_batch_id uuid/);
  assert.match(migration, /Incident updates are permanent and cannot be edited or deleted/);
  assert.match(migration, /insert into public\.map_events/);
  assert.match(migration, /alter table public\.map_incidents enable row level security/);
  assert.match(migration, /alter table public\.map_incident_updates enable row level security/);
  assert.doesNotMatch(migration, /grant[^;]*delete[^;]*on public\.map_incidents/);
  assert.doesNotMatch(migration, /grant[^;]*update[^;]*on public\.map_incident_updates/);

  assert.match(classificationMigration, /add column standard_key text/);
  assert.match(classificationMigration, /add column system_type text not null default 'other'/);
  assert.match(classificationMigration, /'potable_water', 'sanitary_sewer', 'stormwater', 'reclaimed_water', 'reference', 'other'/);
  assert.match(classificationMigration, /private\.validate_map_water_break_layer/);
  assert.match(classificationMigration, /Water-main breaks must be linked to an active potable-water line/);

  assert.match(roadmap, /Connected utility-network topology \(in progress\)/);
  assert.match(roadmap, /adding a valve on a pipe splits the pipe into two segments/i);
  assert.match(roadmap, /affected meters and customer accounts automatically/i);
  assert.match(roadmap, /email, permission-based text messages, and automated voice calls/i);
  assert.match(roadmap, /Customer-portal request and field-report intake/);
  assert.match(roadmap, /unverified report/);
  assert.match(roadmap, /inspection task, customer-service request, active incident, maintenance task/);
  assert.match(roadmap, /public form never sends a system-wide notice by itself/);
  assert.match(roadmap, /Not built yet/);
});

test("Water lines store flow direction and can atomically insert connected valves", async () => {
  const [workspace, types, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/maps-types.ts"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260904161005_maps_flow_direction_and_valve_insertion.sql"),
  ]);

  assert.match(types, /flow_direction: "unknown" \| "start_to_end" \| "end_to_start"/);
  assert.match(workspace, /Insert isolation valve/);
  assert.match(workspace, /maps_insert_valve_on_line/);
  assert.match(workspace, /set_map_line_flow_direction/);
  assert.match(workspace, /First point → last point/);
  assert.match(workspace, /SAVED_SHAPES_FLOW_ID/);
  assert.match(workspace, /The original main keeps its records/);
  assert.match(styles, /\.maps-detail-valve/);
  assert.match(styles, /\.maps-flow-control/);

  assert.match(migration, /add column if not exists flow_direction/);
  assert.match(migration, /create table public\.map_network_devices/);
  assert.match(migration, /create or replace function public\.set_map_line_flow_direction/);
  assert.match(migration, /create or replace function private\.maps_insert_valve_on_line/);
  assert.match(migration, /extensions\.st_linesubstring\(line_row\.geometry, 0, split_fraction\)/);
  assert.match(migration, /extensions\.st_linesubstring\(line_row\.geometry, split_fraction, 1\)/);
  assert.match(migration, /insert into public\.map_network_devices/);
  assert.match(migration, /layer\.system_type = 'potable_water'/);
  assert.match(migration, /layer\.icon_key = 'valve' or layer\.standard_key = 'water-valve'/);
  assert.doesNotMatch(migration, /grant (insert|update|delete)[^;]*map_network_devices[^;]*authenticated/);
});

test("Point utility assets can be securely connected to compatible lines", async () => {
  const [workspace, types, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/lib/maps-types.ts"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260904163325_maps_point_asset_line_connections.sql"),
  ]);

  assert.match(types, /export interface MapPointLineConnection/);
  assert.match(workspace, /nearestCompatiblePointConnection/);
  assert.match(workspace, /Connect to \{pendingPointConnectionCandidate\.featureTitle\}/);
  assert.match(workspace, /maps_connect_point_to_line/);
  assert.match(workspace, /maps_disconnect_point_from_line/);
  assert.match(workspace, /This saves the utility relationship, not just the visual position/);
  assert.match(workspace, /pointLineConnections\.find/);
  assert.match(styles, /\.maps-connect-suggestion/);
  assert.match(styles, /grid-template-rows: minmax\(0,\s*1fr\)/);

  assert.match(migration, /create table public\.map_point_line_connections/);
  assert.match(migration, /constraint map_point_line_connections_point_unique unique/);
  assert.match(migration, /point_layer\.system_type <> line_layer\.system_type/);
  assert.match(migration, /extensions\.st_closestpoint/);
  assert.match(migration, /'service_endpoint'/);
  assert.match(migration, /'hydrant_lateral'/);
  assert.match(migration, /alter table public\.map_point_line_connections enable row level security/);
  assert.match(migration, /grant select on public\.map_point_line_connections to authenticated/);
  assert.doesNotMatch(migration, /grant (insert|update|delete|all) on public\.map_point_line_connections to authenticated/i);
});
