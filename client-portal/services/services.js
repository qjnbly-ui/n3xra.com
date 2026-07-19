import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const websiteSelect = document.getElementById("services-website-select");
const serviceGrid = document.getElementById("client-service-grid");
const domainGrid = document.getElementById("client-domain-grid");
const repositoryGrid = document.getElementById("client-repository-grid");
const requestList = document.getElementById("client-service-request-list");
const dialog = document.getElementById("service-request-dialog");
const form = document.getElementById("service-request-form");
const requestType = document.getElementById("service-request-type");
const githubField = document.getElementById("github-username-field");
const requestStatus = document.getElementById("service-request-status");
const statusScreen = document.getElementById("portal-status");
let supabase;
let session;
let websites = [];
let services = [];
let domains = [];
let repositories = [];
let requests = [];
let selectedWebsite;

const escapeHtml = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value = "") => String(value).replaceAll("_", " ");
const formatDate = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`)) : "Not recorded";
const empty = (copy) => `<div class="portal-empty portal-empty-compact"><p>${escapeHtml(copy)}</p></div>`;
const safeHttpUrl = (value) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

function actionButton(type, target, id, text) {
  return `<button class="portal-button portal-button-secondary" type="button" data-request-type="${type}" data-request-target="${target}" data-request-id="${id}">${text}</button>`;
}

function render() {
  const websiteServices = services.filter((item) => item.website_id === selectedWebsite?.id);
  const websiteDomains = domains.filter((item) => item.website_id === selectedWebsite?.id);
  const websiteRepositories = repositories.filter((item) => item.website_id === selectedWebsite?.id);
  const websiteRequests = requests.filter((item) => item.website_id === selectedWebsite?.id);

  serviceGrid.innerHTML = websiteServices.length ? websiteServices.map((service) => {
    const publicUrl = safeHttpUrl(service.public_url);
    return `
    <article class="portal-service-card">
      <div class="portal-service-card-head"><div><p class="portal-kicker">${escapeHtml(label(service.service_type))}</p><h4>${escapeHtml(service.name)}</h4></div><span class="portal-badge">${escapeHtml(label(service.status))}</span></div>
      <dl class="portal-service-facts"><div><dt>Provider</dt><dd>${escapeHtml(service.provider || "Not recorded")}</dd></div><div><dt>Account reference</dt><dd>${escapeHtml(service.account_identifier || "Not recorded")}</dd></div><div><dt>Ownership</dt><dd>${escapeHtml(label(service.ownership))}</dd></div><div><dt>Plan</dt><dd>${escapeHtml(service.plan_name || "Not recorded")}</dd></div><div><dt>Renewal</dt><dd>${escapeHtml(formatDate(service.renewal_date))}</dd></div></dl>
      ${service.client_summary ? `<p>${escapeHtml(service.client_summary)}</p>` : ""}
      <div class="portal-card-actions">${publicUrl ? `<a class="portal-button portal-button-secondary" href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener">Open service</a>` : ""}${actionButton("access", "service", service.id, "Request access")}${service.ownership !== "client_owned" ? actionButton("service_transfer", "service", service.id, "Request transfer") : ""}</div>
    </article>`;
  }).join("") : empty("No service records have been added for this website yet.");

  domainGrid.innerHTML = websiteDomains.length ? websiteDomains.map((domain) => `
    <article class="portal-service-card">
      <div class="portal-service-card-head"><div><p class="portal-kicker">${domain.is_primary ? "Primary domain" : "Domain"}</p><h4>${escapeHtml(domain.domain_name)}</h4></div><span class="portal-badge">${escapeHtml(label(domain.status))}</span></div>
      <dl class="portal-service-facts"><div><dt>Registrar</dt><dd>${escapeHtml(domain.registrar || "Not recorded")}</dd></div><div><dt>DNS provider</dt><dd>${escapeHtml(domain.dns_provider || "Not recorded")}</dd></div><div><dt>Ownership</dt><dd>${escapeHtml(label(domain.ownership))}</dd></div><div><dt>Expires</dt><dd>${escapeHtml(formatDate(domain.expires_at))}</dd></div><div><dt>Auto-renew</dt><dd>${domain.auto_renew == null ? "Not recorded" : domain.auto_renew ? "On" : "Off"}</dd></div></dl>
      ${domain.client_summary ? `<p>${escapeHtml(domain.client_summary)}</p>` : ""}
      <div class="portal-card-actions">${actionButton("access", "domain", domain.id, "Request access")}${actionButton("dns_change", "domain", domain.id, "Request DNS change")}${domain.ownership !== "client_owned" ? actionButton("domain_transfer", "domain", domain.id, "Request transfer") : ""}</div>
    </article>`).join("") : empty("No domain records have been added for this website yet.");

  repositoryGrid.innerHTML = websiteRepositories.length ? websiteRepositories.map((repository) => {
    const repositoryUrl = safeHttpUrl(repository.html_url);
    const archiveUrl = repository.provider === "github" && repository.visibility === "public" && repository.archive_download_enabled
      ? `https://github.com/${repository.full_name}/archive/refs/heads/${encodeURIComponent(repository.default_branch)}.zip` : "";
    return `<article class="portal-service-card">
      <div class="portal-service-card-head"><div><p class="portal-kicker">${escapeHtml(repository.provider)}</p><h4>${escapeHtml(repository.full_name)}</h4></div><span class="portal-badge">${escapeHtml(label(repository.visibility))}</span></div>
      <dl class="portal-service-facts"><div><dt>Default branch</dt><dd>${escapeHtml(repository.default_branch)}</dd></div><div><dt>Ownership</dt><dd>${escapeHtml(label(repository.ownership))}</dd></div><div><dt>Access</dt><dd>${escapeHtml(label(repository.access_status))}</dd></div><div><dt>Last synced</dt><dd>${repository.last_synced_at ? new Date(repository.last_synced_at).toLocaleString() : "Not connected"}</dd></div></dl>
      ${repository.client_summary ? `<p>${escapeHtml(repository.client_summary)}</p>` : ""}
      <div class="portal-card-actions">${repositoryUrl ? `<a class="portal-button portal-button-secondary" href="${escapeHtml(repositoryUrl)}" target="_blank" rel="noopener">View repository</a>` : ""}${archiveUrl ? `<a class="portal-button portal-button-secondary" href="${archiveUrl}">Download ZIP</a>` : actionButton("repository_download", "repository", repository.id, "Request code download")}${actionButton("repository_access", "repository", repository.id, "Request GitHub access")}${repository.transfer_available && repository.ownership !== "client_owned" ? actionButton("repository_transfer", "repository", repository.id, "Request transfer") : ""}</div>
    </article>`;
  }).join("") : empty("No source-code repository has been added for this website yet.");

  requestList.innerHTML = websiteRequests.length ? websiteRequests.map((request) => `<article class="portal-request-card"><div><p class="portal-kicker">${escapeHtml(label(request.request_type))}</p><h4>${escapeHtml(label(request.status))}</h4><p>${escapeHtml(request.client_message || "No additional details.")}</p></div><span>${new Date(request.created_at).toLocaleDateString()}</span></article>`).join("") : empty("You have not submitted any service requests for this website.");
}

