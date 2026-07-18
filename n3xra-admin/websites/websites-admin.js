import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";

const PRIVATE_BUCKET = "website-assets-private";
const PUBLIC_BUCKET = "website-assets-public";
const statusScreen = document.getElementById("portal-status");
const websiteSelect = document.getElementById("admin-website-select");
const summary = document.getElementById("admin-site-summary");
const siteName = document.getElementById("admin-site-name");
const siteStatus = document.getElementById("admin-site-status");
const siteMeta = document.getElementById("admin-site-meta");
const liveLink = document.getElementById("admin-live-link");
const clientView = document.getElementById("admin-client-view");
const assetToolbar = document.getElementById("admin-asset-toolbar");
const assetGrid = document.getElementById("admin-asset-grid");
const emptyState = document.getElementById("admin-empty");
const refreshButton = document.getElementById("refresh-admin");
const siteForm = document.getElementById("site-form");
const siteFormStatus = document.getElementById("site-form-status");
const openSiteFormButton = document.getElementById("open-site-form");
const closeSiteFormButton = document.getElementById("close-site-form");
const siteNameInput = document.getElementById("site-name");
const siteSlugInput = document.getElementById("site-slug");
const siteLiveUrlInput = document.getElementById("site-live-url");
const siteRepositoryInput = document.getElementById("site-repository");
const accessPanel = document.getElementById("access-panel");
const memberForm = document.getElementById("member-form");
const memberEmail = document.getElementById("member-email");
const memberRole = document.getElementById("member-role");
const memberFormStatus = document.getElementById("member-form-status");
const memberList = document.getElementById("member-list");
const memberEmpty = document.getElementById("member-empty");

let supabase;
let currentUser;
let websites = [];
let selectedWebsite;
let assets = [];
let versions = [];
let members = [];

function showStatus(message) {
  statusScreen.textContent = message;
  statusScreen.hidden = false;
}

