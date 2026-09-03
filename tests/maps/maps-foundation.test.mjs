import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Maps starts as an empty reusable N3XRA product", async () => {
  const [workspace, migration] = await Promise.all([
    read("maps-app/src/components/MapsWorkspace.tsx"),
    read("supabase/migrations/20260903042333_maps_foundation.sql"),
  ]);

  assert.match(workspace, /No layers yet/);
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
  assert.match(workspace, /enableHighAccuracy: true/);
  assert.match(workspace, /Satellite/);
  assert.match(workspace, /create_map_point/);
  assert.match(migration, /create extension if not exists postgis/);
  assert.match(migration, /geometry extensions\.geometry\(Geometry, 4326\)/);
  assert.match(migration, /future_customer_account_id uuid/);
  assert.match(migration, /future_work_order_id uuid/);
  assert.match(migration, /alter table public\.map_layers enable row level security/);
  assert.match(migration, /alter table public\.map_features enable row level security/);
  assert.doesNotMatch(migration, /grant delete/i);
});

test("Maps is discoverable from the dashboard, homepage, and shared footer", async () => {
  const [home, account, accountSource, navigation, footerStyles] = await Promise.all([
    read("index.html"),
    read("account/index.html"),
    read("account/account.js"),
    read("assets/site-nav.js"),
    read("assets/product-footer.css"),
  ]);

  assert.match(home, /<strong>N3XRA Maps<\/strong>/);
  assert.match(account, /id="maps-product-card"/);
  assert.match(account, /Paid plans are coming soon/);
  assert.match(accountSource, /rpc\("maps_access_list"\)/);
  assert.match(accountSource, /Request Maps Access/);
  assert.match(navigation, /footer-product-grid/);
  assert.match(navigation, /N3XRA Maps/);
  assert.match(navigation, /N3XRA Project Cards/);
  assert.match(footerStyles, /grid-template-columns: repeat\(5/);
  assert.match(footerStyles, /@media \(max-width: 700px\)/);
});

test("Maps has a public product presentation and a separate signed-in workspace", async () => {
  const [landing, app, accountSource, routeMigration] = await Promise.all([
    read("maps-app/src/pages/index.astro"),
    read("maps-app/src/pages/app/index.astro"),
    read("account/account.js"),
    read("supabase/migrations/20260903050033_maps_public_landing_route.sql"),
  ]);

  assert.match(landing, /Every asset\.<br \/><em>Right where it belongs\.<\/em>/);
  assert.match(landing, /HOW IT WORKS/);
  assert.match(landing, /Points for meters, valves, hydrants/);
  assert.match(landing, /href="\/maps\/app\/"/);
  assert.match(app, /<MapsWorkspace client:load/);
  assert.match(accountSource, /hasMapsAccess \? "\/maps\/app\/"/);
  assert.match(routeMigration, /portal_path = '\/maps\/app\/'/);
  assert.doesNotMatch(landing, /Bly Water|sample organization|demo organization/i);
});
