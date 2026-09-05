import { privateProductPath } from "./private-products.js";
const html = (value) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function organizationProductLink(path, organizationId) {
    if (!/^\/(?!\/)/.test(path) || /[\s\\]/.test(path))
        return "";
    const url = new URL(path, "https://n3xra.com");
    url.searchParams.set("organization", organizationId);
    return `${url.pathname}${url.search}${url.hash}`;
}
export async function startOrganizations({ supabase }) {
    const root = document.querySelector("#organizations-workspace");
    if (!root)
        return;
    const { data, error } = await supabase.from("organizations").select("id,name,account_status,owner_user_id")
        .eq("workspace_kind", "organization").order("name");
    if (error)
        throw error;
    const organizations = data || [];
    let selected = new URLSearchParams(location.search).get("organization") || organizations[0]?.id || "";
    let revision = 0;
    root.innerHTML = `<aside class="org-directory"><label for="org-search">Organizations</label><input id="org-search" type="search" placeholder="Search organizations"><div id="org-list"></div></aside><section class="org-detail" id="org-detail" aria-live="polite"></section>`;
    const list = root.querySelector("#org-list");
    const detail = root.querySelector("#org-detail");
    function renderList(search = "") {
        list.innerHTML = organizations.filter(o => o.name.toLowerCase().includes(search.toLowerCase())).map(o => `<button type="button" data-org="${html(o.id)}" aria-pressed="${o.id === selected}"><strong>${html(o.name)}</strong><small>${html(o.account_status)}</small></button>`).join("") || "<p>No organizations found.</p>";
    }
    const card = (name, workspace, status, preview, admin = "", adminLabel = "Open admin workspace") => `<article class="account-access-card"><div><span>${html(name)}</span><h4>${html(workspace)}</h4><p>${html(status)}</p></div><div class="account-admin-head-actions">${preview ? `<a class="portal-button portal-button-secondary" href="${html(preview)}">Preview client view</a>` : ""}${admin ? `<a class="portal-button portal-button-secondary" href="${html(admin)}">${html(adminLabel)}</a>` : ""}</div></article>`;
    async function show(id) {
        const org = organizations.find(o => o.id === id);
        if (!org) {
            detail.textContent = "Choose an organization to view its products and members.";
            return;
        }
        selected = id;
        const request = ++revision;
        renderList(root.querySelector("#org-search").value);
        detail.textContent = "Loading organization…";
        const url = new URL(location.href);
        url.searchParams.set("organization", id);
        history.replaceState(history.state, "", url);
        const [websitesResult, productsResult, enrollmentResult, teamPage] = await Promise.all([
            supabase.from("client_websites").select("id,name,portal_slug,status").eq("organization_id", id).order("name"),
            supabase.from("organization_private_products").select("id,organization_id,name,description,app_path,status").eq("organization_id", id).order("name"),
            supabase.from("organization_product_entitlements").select("product_key,status,portal_enabled,product:n3xra_product_catalog(product_key,name,portal_path)").eq("organization_id", id),
            fetch("/client-portal/team/").then(response => { if (!response.ok)
                throw new Error("Organization Admin could not be loaded."); return response.text(); }),
        ]);
        if (request !== revision || !root.isConnected)
            return;
        const failed = [websitesResult, productsResult, enrollmentResult].find(r => r.error);
        if (failed)
            throw failed.error;
        const websites = websitesResult.data || [];
        const products = productsResult.data || [];
        const enrollments = enrollmentResult.data || [];
        const cards = websites.map(w => card("Website Management", w.name, w.status, `/project-workspace/?website=${encodeURIComponent(w.id)}`, `/n3xra-admin/websites/?website=${encodeURIComponent(w.id)}`, "Open Website admin"));
        for (const enrollment of enrollments) {
            if (enrollment.product_key === "website")
                continue;
            const product = Array.isArray(enrollment.product) ? enrollment.product[0] : enrollment.product;
            if (!product)
                continue;
            let preview = organizationProductLink(product.portal_path, id);
            let admin = "";
            if (product.product_key === "records") {
                preview = `/n3xra-records/library/?support_org=${encodeURIComponent(id)}`;
                admin = `/n3xra-admin/records/organizations/?organization=${encodeURIComponent(id)}`;
            }
            if (product.product_key === "project_cards")
                admin = `/n3xra-admin/project-cards/?user=${encodeURIComponent(org.owner_user_id)}&organization=${encodeURIComponent(id)}`;
            if (product.product_key === "communications") {
                const result = await supabase.from("communications_workspaces").select("id,slug").eq("organization_id", id);
                if (result.error)
                    throw result.error;
                const workspace = result.data?.[0];
                if (workspace && result.data.length === 1) {
                    preview = `/client-portal/communications/?workspace=${encodeURIComponent(workspace.slug)}`;
                    admin = `/n3xra-admin/communications/?workspace=${encodeURIComponent(workspace.id)}`;
                }
            }
            if (product.product_key === "loan_tracker") {
                const result = await supabase.from("loan_accounts").select("user_id").eq("organization_id", id).eq("status", "active");
                if (result.error)
                    throw result.error;
                preview = result.data?.length === 1 ? `${organizationProductLink(product.portal_path, id)}&user=${encodeURIComponent(result.data[0].user_id)}` : "";
            }
            cards.push(card(product.name, org.name, `${enrollment.status}${enrollment.portal_enabled ? "" : " · Portal disabled"}`, preview, admin));
        }
        for (const product of products)
            cards.push(card(product.name, org.name, `Private · ${product.status}`, product.status === "active" ? privateProductPath(product.app_path, id, product.id) : ""));
        if (request !== revision || !root.isConnected)
            return;
        detail.innerHTML = `<header><p class="org-eyebrow">Selected organization</p><h1>${html(org.name)}</h1><p>${html(org.account_status)}</p><a class="portal-button portal-button-secondary" href="/client-portal/organization/?organization=${encodeURIComponent(id)}">Preview organization portal</a></header><section class="org-enrollments"><div class="account-oversight-heading"><div><p class="portal-kicker">Product enrollment</p><h2>Products and workspaces</h2><p>Open this organization’s client experience or its matching admin workspace.</p></div><span class="account-admin-count">${cards.length} enrollment${cards.length === 1 ? "" : "s"}</span></div><div class="account-access-grid">${cards.join("") || '<p>No products or workspaces are connected.</p>'}</div></section><section class="org-team-section"><p class="portal-kicker">People &amp; permissions</p><h2>Organization Admin</h2><p>Manage the same team, roles, invitations, and product access used in this organization’s portal.</p><div id="org-team-host"></div></section>`;
        const teamElement = new DOMParser().parseFromString(teamPage, "text/html").querySelector("#client-team");
        if (!teamElement)
            throw new Error("Organization Admin layout is unavailable.");
        const host = detail.querySelector("#org-team-host");
        host.append(document.importNode(teamElement, true));
        const { startOrganizationTeam } = await import("./team.js");
        if (request !== revision || !root.isConnected)
            return;
        await startOrganizationTeam({ root: host, organizationId: id, supabase });
    }
    const showError = (error) => { detail.textContent = error.message || "Unable to load organization."; };
    root.querySelector("#org-search").addEventListener("input", e => renderList(e.target.value));
    list.addEventListener("click", e => { const button = e.target.closest("[data-org]"); if (button)
        void show(button.dataset.org).catch(showError); });
    renderList();
    await show(selected).catch(showError);
}
