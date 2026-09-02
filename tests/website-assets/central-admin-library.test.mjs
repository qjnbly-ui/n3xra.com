import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const filesSource = await readFile(new URL("../../account/admin/files/files.js", import.meta.url), "utf8");
const workspaceFilesSource = await readFile(new URL("../../n3xra-admin/websites/websites-admin.js", import.meta.url), "utf8");
const workspaceFilesPage = await readFile(new URL("../../n3xra-admin/assets/index.html", import.meta.url), "utf8");
const clientFilesSource = await readFile(new URL("../../client-portal/portal.js", import.meta.url), "utf8");
const clientShellSource = await readFile(new URL("../../client-portal/client-shell.js", import.meta.url), "utf8");
const clientFilesPage = await readFile(new URL("../../client-portal/index.html", import.meta.url), "utf8");
const internalFilesPage = await readFile(new URL("../../account/admin/files/index.html", import.meta.url), "utf8");
const previewSource = await readFile(new URL("../../client-portal/asset-preview-modal.js", import.meta.url), "utf8");
const internalFilesStyles = await readFile(new URL("../../account/admin/files/files.css", import.meta.url), "utf8");
const workspaceFilesStyles = await readFile(new URL("../../client-portal/assets-manager.css", import.meta.url), "utf8");
const navigationSource = await readFile(new URL("../../account/admin/admin-navigation.js", import.meta.url), "utf8");

test("Internal Files remains the central admin library", () => {
  assert.match(navigationSource, /\["\/account\/admin\/files\/", "Internal Files"\]/);
});

test("Internal Files can create and retain empty folders", () => {
  assert.match(internalFilesPage, /id="n3xra-new-folder-button"/);
  assert.match(filesSource, /fileInvoke\("create-n3xra-folder", \{ folderPath \}\)/);
  assert.match(filesSource, /fileState\.folders\.forEach/);
});

test("website libraries retain website and category folders", () => {
  assert.match(filesSource, /`Websites\/\$\{websiteFolderSegment\(website\.name\)\}`/);
  assert.match(filesSource, /websiteCategoryFolder\(asset\.category\)/);
  assert.match(filesSource, /currentFolderPath\.startsWith\(`\$\{website\.folder_path\}\/`\)/);
});

test("website library changes refresh the central view live", () => {
  assert.match(filesSource, /table: "website_assets"/);
  assert.match(filesSource, /table: "website_asset_versions"/);
  assert.match(filesSource, /subscribeToWebsiteLibraries\(\)/);
});

test("central website libraries expose the full admin asset workflow", () => {
  assert.match(filesSource, /data-website-file-approve/);
  assert.match(filesSource, /data-website-file-reject/);
  assert.match(filesSource, /data-website-file-publish/);
  assert.match(filesSource, /data-website-file-publish-original/);
  assert.match(filesSource, /data-website-file-rename/);
  assert.match(filesSource, /data-website-file-optimize/);
  assert.match(filesSource, /data-website-file-original/);
  assert.match(filesSource, /approveSelectedWebsiteFiles/);
  assert.match(filesSource, /rejectSelectedWebsiteFiles/);
  assert.match(filesSource, /refreshSelectedWebsiteCdnFiles/);
});

test("central admin uploads are approved immediately", () => {
  assert.match(filesSource, /status: "approved"/);
  assert.match(filesSource, /approved_by_user_id: fileUserId/);
});

test("central website libraries show live usage states", () => {
  assert.match(filesSource, /website-asset-usage/);
  assert.match(filesSource, /In use/);
  assert.match(filesSource, /Available/);
  assert.match(filesSource, /New/);
});