function openLogin() {
  window.location.replace("/account?next=%2Fn3xra-admin%2Fwebsites%2F");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value = "") {
  return String(value).toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function safeFilename(value = "asset") {
  const parts = String(value).split(".");
  const extension = parts.length > 1 ? `.${parts.pop().toLowerCase().replace(/[^a-z0-9]/g, "")}` : "";
  return `${slugify(parts.join(".")) || "asset"}${extension}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function setSiteFormStatus(message = "", isError = false) {
  siteFormStatus.textContent = message;
  siteFormStatus.classList.toggle("is-error", isError);
}

function setMemberStatus(message = "", isError = false) {
  memberFormStatus.textContent = message;
  memberFormStatus.classList.toggle("is-error", isError);
}

function renderWebsiteOptions() {
  websiteSelect.innerHTML = websites.length
    ? websites.map((site) => `<option value="${site.id}">${escapeHtml(site.name)}</option>`).join("")
    : '<option value="">No websites</option>';
}

function renderSelectedWebsite() {
  if (!selectedWebsite) {
    summary.hidden = true;
    assetToolbar.hidden = true;
    assetGrid.innerHTML = "";
    emptyState.hidden = false;
    accessPanel.hidden = true;
    return;
  }

  summary.hidden = false;
  assetToolbar.hidden = false;
  siteName.textContent = selectedWebsite.name;
  siteStatus.textContent = `${selectedWebsite.status || "active"} website`;
  siteMeta.textContent = [selectedWebsite.live_url, selectedWebsite.repository_full_name].filter(Boolean).join(" · ") || "No live URL or repository recorded.";
  liveLink.hidden = !selectedWebsite.live_url;
  if (selectedWebsite.live_url) liveLink.href = selectedWebsite.live_url;
  clientView.href = `/client-portal/?website=${encodeURIComponent(selectedWebsite.id)}`;
  accessPanel.hidden = false;
}

function renderMembers() {
  memberEmpty.hidden = Boolean(members.length);
  memberList.innerHTML = members.map((member) => `
    <div class="portal-member-row">
      <div>
        <strong>${escapeHtml(member.name || member.email || "N3XRA client")}</strong>
        <p>${escapeHtml(member.email || member.user_id)} · ${escapeHtml(member.status)}</p>
      </div>
      <div class="portal-member-controls">
        <select class="portal-member-role" data-member-role="${member.id}" aria-label="Role for ${escapeHtml(member.email || "client")}">
          ${["owner", "editor", "viewer"].map((role) => `<option value="${role}"${member.role === role ? " selected" : ""}>${role[0].toUpperCase() + role.slice(1)}</option>`).join("")}
        </select>
        ${member.status === "active"
          ? `<button class="portal-button portal-button-secondary" type="button" data-member-status="revoked" data-member-id="${member.id}">Revoke</button>`
          : `<button class="portal-button portal-button-secondary" type="button" data-member-status="active" data-member-id="${member.id}">Restore</button>`}
      </div>
    </div>
  `).join("");
}

async function invokeAdmin(body) {
  const { data, error } = await supabase.functions.invoke("platform-admin", { body });
  if (error || data?.error) throw new Error(data?.error || error?.message || "Website administration request failed.");
  return data;
}

async function loadMembers() {
  if (!selectedWebsite) {
    members = [];
    renderMembers();
    return;
  }
  const data = await invokeAdmin({ action: "list-website-members", websiteId: selectedWebsite.id });
  members = data.members || [];
  renderMembers();
}

function versionActions(version) {
  const actions = [];
  if (version.status === "pending_review") {
    actions.push(`<button class="portal-button portal-button-secondary" data-version-action="approve" data-version-id="${version.id}">Approve</button>`);
    actions.push(`<button class="portal-button portal-button-secondary" data-version-action="reject" data-version-id="${version.id}">Reject</button>`);
  }
  if (version.status === "approved" && String(version.mime_type || "").startsWith("image/")) {
    actions.push(`<button class="portal-button" data-version-action="publish" data-version-id="${version.id}">Publish to CDN</button>`);
  }
  actions.push(`<button class="portal-button portal-button-secondary" data-version-action="download" data-version-id="${version.id}">Download</button>`);
  if (version.public_url) {
    actions.push(`<button class="portal-button portal-button-secondary" data-version-action="copy" data-version-id="${version.id}">Copy URL</button>`);
  }
  return actions.join("");
}

function renderAssets() {
  if (!selectedWebsite || !assets.length) {
    assetGrid.innerHTML = "";
    emptyState.hidden = false;
    emptyState.querySelector("p").textContent = selectedWebsite
      ? "No assets have been added for this website."
      : "No managed websites are available yet.";
    return;
  }

  emptyState.hidden = true;
  assetGrid.innerHTML = assets.map((asset) => {
    const assetVersions = versions.filter((version) => version.asset_id === asset.id);
    return `
      <article class="portal-asset-card">
        <div class="portal-asset-head">
          <div>
            <p class="portal-kicker">${escapeHtml(asset.category || "asset")}</p>
            <h3>${escapeHtml(asset.label)}</h3>
            <p><code>${escapeHtml(asset.asset_key)}</code> · ${escapeHtml(asset.replacement_type || "download_only")}</p>
          </div>
          <span class="portal-badge">${assetVersions.length} version${assetVersions.length === 1 ? "" : "s"}</span>
        </div>
        <div class="portal-version-list">
          ${assetVersions.length ? assetVersions.map((version) => `
            <div class="portal-version">
              <div>
                <strong>Version ${version.version_number}</strong>
                <span class="portal-badge portal-status-${escapeHtml(version.status)}">${escapeHtml(version.status.replaceAll("_", " "))}</span>
                <p>${escapeHtml(version.original_filename)}${version.size_bytes ? ` · ${formatBytes(version.size_bytes)}` : ""}</p>
                <p>${formatDate(version.created_at)}${version.change_note ? ` · ${escapeHtml(version.change_note)}` : ""}</p>
                ${version.public_url ? `<p class="portal-url">${escapeHtml(version.public_url)}</p>` : ""}
              </div>
              <div class="portal-card-actions">${versionActions(version)}</div>
            </div>
          `).join("") : "<p>No versions uploaded.</p>"}
        </div>
      </article>
    `;
  }).join("");
}

async function loadAssets() {
  if (!selectedWebsite) {
    assets = [];
    versions = [];
    renderSelectedWebsite();
    renderAssets();
    return;
  }

  const assetResult = await supabase.from("website_assets").select("*").eq("website_id", selectedWebsite.id).order("created_at");
  if (assetResult.error) throw assetResult.error;
  const assetIds = (assetResult.data || []).map((asset) => asset.id);
  const versionResult = assetIds.length
    ? await supabase.from("website_asset_versions").select("*").in("asset_id", assetIds).order("version_number", { ascending: false })
    : { data: [], error: null };
  if (versionResult.error) throw versionResult.error;
  assets = assetResult.data || [];
  versions = versionResult.data || [];
  renderSelectedWebsite();
  renderAssets();
}

async function selectWebsite(id) {
  selectedWebsite = websites.find((site) => site.id === id) || websites[0];
  if (selectedWebsite) websiteSelect.value = selectedWebsite.id;
  await Promise.all([loadAssets(), loadMembers()]);
}

async function assignMember(event) {
  event.preventDefault();
  if (!selectedWebsite) return;
  const submitButton = memberForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setMemberStatus("Assigning account…");
  try {
    await invokeAdmin({
      action: "assign-website-member",
      websiteId: selectedWebsite.id,
      email: memberEmail.value.trim(),
      role: memberRole.value,
    });
    memberForm.reset();
    setMemberStatus("Account assigned.");
    await loadMembers();
  } catch (error) {
    setMemberStatus(error?.message || "Unable to assign this account.", true);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleMemberAction(event) {
  const button = event.target.closest("[data-member-id]");
  if (!button) return;
  const membership = members.find((member) => member.id === button.dataset.memberId);
  const roleSelect = memberList.querySelector(`[data-member-role="${button.dataset.memberId}"]`);
  if (!membership || !roleSelect) return;
  button.disabled = true;
  setMemberStatus("Updating access…");
  try {
    await invokeAdmin({
      action: "update-website-member",
      membershipId: membership.id,
      role: roleSelect.value,
      status: button.dataset.memberStatus,
    });
    setMemberStatus(button.dataset.memberStatus === "active" ? "Access restored." : "Access revoked.");
    await loadMembers();
  } catch (error) {
    setMemberStatus(error?.message || "Unable to update access.", true);
  } finally {
    button.disabled = false;
  }
}

async function handleMemberRoleChange(event) {
  const select = event.target.closest("[data-member-role]");
  if (!select) return;
  const membership = members.find((member) => member.id === select.dataset.memberRole);
  if (!membership || membership.role === select.value) return;
  select.disabled = true;
  setMemberStatus("Updating role…");
  try {
    await invokeAdmin({
      action: "update-website-member",
      membershipId: membership.id,
      role: select.value,
      status: membership.status,
    });
    setMemberStatus("Role updated.");
    await loadMembers();
  } catch (error) {
    select.value = membership.role;
    setMemberStatus(error?.message || "Unable to update the role.", true);
  } finally {
    select.disabled = false;
  }
}

async function loadWebsites(preferredId) {
  const { data, error } = await supabase.from("client_websites").select("*").order("name");
  if (error) throw error;
  websites = data || [];
  renderWebsiteOptions();
  const requested = preferredId || new URLSearchParams(window.location.search).get("website");
  await selectWebsite(websites.some((site) => site.id === requested) ? requested : websites[0]?.id);
}

async function updateVersionStatus(versionId, status) {
  const now = new Date().toISOString();
  const values = status === "approved"
    ? { status, approved_by_user_id: currentUser.id, approved_at: now, rejection_reason: null }
    : { status, rejected_by_user_id: currentUser.id, rejected_at: now, rejection_reason: window.prompt("Optional rejection note:") || null };
  const { error } = await supabase.from("website_asset_versions").update(values).eq("id", versionId);
  if (error) throw error;
  await loadAssets();
}

async function publishVersion(versionId) {
  const version = versions.find((row) => row.id === versionId);
  const asset = assets.find((row) => row.id === version?.asset_id);
  if (!version || !asset) throw new Error("This asset version is no longer available.");

  const publicPath = `${selectedWebsite.id}/${asset.id}/v${version.version_number}-${safeFilename(version.original_filename)}`;
  const { error: copyError } = await supabase.storage
    .from(PRIVATE_BUCKET)
    .copy(version.storage_path, publicPath, { destinationBucket: PUBLIC_BUCKET });
  if (copyError && !/already exists|duplicate/i.test(copyError.message || "")) throw copyError;

  const { data: urlData } = supabase.storage.from(PUBLIC_BUCKET).getPublicUrl(publicPath);
  const publicUrl = urlData.publicUrl;
  const now = new Date().toISOString();
  const { error: versionError } = await supabase.from("website_asset_versions").update({
    status: "published",
    public_url: publicUrl,
    published_by_user_id: currentUser.id,
    published_at: now,
  }).eq("id", version.id);
  if (versionError) throw versionError;

  const { error: assetError } = await supabase.from("website_assets").update({
    current_version_id: version.id,
    updated_at: now,
  }).eq("id", asset.id);
  if (assetError) throw assetError;
  await loadAssets();
  await navigator.clipboard?.writeText(publicUrl);
  window.alert("Published. The versioned CDN URL was copied when browser permissions allowed it.");
}

async function downloadVersion(version) {
  if (version.public_url) {
    window.open(version.public_url, "_blank", "noopener");
    return;
  }
  const { data, error } = await supabase.storage
    .from(version.storage_bucket)
    .createSignedUrl(version.storage_path, 600, { download: version.original_filename });
  if (error) throw error;
  window.open(data.signedUrl, "_blank", "noopener");
}

async function handleAssetAction(event) {
  const button = event.target.closest("[data-version-action]");
  if (!button) return;
  const version = versions.find((row) => row.id === button.dataset.versionId);
  if (!version) return;
  button.disabled = true;
  try {
    if (button.dataset.versionAction === "approve") await updateVersionStatus(version.id, "approved");
    if (button.dataset.versionAction === "reject") await updateVersionStatus(version.id, "rejected");
    if (button.dataset.versionAction === "publish") await publishVersion(version.id);
    if (button.dataset.versionAction === "download") await downloadVersion(version);
    if (button.dataset.versionAction === "copy") {
      await navigator.clipboard.writeText(version.public_url);
      button.textContent = "Copied";
    }
  } catch (error) {
    window.alert(error?.message || "This action could not be completed.");
  } finally {
    button.disabled = false;
  }
}

async function createWebsite(event) {
  event.preventDefault();
  const submitButton = siteForm.querySelector('[type="submit"]');
  submitButton.disabled = true;
  setSiteFormStatus("Creating website…");
  const slug = slugify(siteSlugInput.value);
  try {
    if (!slug) throw new Error("Enter a valid website slug.");
    const { data, error } = await supabase.from("client_websites").insert({
      name: siteNameInput.value.trim(),
      slug,
      live_url: siteLiveUrlInput.value.trim() || null,
      repository_full_name: siteRepositoryInput.value.trim() || null,
      status: "active",
    }).select().single();
    if (error) throw error;
    siteForm.reset();
    setSiteFormStatus("Website created.");
    await loadWebsites(data.id);
  } catch (error) {
    setSiteFormStatus(error?.message || "Unable to create this website.", true);
  } finally {
    submitButton.disabled = false;
  }
}

async function initWebsiteAdmin() {
  if (!hasConfig()) {
    document.body.classList.add("portal-denied");
    showStatus("Website administration is not connected yet.");
    return;
  }

  supabase = createBrowserSupabase();
  try {
    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      openLogin();
      return;
    }
    currentUser = userData.user;

    const { data, error } = await supabase.functions.invoke("platform-admin", {
      body: { action: "get-platform-admin-access" },
    });
    if (error || data?.error || !data?.admin) {
      document.body.classList.add("portal-denied");
      showStatus("You do not have access to website administration.");
      return;
    }

    await loadWebsites();
    document.body.classList.remove("portal-loading");
    statusScreen.hidden = true;

    websiteSelect.addEventListener("change", () => selectWebsite(websiteSelect.value).catch((loadError) => window.alert(loadError.message)));
    refreshButton.addEventListener("click", () => loadWebsites(selectedWebsite?.id).catch((loadError) => window.alert(loadError.message)));
    assetGrid.addEventListener("click", handleAssetAction);
    memberForm.addEventListener("submit", assignMember);
    memberList.addEventListener("click", handleMemberAction);
    memberList.addEventListener("change", handleMemberRoleChange);
    openSiteFormButton.addEventListener("click", () => {
      siteForm.hidden = false;
      siteNameInput.focus();
    });
    closeSiteFormButton.addEventListener("click", () => {
      siteForm.hidden = true;
      setSiteFormStatus("");
    });
    siteNameInput.addEventListener("input", () => {
      if (!siteSlugInput.dataset.edited) siteSlugInput.value = slugify(siteNameInput.value);
    });
    siteSlugInput.addEventListener("input", () => {
      siteSlugInput.dataset.edited = siteSlugInput.value ? "true" : "";
    });
    siteForm.addEventListener("submit", createWebsite);

    supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session?.user) openLogin();
    });
  } catch (error) {
    document.body.classList.add("portal-denied");
    showStatus(error?.message || "Website administration could not be opened.");
  }
}

initWebsiteAdmin();
