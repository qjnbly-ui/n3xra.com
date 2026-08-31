import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
const one = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const label = (value) => String(value || "unknown").replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
let supabase;
let accounts = [];
let organizations = [];
let memberships = [];
let entitlements = [];
let projects = [];
let cards = [];
let selectedAccountId = "";
async function invoke(action, details = {}) {
    const { data, error } = await supabase.functions.invoke("platform-admin", { body: { action, ...details } });
    if (error || data?.error)
        throw new Error(data?.error || error?.message || "Admin request failed.");
    return data || {};
}
function entitlementFor(organizationId) { return entitlements.find((row) => row.organization_id === organizationId); }
function activeEntitlement(organizationId) { const entitlement = entitlementFor(organizationId); return Boolean(entitlement?.portal_enabled && ["active", "trialing", "past_due"].includes(entitlement.status)); }
function assignmentsFor(accountId) {
    const result = new Map();
    organizations.filter((organization) => organization.owner_user_id === accountId).forEach((organization) => result.set(organization.id, { organization, role: "account_admin" }));
    memberships.filter((membership) => membership.user_id === accountId).forEach((membership) => {
        const organization = organizations.find((row) => row.id === membership.organization_id);
        if (organization)
            result.set(organization.id, { organization, role: membership.role });
    });
    return [...result.values()].sort((a, b) => a.organization.name.localeCompare(b.organization.name));
}
function renderAccountList() {
    const search = one("#pca-search")?.value.trim().toLowerCase() || "";
    const visible = accounts.filter((account) => {
        const assignmentNames = assignmentsFor(account.id).map(({ organization }) => organization.name).join(" ");
        return `${account.name} ${account.email} ${assignmentNames}`.toLowerCase().includes(search);
    });
    const target = one("#pca-account-list");
    if (target)
        target.innerHTML = visible.length ? visible.map((account) => {
            const assignments = assignmentsFor(account.id);
            const active = assignments.some(({ organization }) => activeEntitlement(organization.id));
            return `<button type="button" data-account-id="${escape(account.id)}" class="${account.id === selectedAccountId ? "is-selected" : ""}"><strong>${escape(account.name || account.email)}</strong><small>${escape(account.email)}</small><i class="${active ? "is-active" : ""}">${active ? "Connected" : "Available"}</i></button>`;
        }).join("") : '<p class="pca-list-empty">No accounts match this search.</p>';
    one("#pca-account-count").textContent = String(accounts.length);
}
function assignmentRow(account, assignment) {
    const organization = assignment.organization;
    const active = activeEntitlement(organization.id);
    const projectCount = projects.filter((project) => project.organization_id === organization.id).length;
    const cardCount = cards.filter((card) => card.organization_id === organization.id).length;
    const accountQuery = new URLSearchParams({ user: account.id, email: account.email }).toString();
    const action = active
        ? `<a class="portal-button portal-button-secondary" href="/client-portal/project-cards/?organization=${encodeURIComponent(organization.id)}">Open workspace</a>`
        : `<button class="portal-button" type="button" data-activate-organization="${escape(organization.id)}">Assign Project Cards</button>`;
    return `<article class="pca-assignment"><div><span class="pca-state${active ? " is-active" : ""}">${active ? "Project Cards active" : "Available to assign"}</span><h4>${escape(organization.name)}</h4><p>${escape(label(assignment.role))} · ${escape(label(organization.account_status))}</p></div><dl><div><dt>Projects</dt><dd>${projectCount}</dd></div><div><dt>Cards</dt><dd>${cardCount}</dd></div></dl><div class="pca-assignment-actions">${action}<a href="/account/admin/accounts/?${escape(accountQuery)}">Account details</a></div></article>`;
}
function renderDetail() {
    const account = accounts.find((row) => row.id === selectedAccountId);
    const empty = one("#pca-empty");
    const detail = one("#pca-detail");
    if (!account) {
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
    const assignments = assignmentsFor(account.id);
    const activeAssignments = assignments.filter(({ organization }) => activeEntitlement(organization.id));
    const organizationIds = new Set(assignments.map(({ organization }) => organization.id));
    const accountProjects = projects.filter((project) => organizationIds.has(project.organization_id));
    const accountCards = cards.filter((card) => organizationIds.has(card.organization_id));
    one("#pca-detail-title").textContent = account.name || account.email;
    one("#pca-detail-summary").textContent = `${account.email} · Project Cards is available whether or not this account has a client website.`;
    one("#pca-organization-total").textContent = String(assignments.length);
    one("#pca-workspace-total").textContent = String(activeAssignments.length);
    one("#pca-content-total").textContent = `${accountProjects.length} / ${accountCards.length}`;
    const accountLink = one("#pca-account-link");
    if (accountLink)
        accountLink.href = `/account/admin/accounts/?${new URLSearchParams({ user: account.id, email: account.email }).toString()}`;
    const assignmentList = one("#pca-assignment-list");
    if (assignmentList)
        assignmentList.innerHTML = assignments.length
            ? assignments.map((assignment) => assignmentRow(account, assignment)).join("")
            : '<div class="pca-no-assignments"><strong>No organization assignments</strong><p>This account can still activate the independent Project Cards app from its N3XRA dashboard. An organization connection is optional.</p></div>';
    renderAccountList();
}
async function loadData() {
    const [accountResponse, organizationResult, membershipResult, entitlementResult, projectResult, cardResult] = await Promise.all([
        invoke("list-platform-accounts"),
        supabase.from("organizations").select("id,name,account_status,owner_user_id").order("name"),
        supabase.from("organization_memberships").select("organization_id,user_id,role"),
        supabase.from("organization_product_entitlements").select("organization_id,status,portal_enabled").eq("product_key", "project_cards"),
        supabase.from("project_card_projects").select("id,organization_id"),
        supabase.from("project_card_devices").select("id,organization_id,project_id").neq("status", "retired"),
    ]);
    const error = organizationResult.error || membershipResult.error || entitlementResult.error || projectResult.error || cardResult.error;
    if (error)
        throw error;
    accounts = Array.isArray(accountResponse.accounts) ? accountResponse.accounts : [];
    organizations = (organizationResult.data || []);
    memberships = (membershipResult.data || []);
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
    selectedAccountId = new URLSearchParams(window.location.search).get("user") || accounts[0]?.id || "";
    if (!accounts.some((account) => account.id === selectedAccountId))
        selectedAccountId = accounts[0]?.id || "";
    renderAccountList();
    renderDetail();
    one("#pca-status").hidden = true;
    document.body.classList.remove("portal-loading");
}
one("#pca-search")?.addEventListener("input", renderAccountList);
one("#pca-account-list")?.addEventListener("click", (event) => { const button = event.target.closest("[data-account-id]"); if (!button)
    return; selectedAccountId = button.dataset.accountId || ""; renderDetail(); });
one("#pca-assignment-list")?.addEventListener("click", (event) => { const button = event.target.closest("[data-activate-organization]"); if (!button)
    return; void (async () => { button.disabled = true; button.textContent = "Assigning…"; try {
    await invoke("activate-project-cards-for-account", { userId: selectedAccountId, organizationId: button.dataset.activateOrganization });
    await loadData();
    renderDetail();
}
catch (error) {
    button.disabled = false;
    button.textContent = error instanceof Error ? error.message : "Assignment failed";
} })(); });
void start().catch((error) => { const status = one("#pca-status"); if (status)
    status.textContent = error && typeof error === "object" && "message" in error ? String(error.message || "Unable to open Project Cards administration.") : "Unable to open Project Cards administration."; document.body.classList.remove("portal-loading"); });
