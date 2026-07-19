import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import { projectContext, readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

const statusScreen = document.getElementById("portal-status");
const proposalSelect = document.getElementById("client-proposal-select");
const emptyState = document.getElementById("client-proposal-empty");
const documentView = document.getElementById("client-proposal-document");
const decisionPanel = document.getElementById("proposal-decision-panel");
const decisionForm = document.getElementById("proposal-decision-form");
const decisionName = document.getElementById("decision-client-name");
const decisionMessage = document.getElementById("decision-message");
const acknowledgmentCopy = document.getElementById("decision-acknowledgment-copy");
const decisionSubmit = document.getElementById("decision-submit");
const decisionStatus = document.getElementById("decision-status");

let supabase;
let session;
let proposals = [];
let versions = [];
let decisions = [];
let onboardings = [];
let projects = [];
let selectedProposal;
let selectedDecision = "approved";

function rememberProposal() {
  if (!selectedProposal) return;
  const project = currentProject();
  writeWorkspaceContext("client", session.user.id, {
    proposalId: selectedProposal.id,
    requestId: selectedProposal.request_id,
    ...(project ? projectContext(project) : {}),
  });
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatLabel(value = "") {
  return String(value).replaceAll("_", " ");
}

function formatMoney(cents) {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function formatDate(value) {
  if (!value) return "Not specified";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(new Date(`${value}T12:00:00`));
}

function paragraphs(value = "") {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

function list(items = []) {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : "<p>None specified.</p>";
}

function currentVersion() {
  return versions.find((version) => version.id === selectedProposal?.current_version_id);
}

function currentDecision() {
  const version = currentVersion();
  return decisions.find((decision) => decision.version_id === version?.id);
}

function currentOnboarding() {
  return onboardings.find((onboarding) => onboarding.proposal_id === selectedProposal?.id);
}

function currentProject() {
  return projects.find((project) => project.proposal_id === selectedProposal?.id);
}

function renderOptions() {
  proposalSelect.innerHTML = proposals.length
    ? proposals.map((proposal) => `<option value="${proposal.id}">${escapeHtml(proposal.title)} · ${escapeHtml(formatLabel(proposal.status))}</option>`).join("")
    : '<option value="">No proposals</option>';
  proposalSelect.hidden = !proposals.length;
}

function renderProposal() {
  const version = currentVersion();
  const decision = currentDecision();
  const onboarding = currentOnboarding();
  const project = currentProject();
  emptyState.hidden = Boolean(selectedProposal && version);
  documentView.hidden = !selectedProposal || !version;
  decisionPanel.hidden = !selectedProposal || !version || selectedProposal.status !== "sent" || Boolean(decision);
  if (!selectedProposal || !version) return;

  documentView.innerHTML = `
    <header class="portal-proposal-cover">
      <div>
        <p class="portal-kicker">Website proposal · Version ${version.version_number}</p>
        <h2>${escapeHtml(selectedProposal.title)}</h2>
        ${version.introduction ? `<p>${paragraphs(version.introduction)}</p>` : ""}
      </div>
      <div class="portal-proposal-cover-meta">
        <span class="portal-badge portal-status-${escapeHtml(selectedProposal.status)}">${escapeHtml(formatLabel(selectedProposal.status))}</span>
        <p>Sent ${version.sent_at ? new Date(version.sent_at).toLocaleDateString() : "—"}</p>
        <p>Valid until ${formatDate(version.valid_until)}</p>
      </div>
    </header>

    ${decision ? `<div class="portal-decision-record"><strong>Response recorded: ${escapeHtml(formatLabel(decision.decision))}</strong><p>${new Date(decision.created_at).toLocaleString()} · ${escapeHtml(decision.client_name)}</p></div>` : ""}
    ${project ? `
      <div class="portal-onboarding-callout">
        <div><p class="portal-kicker">Approved project</p><strong>Your project workspace is ready</strong><p>Follow agreement, billing, onboarding, production, review, launch, and ongoing management in one place.</p></div>
        <div class="portal-card-actions">
          <a class="portal-button" href="/project-workspace/?project=${encodeURIComponent(project.id)}">Open project</a>
          ${onboarding ? `<a class="portal-button portal-button-secondary" href="/website-onboarding/?onboarding=${encodeURIComponent(onboarding.id)}">Open onboarding</a>` : ""}
        </div>
      </div>
    ` : ""}

    <section class="portal-proposal-section">
      <p class="portal-kicker">01 · Objective</p>
      <h3>What this project will accomplish</h3>
      <p>${paragraphs(version.project_objective)}</p>
    </section>
    <section class="portal-proposal-section">
      <p class="portal-kicker">02 · Scope</p>
      <h3>Project scope</h3>
      <p>${paragraphs(version.scope_summary)}</p>
      <div class="portal-proposal-columns">
        <div><h4>Deliverables</h4>${list(version.deliverables)}</div>
        <div><h4>Not included</h4>${list(version.exclusions)}</div>
      </div>
      ${version.revision_policy ? `<div class="portal-proposal-note"><strong>Revision policy</strong><p>${paragraphs(version.revision_policy)}</p></div>` : ""}
    </section>
    <section class="portal-proposal-section">
      <p class="portal-kicker">03 · Schedule</p>
      <h3>Timeline</h3>
      <p>${paragraphs(version.timeline)}</p>
      <dl class="portal-proposal-facts">
        <div><dt>Estimated start</dt><dd>${formatDate(version.estimated_start_date)}</dd></div>
        <div><dt>Estimated completion</dt><dd>${formatDate(version.estimated_completion_date)}</dd></div>
      </dl>
    </section>
    <section class="portal-proposal-section">
      <p class="portal-kicker">04 · Investment</p>
      <h3>Project investment</h3>
      <div class="portal-price-table">
        <div><span>Project subtotal</span><strong>${formatMoney(version.subtotal_cents)}</strong></div>
        ${version.discount_cents ? `<div><span>Discount</span><strong>−${formatMoney(version.discount_cents)}</strong></div>` : ""}
        <div class="is-total"><span>Total project investment</span><strong>${formatMoney(version.total_cents)}</strong></div>
        <div><span>Deposit due at contract</span><strong>${formatMoney(version.deposit_cents)}</strong></div>
        ${version.recurring_cents ? `<div><span>Ongoing service</span><strong>${formatMoney(version.recurring_cents)} / ${escapeHtml(version.recurring_interval)}</strong></div>` : ""}
      </div>
      ${version.payment_schedule ? `<div class="portal-proposal-note"><strong>Payment schedule</strong><p>${paragraphs(version.payment_schedule)}</p></div>` : ""}
    </section>
    <section class="portal-proposal-section">
      <p class="portal-kicker">05 · Terms</p>
      <h3>Proposal terms</h3>
      <p>${paragraphs(version.terms)}</p>
    </section>
  `;
  updateDecisionCopy();
}

function updateDecisionCopy() {
  const version = currentVersion();
  const labels = {
    approved: "Approve proposal",
    changes_requested: "Send change request",
    declined: "Decline proposal",
  };
  decisionSubmit.textContent = labels[selectedDecision];
  acknowledgmentCopy.textContent = selectedDecision === "approved"
    ? `I reviewed and approve proposal version ${version?.version_number}, including its scope, investment, and terms.`
    : `I reviewed proposal version ${version?.version_number} and confirm this response.`;
  document.querySelectorAll("[data-decision]").forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.decision === selectedDecision);
  });
}

async function loadProposals(preferredId) {
  const [proposalResult, versionResult, decisionResult, onboardingResult, projectResult] = await Promise.all([
    supabase.from("website_proposals").select("*").order("created_at", { ascending: false }),
    supabase.from("website_proposal_versions").select("*").order("version_number", { ascending: false }),
    supabase.from("website_proposal_decisions").select("*").order("created_at", { ascending: false }),
    supabase.from("website_onboardings").select("id,proposal_id,status").order("created_at", { ascending: false }),
    supabase.from("website_projects").select("id,proposal_id,request_id,managed_website_id,name,status,client_websites(id,name)").order("created_at", { ascending: false }),
  ]);
  if (proposalResult.error) throw proposalResult.error;
  if (versionResult.error) throw versionResult.error;
  if (decisionResult.error) throw decisionResult.error;
  if (onboardingResult.error) throw onboardingResult.error;
  if (projectResult.error) throw projectResult.error;
  proposals = proposalResult.data || [];
  versions = versionResult.data || [];
  decisions = decisionResult.data || [];
  onboardings = onboardingResult.data || [];
  projects = projectResult.data || [];
  renderOptions();
  const context = readWorkspaceContext("client", session.user.id);
  const requested = preferredId || new URLSearchParams(window.location.search).get("proposal") || context.proposalId;
  const relatedProject = projects.find((project) => project.id === context.projectId || project.managed_website_id === context.websiteId);
  selectedProposal = proposals.find((proposal) => proposal.id === requested)
    || proposals.find((proposal) => proposal.id === relatedProject?.proposal_id || proposal.request_id === context.requestId)
    || (!context.websiteId && !context.projectId ? proposals[0] : undefined);
  if (selectedProposal) proposalSelect.value = selectedProposal.id;
  else proposalSelect.selectedIndex = -1;
  rememberProposal();
  renderProposal();
}

async function submitDecision(event) {
  event.preventDefault();
  const version = currentVersion();
  if (!selectedProposal || !version) return;
  if (selectedDecision === "changes_requested" && !decisionMessage.value.trim()) {
    decisionStatus.textContent = "Describe the changes you need.";
    decisionStatus.classList.add("is-error");
    return;
  }
  decisionSubmit.disabled = true;
  decisionStatus.classList.remove("is-error");
  decisionStatus.textContent = "Recording your response…";
  try {
    const { error } = await supabase.from("website_proposal_decisions").insert({
      proposal_id: selectedProposal.id,
      version_id: version.id,
      user_id: session.user.id,
      decision: selectedDecision,
      client_name: decisionName.value.trim(),
      client_message: decisionMessage.value.trim() || null,
      acknowledgment: acknowledgmentCopy.textContent,
    });
    if (error) throw error;
    decisionStatus.textContent = "Your response was recorded.";
    await loadProposals(selectedProposal.id);
  } catch (error) {
    decisionStatus.textContent = error?.message || "Unable to record this response.";
    decisionStatus.classList.add("is-error");
  } finally {
    decisionSubmit.disabled = false;
  }
}

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    window.location.replace("/account/?next=%2Fproposals%2F");
    return;
  }
  decisionName.value = String(session.user.user_metadata?.full_name || "").trim();
  await loadProposals();
  proposalSelect.addEventListener("change", () => {
    selectedProposal = proposals.find((proposal) => proposal.id === proposalSelect.value);
    rememberProposal();
    renderProposal();
  });
  document.querySelector(".portal-decision-options").addEventListener("click", (event) => {
    const button = event.target.closest("[data-decision]");
    if (!button) return;
    selectedDecision = button.dataset.decision;
    updateDecisionCopy();
  });
  decisionForm.addEventListener("submit", submitDecision);
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => {
  statusScreen.textContent = error?.message || "Your proposals could not be opened.";
});
