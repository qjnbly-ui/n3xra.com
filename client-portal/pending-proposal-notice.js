import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { resolvePortalTenant } from "./tenant-context.js";
const DISMISSAL_PREFIX = "n3xra:proposal-action-dismissed:";
const WORKSPACE_CONTEXT_KEY = "n3xra-client-workspace-context";
function currentWorkspaceContext(userId) {
    try {
        const context = JSON.parse(window.localStorage.getItem(WORKSPACE_CONTEXT_KEY) || "{}");
        return !context.userId || context.userId === userId ? context : {};
    }
    catch {
        return {};
    }
}
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function localDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}
function dismissalKey(userId, proposalId) {
    return `${DISMISSAL_PREFIX}${userId}:${proposalId}`;
}
function isProposalPage() {
    return window.location.pathname.replace(/\/+$/, "") === "/proposals";
}
function reviewUrl(proposalId) {
    return `/proposals/?proposal=${encodeURIComponent(proposalId)}#proposal-decision-panel`;
}
async function pendingProposalsForCurrentPortal(supabase, userId) {
    const tenant = await resolvePortalTenant(supabase);
    if (tenant.mode === "not_found")
        return [];
    const [proposalResult, projectResult] = await Promise.all([
        supabase
            .from("website_proposals")
            .select("id,title,current_version_id,project_id,request_id,sent_at")
            .eq("status", "sent")
            .order("sent_at", { ascending: false }),
        supabase
            .from("website_projects")
            .select("id,proposal_id,request_id,managed_website_id"),
    ]);
    if (proposalResult.error)
        throw proposalResult.error;
    if (projectResult.error)
        throw projectResult.error;
    const projects = (projectResult.data || []);
    let proposals = (proposalResult.data || []);
    if (tenant.mode === "tenant") {
        const tenantProjects = projects.filter((project) => project.managed_website_id === tenant.website_id);
        const projectIds = new Set(tenantProjects.map((project) => project.id));
        const proposalIds = new Set(tenantProjects.map((project) => project.proposal_id).filter(Boolean));
        const requestIds = new Set(tenantProjects.map((project) => project.request_id).filter(Boolean));
        proposals = proposals.filter((proposal) => projectIds.has(proposal.project_id || "")
            || proposalIds.has(proposal.id)
            || requestIds.has(proposal.request_id));
    }
    else {
        const context = currentWorkspaceContext(userId);
        const hasSelection = Boolean(context.websiteId || context.projectId || context.proposalId || context.requestId);
        if (!hasSelection)
            return [];
        const selectedProjects = projects.filter((project) => project.id === context.projectId
            || project.managed_website_id === context.websiteId
            || project.proposal_id === context.proposalId
            || project.request_id === context.requestId);
        const projectIds = new Set(selectedProjects.map((project) => project.id));
        const proposalIds = new Set(selectedProjects.map((project) => project.proposal_id).filter(Boolean));
        const requestIds = new Set(selectedProjects.map((project) => project.request_id).filter(Boolean));
        proposals = proposals.filter((proposal) => projectIds.has(proposal.project_id || "")
            || proposalIds.has(proposal.id)
            || requestIds.has(proposal.request_id));
    }
    const versionIds = proposals.map((proposal) => proposal.current_version_id).filter((id) => Boolean(id));
    if (!versionIds.length)
        return [];
    const versionResult = await supabase
        .from("website_proposal_versions")
        .select("id,proposal_id,status,valid_until")
        .in("id", versionIds);
    if (versionResult.error)
        throw versionResult.error;
    const today = localDateKey();
    const eligibleVersionByProposal = new Map((versionResult.data || [])
        .filter((version) => version.status === "sent" && (!version.valid_until || version.valid_until >= today))
        .map((version) => [version.proposal_id, version]));
    return proposals.filter((proposal) => eligibleVersionByProposal.has(proposal.id));
}
function markDismissed(userId, proposalId) {
    try {
        window.sessionStorage.setItem(dismissalKey(userId, proposalId), "1");
    }
    catch {
        // The persistent banner still keeps the action visible when storage is unavailable.
    }
}
function wasDismissed(userId, proposalId) {
    try {
        return window.sessionStorage.getItem(dismissalKey(userId, proposalId)) === "1";
    }
    catch {
        return false;
    }
}
function renderNotice(proposals, userId) {
    const proposal = proposals[0];
    if (!proposal || document.querySelector("[data-pending-proposal-notice]"))
        return;
    const additionalCount = Math.max(proposals.length - 1, 0);
    const title = escapeHtml(proposal.title);
    const countCopy = additionalCount
        ? `<span>${additionalCount} more proposal${additionalCount === 1 ? "" : "s"} also need your response.</span>`
        : "";
    const url = reviewUrl(proposal.id);
    const banner = document.createElement("aside");
    banner.className = "client-proposal-action-banner";
    banner.dataset.pendingProposalNotice = proposal.id;
    banner.setAttribute("aria-label", "Proposal action required");
    banner.innerHTML = `
    <div class="client-proposal-action-icon" aria-hidden="true">!</div>
    <div class="client-proposal-action-copy">
      <p>Action required</p>
      <strong>Review and respond to ${title}</strong>
      ${countCopy}
    </div>
    <a class="portal-button" href="${url}" data-pending-proposal-review>Review and accept</a>
  `;
    const content = document.querySelector(".client-workspace-content-column");
    const pagebar = content?.querySelector(":scope > .client-workspace-pagebar");
    if (!content || !pagebar)
        return;
    pagebar.insertAdjacentElement("afterend", banner);
    const dialog = document.createElement("dialog");
    dialog.className = "client-proposal-action-dialog";
    dialog.dataset.pendingProposalNotice = proposal.id;
    dialog.setAttribute("aria-labelledby", "client-proposal-action-title");
    dialog.innerHTML = `
    <div class="client-proposal-action-dialog-head">
      <div>
        <p class="portal-kicker">Action required</p>
        <h2 id="client-proposal-action-title">Your approval is needed</h2>
      </div>
      <button type="button" class="client-proposal-action-close" aria-label="Close this notice">×</button>
    </div>
    <p class="client-proposal-action-lead">N3XRA has prepared <strong>${title}</strong> for your review.</p>
    <div class="client-proposal-action-steps">
      <p>Before work can continue:</p>
      <ol>
        <li>Review the project scope and deliverables.</li>
        <li>Confirm the pricing, recurring services, and agreement terms.</li>
        <li>Accept the agreement, request changes, or decline it.</li>
      </ol>
    </div>
    ${additionalCount ? `<p class="client-proposal-action-more">${additionalCount} additional proposal${additionalCount === 1 ? " also needs" : "s also need"} your response.</p>` : ""}
    <div class="client-proposal-action-dialog-actions">
      <a class="portal-button portal-button-secondary" href="/client-portal/#support" data-pending-proposal-question>Ask a question</a>
      <a class="portal-button" href="${url}" data-pending-proposal-review>Review and accept</a>
    </div>
    <p class="client-proposal-action-footnote">You may close this notice for now. It will appear again the next time you enter your portal until you respond.</p>
  `;
    document.body.append(dialog);
    const dismiss = () => markDismissed(userId, proposal.id);
    dialog.querySelector(".client-proposal-action-close")?.addEventListener("click", () => {
        dismiss();
        dialog.close();
    });
    dialog.addEventListener("cancel", dismiss);
    dialog.querySelectorAll("[data-pending-proposal-review], [data-pending-proposal-question]").forEach((link) => {
        link.addEventListener("click", dismiss);
    });
    banner.querySelector("[data-pending-proposal-review]")?.addEventListener("click", dismiss);
    if (!isProposalPage() && !wasDismissed(userId, proposal.id)) {
        if (typeof dialog.showModal === "function")
            dialog.showModal();
        else
            dialog.setAttribute("open", "");
    }
    window.addEventListener("n3xra:proposal-resolved", (event) => {
        const resolvedId = event instanceof CustomEvent && typeof event.detail?.proposalId === "string"
            ? event.detail.proposalId
            : "";
        if (resolvedId !== proposal.id)
            return;
        if (dialog.open)
            dialog.close();
        dialog.remove();
        banner.remove();
    }, { once: true });
}
export function clearPendingProposalNoticeDismissals() {
    try {
        Object.keys(window.sessionStorage)
            .filter((key) => key.startsWith(DISMISSAL_PREFIX))
            .forEach((key) => window.sessionStorage.removeItem(key));
    }
    catch {
        // Session storage is optional; there is nothing to clear when it is unavailable.
    }
}
export async function initializePendingProposalNotice() {
    if (!hasConfig())
        return;
    const supabase = createBrowserSupabase();
    const session = await getSessionOrNull(supabase);
    if (!session?.user?.id)
        return;
    const proposals = await pendingProposalsForCurrentPortal(supabase, session.user.id);
    if (proposals.length)
        renderNotice(proposals, session.user.id);
}
