import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const websiteSelect = document.getElementById("admin-services-website-select");
const statusScreen = document.getElementById("portal-status");
const inlineStatus = document.getElementById("admin-services-status");
let supabase;
let user;
let websites = [], services = [], domains = [], repositories = [], requests = [];
let selectedWebsite;
const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value = "") => String(value).replaceAll("_", " ");
const value = (id) => document.getElementById(id).value.trim();
const emptyToNull = (input) => input || null;
const empty = (copy) => `<div class="portal-empty portal-empty-compact"><p>${escapeHtml(copy)}</p></div>`;
const scoped = (rows) => rows.filter((row) => row.website_id === selectedWebsite?.id);

function card(kind, row, facts) {
  return `<article class="portal-service-card"><div class="portal-service-card-head"><div><p class="portal-kicker">${escapeHtml(kind)}</p><h4>${escapeHtml(row.name || row.domain_name || row.full_name)}</h4></div><span class="portal-badge">${escapeHtml(label(row.status || row.access_status))}</span></div><dl class="portal-service-facts">${facts}</dl>${row.client_summary ? `<p>${escapeHtml(row.client_summary)}</p>` : ""}<div class="portal-card-actions"><button class="portal-button portal-button-secondary" type="button" data-edit-kind="${kind}" data-edit-id="${row.id}">Edit</button><button class="portal-link-button is-danger" type="button" data-delete-kind="${kind}" data-delete-id="${row.id}">Delete</button></div></article>`;
}

function render() {
  const serviceRows = scoped(services), domainRows = scoped(domains), repositoryRows = scoped(repositories), requestRows = scoped(requests);
  document.getElementById("admin-service-grid").innerHTML = serviceRows.length ? serviceRows.map((row) => card("service", row, `<div><dt>Type</dt><dd>${escapeHtml(label(row.service_type))}</dd></div><div><dt>Provider</dt><dd>${escapeHtml(row.provider || "—")}</dd></div><div><dt>Account reference</dt><dd>${escapeHtml(row.account_identifier || "—")}</dd></div><div><dt>Ownership</dt><dd>${escapeHtml(label(row.ownership))}</dd></div><div><dt>Renewal</dt><dd>${escapeHtml(row.renewal_date || "—")}</dd></div>`)).join("") : empty("No services recorded.");
  document.getElementById("admin-domain-grid").innerHTML = domainRows.length ? domainRows.map((row) => card("domain", row, `<div><dt>Registrar</dt><dd>${escapeHtml(row.registrar || "—")}</dd></div><div><dt>DNS</dt><dd>${escapeHtml(row.dns_provider || "—")}</dd></div><div><dt>Ownership</dt><dd>${escapeHtml(label(row.ownership))}</dd></div><div><dt>Expires</dt><dd>${escapeHtml(row.expires_at || "—")}</dd></div>`)).join("") : empty("No domains recorded.");
  document.getElementById("admin-repository-grid").innerHTML = repositoryRows.length ? repositoryRows.map((row) => card("repository", row, `<div><dt>Provider</dt><dd>${escapeHtml(row.provider)}</dd></div><div><dt>Branch</dt><dd>${escapeHtml(row.default_branch)}</dd></div><div><dt>Visibility</dt><dd>${escapeHtml(row.visibility)}</dd></div><div><dt>Ownership</dt><dd>${escapeHtml(label(row.ownership))}</dd></div>`)).join("") : empty("No repositories recorded.");
  document.getElementById("admin-service-request-list").innerHTML = requestRows.length ? requestRows.map((row) => `<article class="portal-request-card"><div><p class="portal-kicker">${escapeHtml(label(row.request_type))}</p><h4>${escapeHtml(label(row.status))}</h4><p>${escapeHtml(row.client_message || "No client message.")}${row.github_username ? ` · GitHub: ${escapeHtml(row.github_username)}` : ""}</p></div><div class="portal-request-controls"><select data-request-status="${row.id}">${["submitted","reviewing","waiting_on_client","approved","completed","declined","cancelled"].map((status) => `<option value="${status}"${row.status === status ? " selected" : ""}>${label(status)}</option>`).join("")}</select><textarea data-request-notes="${row.id}" rows="2" placeholder="Private notes">${escapeHtml(row.admin_notes || "")}</textarea><button class="portal-button portal-button-secondary" data-save-request="${row.id}" type="button">Save</button></div></article>`).join("") : empty("No client requests for this website.");
}