test("organization workspace files show and filter live usage states", () => {
  assert.match(workspaceFilesPage, /id="admin-asset-status-filter"/);
  assert.match(workspaceFilesSource, /website-asset-usage/);
  assert.match(workspaceFilesSource, /Authorization: `Bearer \$\{currentSession\?\.access_token/);
  assert.match(workspaceFilesSource, /In use · \$\{locations\.length\}/);
  assert.match(workspaceFilesSource, /Used on:/);
  assert.match(workspaceFilesSource, /label: "Available"/);
  assert.match(workspaceFilesSource, /label: "New"/);
  assert.match(workspaceFilesSource, /label: "Ready to publish"/);
});

test("all file areas offer persistent list and gallery views", () => {
  assert.match(internalFilesPage, /data-file-view="list"/);
  assert.match(internalFilesPage, /data-file-view="gallery"/);
  assert.match(filesSource, /n3xra-internal-files-view/);
  assert.match(workspaceFilesPage, /data-asset-view="list"/);
  assert.match(workspaceFilesPage, /data-asset-view="gallery"/);
  assert.match(workspaceFilesSource, /n3xra-website-assets-view/);
  assert.match(clientFilesPage, /data-client-asset-view="list"/);
  assert.match(clientFilesPage, /data-client-asset-view="gallery"/);
  assert.match(clientFilesSource, /n3xra-client-files-view/);
  assert.match(clientFilesSource, /renderAssets\(\);\s*showPortalView\("files"\);/);
  assert.match(clientFilesSource, /querySelectorAll\("button\[data-portal-view\]"\)/);
  assert.match(clientShellSource, /closest\("button\[data-portal-view\]"\)/);
  assert.doesNotMatch(clientFilesSource, /querySelectorAll\("\[data-portal-view\]"\)/);
});

test("full-quality previews navigate previous and next on desktop and mobile", () => {
  assert.match(internalFilesPage, /id="file-preview-previous"/);
  assert.match(internalFilesPage, /id="file-preview-next"/);
  assert.match(filesSource, /preferOriginal: true/);
  assert.match(filesSource, /event\.key === "ArrowLeft"/);
  assert.match(previewSource, /data-asset-preview-previous/);
  assert.match(previewSource, /data-asset-preview-next/);
  assert.match(previewSource, /event\.key === "ArrowRight"/);
  assert.match(workspaceFilesSource, /Full quality/);
  assert.match(workspaceFilesSource, /onNext: nextVersion/);
  assert.match(clientFilesSource, /onPrevious: previousVersion/);
  assert.match(clientFilesSource, /onNext: nextVersion/);
  assert.match(clientFilesSource, /clientPreviewVersionIds/);
});

test("gallery cards keep natural filename order without overlapping", () => {
  assert.match(filesSource, /Intl\.Collator\(undefined, \{ numeric: true/);
  assert.match(filesSource, /naturalFilenameCollator\.compare\(left\.name, right\.name\)/);
  assert.match(workspaceFilesSource, /Intl\.Collator\(undefined, \{ numeric: true/);
  assert.match(workspaceFilesSource, /naturalFilenameCollator\.compare\(assetSortName\(left\), assetSortName\(right\)\)/);
  assert.match(clientFilesSource, /naturalFilenameCollator\.compare\(assetSortName\(left\), assetSortName\(right\)\)/);
  assert.match(internalFilesStyles, /\.n3xra-file-list\.is-gallery \.n3xra-file-row \{[^}]*min-height:280px;[^}]*height:max-content;/);
  assert.match(workspaceFilesStyles, /\.website-assets-table\.is-gallery \.website-asset-version \{[^}]*min-height:280px;[^}]*height:max-content;/);
});

test("mobile galleries load quickly and keep navigation reachable", () => {
  assert.match(filesSource, /new IntersectionObserver/);
  assert.match(filesSource, /rootMargin: "500px 0px"/);
  assert.match(filesSource, /fullQualityFilePreviewCache/);
  assert.match(workspaceFilesSource, /new IntersectionObserver/);
  assert.match(workspaceFilesSource, /fullQualityPreviewCache/);
  assert.match(clientFilesSource, /new IntersectionObserver/);
  assert.match(clientFilesSource, /\{ root: null, rootMargin: "500px 0px" \}/);
  assert.match(clientFilesSource, /rootMargin: "500px 0px"/);
  assert.match(clientFilesSource, /clientFullQualityPreviewCache/);
  assert.doesNotMatch(clientFilesSource, /loading="lazy"[^>]*hidden/);
  assert.doesNotMatch(workspaceFilesSource, /loading="lazy"[^>]*hidden/);
  assert.doesNotMatch(filesSource, /loading="lazy"[^>]*hidden/);
  assert.match(clientFilesSource, /websiteAssetThumbnailUrl\(url\)/);
  assert.match(workspaceFilesSource, /websiteAssetThumbnailUrl\(url\)/);
  assert.match(filesSource, /websiteAssetThumbnailUrl\(data\.url\)/);
  assert.match(internalFilesStyles, /\.n3xra-file-list\.is-gallery \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.match(workspaceFilesStyles, /\.website-assets-table\.is-gallery \{ grid-template-columns:minmax\(0,1fr\)/);
  assert.match(internalFilesStyles, /\.n3xra-preview-navigation button \{ flex:1; min-height:48px;/);
  assert.match(workspaceFilesStyles, /\.website-asset-preview-navigation button \{ flex:1; min-height:48px;/);
  assert.match(workspaceFilesStyles, /grid-template-rows:auto minmax\(0,1fr\) auto/);
  assert.match(workspaceFilesStyles, /height:calc\(100dvh - 1rem\)/);
});

test("mobile file controls stay compact across admin and client libraries", () => {
  assert.match(workspaceFilesStyles, /\.website-assets-folder-list \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(workspaceFilesStyles, /\.website-assets-head-actions, #admin-selected-asset-actions \{ width:100%; display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(workspaceFilesStyles, /\.website-assets-head-actions \.website-assets-view-toggle, #admin-selected-asset-actions \.website-assets-view-toggle \{ grid-column:1 \/ -1;/);
  assert.match(internalFilesStyles, /\.n3xra-file-filters \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(internalFilesStyles, /\.n3xra-files-actions \{ display:grid; grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});