async function loadData() {
  const [websiteResult, serviceResult, domainResult, repositoryResult, requestResult] = await Promise.all([
    supabase.from("client_websites").select("id,name,status").order("name"),
    supabase.from("website_services").select("*").order("sort_order").order("name"),
    supabase.from("website_domains").select("*").order("is_primary", { ascending: false }).order("domain_name"),
    supabase.from("website_repositories").select("*").order("created_at"),
    supabase.from("website_service_access_requests").select("*").order("created_at", { ascending: false }),
  ]);
  for (const result of [websiteResult, serviceResult, domainResult, repositoryResult, requestResult]) if (result.error) throw result.error;
  websites = websiteResult.data || []; services = serviceResult.data || []; domains = domainResult.data || []; repositories = repositoryResult.data || []; requests = requestResult.data || [];
  websiteSelect.innerHTML = websites.length ? websites.map((website) => `<option value="${website.id}">${escapeHtml(website.name)}</option>`).join("") : '<option value="">No websites</option>';
  const context = readWorkspaceContext("client", session.user.id);
  selectedWebsite = websites.find((website) => website.id === context.websiteId) || websites[0];
  if (selectedWebsite) websiteSelect.value = selectedWebsite.id;
  render();
}

function openRequest(button) {
  form.reset();
  requestStatus.textContent = "";
  document.getElementById("service-request-service-id").value = button.dataset.requestTarget === "service" ? button.dataset.requestId : "";
  document.getElementById("service-request-domain-id").value = button.dataset.requestTarget === "domain" ? button.dataset.requestId : "";
  document.getElementById("service-request-repository-id").value = button.dataset.requestTarget === "repository" ? button.dataset.requestId : "";
  requestType.value = button.dataset.requestType;
  document.getElementById("service-request-title").textContent = button.textContent;
  githubField.hidden = !button.dataset.requestType.startsWith("repository_");
  dialog.showModal();
}

async function submitRequest(event) {
  event.preventDefault();
  requestStatus.textContent = "Submitting…";
  requestStatus.classList.remove("is-error");
  if (!selectedWebsite) return;
  const { error } = await supabase.from("website_service_access_requests").insert({
    website_id: selectedWebsite.id,
    service_id: document.getElementById("service-request-service-id").value || null,
    domain_id: document.getElementById("service-request-domain-id").value || null,
    repository_id: document.getElementById("service-request-repository-id").value || null,
    requested_by_user_id: session.user.id,
    request_type: requestType.value,
    github_username: document.getElementById("service-request-github-username").value.trim() || null,
    client_message: document.getElementById("service-request-message").value.trim() || null,
  });
  if (error) {
    requestStatus.textContent = error.message;
    requestStatus.classList.add("is-error");
    return;
  }
  dialog.close();
  await loadData();
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase(); session = await getSessionOrNull(supabase);
  if (!session?.user) { window.location.replace("/account/?next=%2Fclient-portal%2Fservices%2F"); return; }
  await loadData();
  websiteSelect.addEventListener("change", () => {
    selectedWebsite = websites.find((website) => website.id === websiteSelect.value);
    writeWorkspaceContext("client", session.user.id, { websiteId: selectedWebsite.id, name: selectedWebsite.name, projectId: null, requestId: null, proposalId: null, onboardingId: null });
    render();
  });
  document.querySelector(".portal-workspace").addEventListener("click", (event) => { const button = event.target.closest("[data-request-type]"); if (button) openRequest(button); });
  requestType.addEventListener("change", () => { githubField.hidden = !requestType.value.startsWith("repository_"); });
  document.getElementById("close-service-request").addEventListener("click", () => dialog.close());
  form.addEventListener("submit", submitRequest);
  document.body.classList.remove("portal-loading"); statusScreen.hidden = true;
}
init().catch((error) => { statusScreen.textContent = error?.message || "Services and ownership could not be opened."; });
