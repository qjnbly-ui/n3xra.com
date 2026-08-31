import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const one = (selector) => document.querySelector(selector);
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value) => String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
const date = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
let supabase;
let organizations = [];
let entitlements = [];
let projects = [];
let cards = [];
let selectedOrganizationId = "";
function entitlementFor(organizationId) { return entitlements.find((row) => row.organization_id === organizationId); }
function activeEntitlement(organizationId) { const entitlement = entitlementFor(organizationId); return Boolean(entitlement?.portal_enabled && ["active", "trialing", "past_due"].includes(entitlement.status)); }
function organizationProjects(organizationId) { return projects.filter((project) => project.organization_id === organizationId); }
function organizationCards(organizationId) { return cards.filter((card) => card.organization_id === organizationId); }
function renderOrganizationList() {
    const search = one("#pca-search")?.value.trim().toLowerCase() || "";
    const visible = organizations.filter((organization) => `${organization.name} ${organization.account_status}`.toLowerCase().includes(search));
    const target = one("#pca-organization-list");
    if (target)
        target.innerHTML = visible.map((organization) => `<button type="button" data-organization-id="${escape(organization.id)}" class="${organization.id === selectedOrganizationId ? "is-selected" : ""}"><strong>${escape(organization.name)}</strong><small>${escape(label(organization.account_status))}</small><i class="${activeEntitlement(organization.id) ? "is-active" : ""}">${activeEntitlement(organization.id) ? "Active" : "Available"}</i></button>`).join("");
    one("#pca-organization-count").textContent = String(organizations.length);
}
function recordRow(title, middle, end) { return `<div class="pca-record-row"><strong>${escape(title)}</strong><span>${escape(middle)}</span><small>${escape(end)}</small></div>`; }
function renderDetail() {
    const organization = organizations.find((row) => row.id === selectedOrganizationId);
    const empty = one("#pca-empty");
    const detail = one("#pca-detail");
    if (!organization) {
        if (empty)
            empty.hidden = false;
        if (detail)
            detail.hidden = true;
        return;
    }
    if (empty)
        empty.hidden = true;
    if (detail)
        detail.hidden = false;
    const entitlement = entitlementFor(organization.id);
    const orgProjects = organizationProjects(organization.id);
    const orgCards = organizationCards(organization.id);
    one("#pca-detail-kicker").textContent = `${label(organization.account_status)} customer`;
    one("#pca-detail-title").textContent = organization.name;
    one("#pca-detail-summary").textContent = activeEntitlement(organization.id) ? "Project Cards is available in this customer workspace." : "Project Cards has not been activated for this organization.";
    one("#pca-entitlement-status").textContent = entitlement ? label(entitlement.status) : "Not activated";
    one("#pca-project-total").textContent = String(orgProjects.length);
    one("#pca-card-total").textContent = String(orgCards.length);
    one("#pca-assigned-total").textContent = String(orgCards.filter((card) => card.project_id).length);
    const clientLink = one("#pca-client-link");
    if (clientLink) {
        clientLink.hidden = !activeEntitlement(organization.id);
        clientLink.href = `/client-portal/project-cards/?organization=${encodeURIComponent(organization.id)}`;
    }
    const activate = one("#pca-activate");
    if (activate) {
        activate.hidden = activeEntitlement(organization.id);
        activate.disabled = false;
        activate.textContent = "Activate Project Cards";
    }
    const projectList = one("#pca-project-list");
    if (projectList)
        projectList.innerHTML = orgProjects.length ? orgProjects.map((project) => recordRow(project.name, label(project.status), `Updated ${date(project.updated_at)}`)).join("") : `<p class="pca-no-records">No projects have been created for this organization.</p>`;
    const cardList = one("#pca-card-list");
    if (cardList)
        cardList.innerHTML = orgCards.length ? orgCards.map((card) => recordRow(card.assigned_name || "Not assigned", card.card_code, card.project_id ? "Assigned to a project" : label(card.status))).join("") : `<p class="pca-no-records">No physical cards have been activated for this organization.</p>`;
    renderOrganizationList();
}
async function loadData() {
    const [organizationResult, entitlementResult, projectResult, cardResult] = await Promise.all([
        supabase.from("organizations").select("id,name,account_status").order("name"),
        supabase.from("organization_product_entitlements").select("organization_id,status,portal_enabled").eq("product_key", "project_cards"),
        supabase.from("project_card_projects").select("id,organization_id,name,status,updated_at").order("updated_at", { ascending: false }),
        supabase.from("project_card_devices").select("id,organization_id,project_id,card_code,assigned_name,status").neq("status", "retired").order("updated_at", { ascending: false }),
    ]);
    const error = organizationResult.error || entitlementResult.error || projectResult.error || cardResult.error;
    if (error)
        throw error;
    organizations = (organizationResult.data || []);
    entitlements = (entitlementResult.data || []);
    projects = (projectResult.data || []);
    cards = (cardResult.data || []);
}
async function start() {
    if (!hasConfig())
        throw new Error("The N3XRA data connection is not configured.");
    supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user) {
        window.location.replace(`/account?next=${encodeURIComponent(window.location.pathname)}`);
        return;
    }
    const { data: allowed, error: adminError } = await supabase.rpc("is_platform_admin");
    if (adminError || allowed !== true) {
        window.location.replace("/account");
        return;
    }
    await loadData();
    selectedOrganizationId = organizations[0]?.id || "";
    renderOrganizationList();
    renderDetail();
    one("#pca-status").hidden = true;
    document.body.classList.remove("portal-loading");
}
one("#pca-search")?.addEventListener("input", renderOrganizationList);
one("#pca-organization-list")?.addEventListener("click", (event) => { const button = event.target.closest("[data-organization-id]"); if (!button)
    return; selectedOrganizationId = button.dataset.organizationId || ""; renderDetail(); });
one("#pca-activate")?.addEventListener("click", async () => { const button = one("#pca-activate"); if (!button || !selectedOrganizationId)
    return; button.disabled = true; button.textContent = "Activating…"; const { error } = await supabase.rpc("activate_project_cards", { input_organization_id: selectedOrganizationId }); if (error) {
    button.disabled = false;
    button.textContent = error.message || "Activation failed";
    return;
} await loadData(); renderDetail(); });
void start().catch((error) => { const status = one("#pca-status"); if (status)
    status.textContent = error && typeof error === "object" && "message" in error ? String(error.message || "Unable to open Project Cards administration.") : "Unable to open Project Cards administration."; document.body.classList.remove("portal-loading"); });