async function loadData(preferredWebsiteId) {
  const results = await Promise.all([
    supabase.from("client_websites").select("id,name,status").order("name"),
    supabase.from("website_services").select("*").order("sort_order").order("name"),
    supabase.from("website_domains").select("*").order("is_primary", { ascending: false }),
    supabase.from("website_repositories").select("*").order("created_at"),
    supabase.from("website_service_access_requests").select("*").order("created_at", { ascending: false }),
  ]);
  for (const result of results) if (result.error) throw result.error;
  [websites, services, domains, repositories, requests] = results.map((result) => result.data || []);
  websiteSelect.innerHTML = websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("");
  const context = readWorkspaceContext("admin", user.id);
  selectedWebsite = websites.find((website) => website.id === (preferredWebsiteId || context.websiteId)) || websites[0];
  if (selectedWebsite) websiteSelect.value = selectedWebsite.id;
  render();
}

async function saveRow(table, id, payload) {
  const query = id ? supabase.from(table).update(payload).eq("id", id) : supabase.from(table).insert({ ...payload, website_id: selectedWebsite.id });
  const { error } = await query;
  if (error) throw error;
  inlineStatus.textContent = "Saved.";
  await loadData(selectedWebsite.id);
}

document.getElementById("admin-service-form").addEventListener("submit", (event) => {
  event.preventDefault();
  saveRow("website_services", value("admin-service-id"), {
    service_type: value("admin-service-type"), name: value("admin-service-name"), provider: emptyToNull(value("admin-service-provider")), account_identifier: emptyToNull(value("admin-service-account")),
    status: value("admin-service-status"), ownership: value("admin-service-ownership"), plan_name: emptyToNull(value("admin-service-plan")),
    renewal_date: emptyToNull(value("admin-service-renewal")), monthly_cost_cents: value("admin-service-cost") ? Math.round(Number(value("admin-service-cost")) * 100) : null,
    public_url: emptyToNull(value("admin-service-url")), client_summary: emptyToNull(value("admin-service-summary")), admin_notes: emptyToNull(value("admin-service-notes")),
  }).catch((error) => { inlineStatus.textContent = error.message; });
});
document.getElementById("admin-domain-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const id = value("admin-domain-id");
    if (document.getElementById("admin-domain-primary").checked) {
      let clearPrimary = supabase.from("website_domains").update({ is_primary: false }).eq("website_id", selectedWebsite.id);
      if (id) clearPrimary = clearPrimary.neq("id", id);
      const { error } = await clearPrimary;
      if (error) throw error;
    }
    await saveRow("website_domains", id, {
    domain_name: value("admin-domain-name").toLowerCase(), registrar: emptyToNull(value("admin-domain-registrar")), dns_provider: emptyToNull(value("admin-domain-dns")),
    status: value("admin-domain-status"), ownership: value("admin-domain-ownership"), expires_at: emptyToNull(value("admin-domain-expires")),
    auto_renew: document.getElementById("admin-domain-auto-renew").checked, is_primary: document.getElementById("admin-domain-primary").checked,
    client_summary: emptyToNull(value("admin-domain-summary")), admin_notes: emptyToNull(value("admin-domain-notes")),
    });
  } catch (error) {
    inlineStatus.textContent = error.message;
  }
});
document.getElementById("admin-repository-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const fullName = value("admin-repository-name");
  saveRow("website_repositories", value("admin-repository-id"), {
    provider: value("admin-repository-provider"), full_name: fullName, html_url: emptyToNull(value("admin-repository-url")) || (value("admin-repository-provider") === "github" ? `https://github.com/${fullName}` : null),
    default_branch: value("admin-repository-branch") || "main", visibility: value("admin-repository-visibility"), ownership: value("admin-repository-ownership"),
    access_status: value("admin-repository-access"), archive_download_enabled: document.getElementById("admin-repository-download").checked,
    transfer_available: document.getElementById("admin-repository-transfer").checked, client_summary: emptyToNull(value("admin-repository-summary")), admin_notes: emptyToNull(value("admin-repository-notes")),
  }).catch((error) => { inlineStatus.textContent = error.message; });
});

