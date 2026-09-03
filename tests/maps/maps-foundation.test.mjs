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
  assert.doesNotMatch(workspace, /Bly Water|sample|demo organization/i);
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

  assert.match(landing, /Every asset\.<br \/><em>Right where it belongs\.<\/em>/);
  assert.match(landing, /How it works/);
  assert.match(landing, /Points for meters, valves, hydrants/);
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
  assert.match(landing, /class="site-topbar home-topbar cards-topbar"/);
  assert.match(landing, /<nav class="desktop-nav" aria-label="Primary"><a href="\/projects\/">Projects<\/a><a href="\/services\/">Services<\/a><a href="\/support\/">Support<\/a><a href="\/#software">Software<\/a><\/nav>/);
  assert.match(landing, /class="site-footer home-footer"/);
  assert.match(landing, /id="maps-icon-meter"/);
  assert.match(landing, /id="maps-icon-valve"/);
  assert.match(landing, /id="maps-icon-boundary"/);
  assert.match(landing, /id="maps-icon-locate"/);
  assert.doesNotMatch(landing, /class="step-icon">[▧＋⌖]/);
  assert.match(productStyles, /\.maps-preview-body aside \{ display: none; \}/);
  assert.match(productStyles, /\.maps-icon \{/);
  assert.doesNotMatch(productStyles, /:root|--ml-|transform: scale/);
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
  assert.match(landing, /href="\/account\/\?product=maps#available-apps-section">Request early access/);

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
  assert.match(workspace, /Delete item/);
  assert.match(workspace, /\.update\(\{ archived_at: new Date\(\)\.toISOString\(\) \}\)/);
  assert.match(workspace, /Its saved record is archived so it can be recovered later/);
  assert.match(styles, /\.maps-marker::before[^}]*transform: rotate\(-45deg\)/);
  assert.doesNotMatch(styles, /\.maps-marker \{[^}]*rotate:/);
  assert.doesNotMatch(styles, /\.maps-marker\.is-selected \{[^}]*scale:/);
});

test("Maps layers can be edited, archived, restored, and permanently deleted by account admins", async () => {
  const [workspace, styles, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("maps-app/src/styles/maps.css"),
    read("supabase/migrations/20260903192631_maps_layer_archive_management.sql"),
  ]);

  assert.match(workspace, /Edit layer/);
  assert.match(workspace, /Archive layer/);
  assert.match(workspace, /maps_archive_layer/);
  assert.match(workspace, /maps_restore_layer/);
  assert.match(workspace, /Delete forever/);
  assert.match(workspace, /canPermanentlyDelete = activeAccess\?\.role === "account_admin"/);
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
  assert.match(workspace, /Draw line/);
  assert.match(workspace, /Draw boundary/);
  assert.match(workspace, /Undo point/);
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