function fill(kind, row) {
  const set = (id, next) => { document.getElementById(id).value = next ?? ""; };
  if (kind === "service") {
    set("admin-service-id", row.id); set("admin-service-type", row.service_type); set("admin-service-name", row.name); set("admin-service-provider", row.provider); set("admin-service-account", row.account_identifier); set("admin-service-status", row.status); set("admin-service-ownership", row.ownership); set("admin-service-plan", row.plan_name); set("admin-service-renewal", row.renewal_date); set("admin-service-cost", row.monthly_cost_cents == null ? "" : row.monthly_cost_cents / 100); set("admin-service-url", row.public_url); set("admin-service-summary", row.client_summary); set("admin-service-notes", row.admin_notes);
  } else if (kind === "domain") {
    set("admin-domain-id", row.id); set("admin-domain-name", row.domain_name); set("admin-domain-registrar", row.registrar); set("admin-domain-dns", row.dns_provider); set("admin-domain-status", row.status); set("admin-domain-ownership", row.ownership); set("admin-domain-expires", row.expires_at); document.getElementById("admin-domain-auto-renew").checked = Boolean(row.auto_renew); document.getElementById("admin-domain-primary").checked = row.is_primary; set("admin-domain-summary", row.client_summary); set("admin-domain-notes", row.admin_notes);
  } else {
    set("admin-repository-id", row.id); set("admin-repository-provider", row.provider); set("admin-repository-name", row.full_name); set("admin-repository-url", row.html_url); set("admin-repository-branch", row.default_branch); set("admin-repository-visibility", row.visibility); set("admin-repository-ownership", row.ownership); set("admin-repository-access", row.access_status); document.getElementById("admin-repository-download").checked = row.archive_download_enabled; document.getElementById("admin-repository-transfer").checked = row.transfer_available; set("admin-repository-summary", row.client_summary); set("admin-repository-notes", row.admin_notes);
  }
  document.getElementById(`admin-${kind}-form`).closest("details").open = true;
  document.getElementById(`admin-${kind}-form`).scrollIntoView({ behavior: "smooth", block: "start" });
}

document.querySelector(".portal-workspace").addEventListener("click", async (event) => {
  const edit = event.target.closest("[data-edit-kind]"), remove = event.target.closest("[data-delete-kind]"), saveRequest = event.target.closest("[data-save-request]");
  if (edit) {
    const rows = edit.dataset.editKind === "service" ? services : edit.dataset.editKind === "domain" ? domains : repositories;
    const row = rows.find((item) => item.id === edit.dataset.editId); if (row) fill(edit.dataset.editKind, row);
  }
  if (remove && window.confirm("Delete this record?")) {
    const table = remove.dataset.deleteKind === "service" ? "website_services" : remove.dataset.deleteKind === "domain" ? "website_domains" : "website_repositories";
    const { error } = await supabase.from(table).delete().eq("id", remove.dataset.deleteId); if (error) inlineStatus.textContent = error.message; else await loadData(selectedWebsite.id);
  }
  if (saveRequest) {
    const id = saveRequest.dataset.saveRequest;
    const { error } = await supabase.from("website_service_access_requests").update({
      status: document.querySelector(`[data-request-status="${id}"]`).value,
      admin_notes: document.querySelector(`[data-request-notes="${id}"]`).value.trim() || null,
      handled_by_user_id: user.id, handled_at: new Date().toISOString(),
    }).eq("id", id);
    if (error) inlineStatus.textContent = error.message; else await loadData(selectedWebsite.id);
  }
});

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase(); const { data } = await supabase.auth.getSession(); user = data?.session?.user;
  if (!user) { window.location.replace("/account/?next=%2Fn3xra-admin%2Fservices%2F"); return; }
  if (!await verifyPlatformAdmin(supabase, user)) throw new Error("You do not have service administration access.");
  await loadData();
  websiteSelect.addEventListener("change", () => {
    selectedWebsite = websites.find((website) => website.id === websiteSelect.value);
    writeWorkspaceContext("admin", user.id, { websiteId: selectedWebsite.id, name: selectedWebsite.name, projectId: null, requestId: null, proposalId: null, onboardingId: null });
    render();
  });
  document.body.classList.remove("portal-loading"); statusScreen.hidden = true;
}
init().catch((error) => { statusScreen.textContent = error?.message || "Services administration could not be opened."; });
