import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";
import { portalLoginUrl, resolvePortalTenant, scopeRowsToPortalTenant } from "/client-portal/tenant-context.js";

const adminMode = document.body.dataset.billingRole === "admin";
const content = document.getElementById("billing-content");
const status = document.getElementById("billing-status");
const screen = document.getElementById("portal-status");
const dialog = document.getElementById("billing-review-dialog");
const dialogTitle = document.getElementById("billing-review-title");
const dialogBody = document.getElementById("billing-review-body");
const dialogConfirm = document.getElementById("billing-review-confirm");
const websiteSelect = document.getElementById("admin-billing-website-select");
let dialogAction = null;
let supabase;
let records;
let currentUser;
let websites = [];
let selectedWorkspaceKey = "";
let pendingWorkspaceKey = "";

const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Not scheduled";
const dateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not scheduled";
const escape = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const label = (value = "") => String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localInput = (value) => value ? new Date(new Date(value).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

function workspaceKey(context = {}) {
  if (context.websiteId) return `website:${context.websiteId}`;
  if (context.projectId) return `project:${context.projectId}`;
  return "";
}

function availableWorkspaceKey(key) {
  const [kind, selectedId] = String(key || "").split(":");
  if (kind === "website" && websites.some((website) => website.id === selectedId)) return key;
  if (kind === "project" && records?.projects?.some((project) => project.id === selectedId)) return key;
  return "";
}

function receiveAdminWorkspaceContext(event) {
  if (!adminMode || event.detail?.scope !== "admin") return;
  const nextKey = workspaceKey(event.detail.context);
  if (!nextKey) return;
  pendingWorkspaceKey = nextKey;
  const availableKey = availableWorkspaceKey(nextKey);
  if (!availableKey) return;
  if (availableKey === selectedWorkspaceKey) {
    pendingWorkspaceKey = "";
    return;
  }
  selectedWorkspaceKey = availableKey;
  pendingWorkspaceKey = "";
  renderWebsiteSelector();
  renderSelectedBilling({ persist: false });
}

window.addEventListener("n3xra:workspace-context-change", receiveAdminWorkspaceContext);

function adminTools(project, snapshot, schedule, charges, subscription, communications) {
  if (!adminMode || !snapshot) return "";
  return `<section class="billing-admin-tools">
    <div class="billing-section-heading"><div><p class="portal-kicker">Only when needed</p><h4>Billing controls</h4><p>Schedule service, issue an approved charge, or send a billing message.</p></div></div>
    <details>
      <summary><span><strong>Set when the yearly plan begins</strong><small>Choose the start date and how future renewals are collected.</small></span></summary>
      <form class="billing-operation-form" data-schedule-form="${project.id}">
        <label>Service starts<input type="datetime-local" name="service_start_at" value="${escape(localInput(schedule?.service_start_at))}"></label>
        <label>How the customer pays<select name="collection_method"><option value="charge_automatically"${schedule?.collection_method !== "send_invoice" ? " selected" : ""}>Charge their saved card</option><option value="send_invoice"${schedule?.collection_method === "send_invoice" ? " selected" : ""}>Email them an invoice</option></select></label>
        <label>Invoice is due after<input type="number" name="days_until_due" min="1" max="60" value="${escape(schedule?.days_until_due || 7)}"><small>Number of days; used only when emailing an invoice.</small></label>
        <button class="portal-button" type="submit">Save renewal setup</button>
      </form>
    </details>
    <details>
      <summary><span><strong>Add a one-time extra charge</strong><small>Use only for work or costs the customer has already approved.</small></span></summary>
      <form class="billing-operation-form" data-charge-form="${project.id}">
        <label>Charge source<select name="source"><option value="proposal_balance">Proposal balance</option><option value="milestone">Project milestone</option><option value="domain">Domain</option><option value="third_party">Third-party cost</option><option value="extra_edits">Additional edits</option><option value="additional_service">Additional service</option></select></label>
        <label>Category<select name="category"><option value="website_build">Website build</option><option value="domain">Domain</option><option value="hosting">Hosting</option><option value="maintenance">Maintenance</option><option value="email">Email</option><option value="ssl_cdn">SSL / CDN</option><option value="content">Content</option><option value="ecommerce">Ecommerce</option><option value="integration">Integration</option><option value="other">Other</option></select></label>
        <label>Client-facing name<input name="name" required maxlength="160"></label>
        <label>Amount ($)<input name="amount" type="number" min=".01" step=".01" required></label>
        <label>Issue on<input name="scheduled_for" type="datetime-local"></label>
        <label>Collection<select name="collection_method"><option value="send_invoice">Email invoice</option><option value="charge_automatically">Charge saved card</option></select></label>
        <label class="billing-form-wide">Description<textarea name="description" rows="2"></textarea></label>
        <label class="billing-form-wide">Client approval reference<input name="approval_reference" placeholder="Accepted proposal, email date, or signed change request"></label>
        <label class="billing-check billing-form-wide"><input type="checkbox" name="approval_confirmed"> I confirm the client approved charges outside the accepted proposal.</label>
        <button class="portal-button" type="submit">Review charge</button>
      </form>
    </details>
    <details>
      <summary><span><strong>Send a billing email</strong><small>Choose a message and preview it before anything is sent.</small></span></summary>
      <form class="billing-operation-form" data-message-form="${project.id}">
        <label>Message<select name="template"><option value="billing_setup_ready">Billing setup ready</option><option value="invoice_issued">Invoice issued</option><option value="payment_received">Payment received</option><option value="upcoming_renewal">Upcoming renewal</option><option value="payment_failed">Payment failed</option><option value="card_expiring">Card expiring</option><option value="cancellation_scheduled">Cancellation scheduled</option></select></label>
        <button class="portal-button portal-button-secondary" type="submit">Preview email</button>
      </form>
      ${communications.length ? `<p class="billing-last-message">Last sent: ${dateTime(communications[0].sent_at || communications[0].created_at)} · ${escape(communications[0].subject)}</p>` : ""}
    </details>
    ${subscription ? `<button class="portal-button portal-button-danger" data-cancel-subscription="${project.id}">Schedule cancellation at term end</button>` : ""}
  </section>`;
}

function adminTaskActions(project, snapshot, cardInfo) {
  if (!adminMode || !snapshot) return "";
  if (snapshot.recurring_start_policy === "review_required") {
    return `<section class="billing-task-actions"><div class="billing-section-heading"><div><p class="portal-kicker">No payment due</p><h4>Complimentary service period</h4><p>Starter+ is provided at no charge for ${Number(snapshot.complimentary_months || 0)} months. Review the plan with the client ${Number(snapshot.review_notice_days || 45)} days before that period ends. Do not create a paid subscription or invoice until the client approves it in writing.</p></div></div></section>`;
  }
  const renewalPeriod = snapshot.recurring_interval === "yearly" ? "yearly" : "monthly";
  return `<section class="billing-task-actions">
    <div class="billing-section-heading"><div><p class="portal-kicker">Choose what happened</p><h4>What do you want to do?</h4><p>Pick one. Simply viewing this page does not bill the customer.</p></div></div>
    <div class="billing-task-action-list">
      ${Number(snapshot.recurring_cents || 0) > 0 && !records.subscriptions.some((item) => item.project_id === project.id) ? `<button class="billing-task-action" type="button" data-record-offline-subscription="${project.id}"><strong>They paid the ${renewalPeriod} plan another way</strong><small>Create the ${money(snapshot.recurring_cents)} ${renewalPeriod} invoice, mark it paid, and activate the subscription. No card is charged.</small><span>Record paid plan →</span></button>` : ""}
      ${snapshot.status !== "active" ? `<button class="billing-task-action" type="button" data-admin-checkout="${snapshot.id}"><strong>They need to pay online</strong><small>Create a secure Stripe link and copy it so you can send it to them.</small><span>${snapshot.checkout_url ? "Refresh payment link" : "Create payment link"} →</span></button>` : ""}
      ${snapshot.checkout_url ? `<button class="billing-task-action" type="button" data-copy="${escape(snapshot.checkout_url)}"><strong>I already made a payment link</strong><small>Copy the existing secure link again.</small><span>Copy payment link →</span></button>` : ""}
      ${cardInfo?.stripe_customer_id ? `<a class="billing-task-action" href="https://dashboard.stripe.com/customers/${escape(cardInfo.stripe_customer_id)}" target="_blank" rel="noopener"><strong>I need the Stripe record</strong><small>Open this customer directly in Stripe.</small><span>Open Stripe →</span></a>` : ""}
    </div>
  </section>`;
}

function billingItemList(snapshot) {
  const items = [...(snapshot?.website_billing_snapshot_items || [])]
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
  if (!items.length) return "";
  return `<section class="billing-plan-items">
    <div class="billing-section-heading"><div><p class="portal-kicker">Accepted billing</p><h4>Plan and recurring items</h4><p>Each charge stays separate so the service plan and outside costs are easy to understand.</p></div></div>
    <div class="billing-plan-item-list">${items.map((item) => {
      const frequency = item.billing_type === "recurring" && item.recurring_interval
        ? ` / ${label(item.recurring_interval)}`
        : " one time";
      return `<div class="billing-plan-item"><div><span>${escape(label(item.category || item.billing_type))}</span><strong>${escape(item.name)}</strong>${item.description ? `<small>${escape(item.description)}</small>` : ""}</div><b>${money(item.total_amount_cents)}<small>${escape(frequency)}</small></b></div>`;
    }).join("")}</div>
  </section>`;
}

function chargeList(charges) {
  if (!charges.length) return "";
  return `<div class="billing-charges"><h4>Approved charges</h4>${charges.map((charge) => `<div class="billing-charge">
    <div><strong>${escape(charge.name)}</strong><span>${escape(label(charge.source))} · ${escape(label(charge.status))}${charge.scheduled_for ? ` · ${dateTime(charge.scheduled_for)}` : ""}</span></div>
    <strong>${money(charge.amount_cents)}</strong>
    ${adminMode && charge.status === "draft" ? `<button class="portal-button portal-button-small" data-issue-charge="${charge.id}" data-project="${charge.project_id}">Review &amp; issue</button>` : ""}
    ${adminMode && ["scheduled", "invoiced"].includes(charge.status) ? `<button class="portal-button portal-button-secondary portal-button-small" data-void-charge="${charge.id}" data-project="${charge.project_id}">Void</button>` : ""}
  </div>`).join("")}</div>`;
}

function card(project) {
  const snapshot = records.snapshots.find((item) => item.project_id === project.id);
  const subscription = records.subscriptions.find((item) => item.project_id === project.id);
  const invoices = records.invoices.filter((item) => item.project_id === project.id);
  const schedule = records.schedules.find((item) => item.project_id === project.id);
  const charges = records.charges.filter((item) => item.project_id === project.id);
  const communications = records.communications.filter((item) => item.project_id === project.id);
  const cardInfo = subscription?.website_billing_customers || records.customers.find((item) => item.user_id === project.client_user_id);
  const committed = charges.filter((item) => ["proposal_balance", "milestone"].includes(item.source) && !["void", "canceled"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const remaining = Math.max(0, Number(snapshot?.remaining_build_balance_cents || 0) - committed);
  const state = subscription?.status || snapshot?.status || "not_prepared";
  return `<article class="billing-card" data-project="${project.id}">
    <div class="billing-card-head"><div><p class="portal-kicker">${escape(label(project.status))}</p><h3>${escape(project.name)}</h3><p>${snapshot ? "Review the accepted plan, payment setup, and billing activity." : "No billing setup has been created for this website yet."}</p></div><span class="portal-badge" data-billing-state="${escape(state)}">${escape(label(state))}</span></div>
    ${snapshot ? `<div class="billing-detail-grid">
      <div><span>Website plan</span><strong>${escape(label(snapshot.service_plan))}</strong><small>${escape(label(snapshot.recurring_interval || "one time"))} service</small></div>
      <div><span>Initial payment</span><strong>${money(snapshot.amount_due_now_cents)}</strong><small>${snapshot.recurring_start_policy === "review_required" ? `First ${Number(snapshot.complimentary_months || 0)} months are complimentary` : remaining ? `${money(remaining)} accepted balance not yet billed` : "No remaining proposal balance"}</small></div>
      <div><span>Service starts</span><strong>${dateTime(schedule?.service_start_at || snapshot.activated_at)}</strong><small>${subscription?.current_period_end ? `Next renewal ${date(subscription.current_period_end)}` : "Set when service should begin"}</small></div>
      <div><span>Payment method</span><strong>${cardInfo?.payment_method_last4 ? `${escape(cardInfo.payment_method_brand)} •••• ${escape(cardInfo.payment_method_last4)}` : "Not saved"}</strong><small>${cardInfo?.payment_method_last4 ? "Saved securely in Stripe" : "Added during secure checkout"}</small></div>
    </div>${billingItemList(snapshot)}` : `<div class="billing-empty-state"><div><span aria-hidden="true">$</span><h4>Billing is not prepared</h4><p>Open the approved proposal and prepare billing when this website is ready. Nothing will be charged from this page automatically.</p></div>${adminMode ? '<a class="portal-button" href="/n3xra-admin/proposals/">Open proposals</a>' : ""}</div>`}
    ${adminTaskActions(project, snapshot, cardInfo)}
    <div class="portal-form-actions billing-primary-actions">
      ${!adminMode && snapshot && snapshot.status !== "active" && snapshot.recurring_start_policy !== "review_required" ? `<button class="portal-button" data-checkout="${snapshot.id}">Complete secure billing setup</button>` : ""}
      ${!adminMode && subscription ? `<button class="portal-button" data-portal="${project.id}">Manage billing in Stripe</button>` : ""}
    </div>
    ${chargeList(charges)}
    ${invoices.length ? `<div class="billing-invoices"><h4>Recent invoices</h4>${invoices.map((invoice) => `<a class="billing-invoice" href="${escape(invoice.hosted_invoice_url || invoice.invoice_pdf_url || "#")}" target="_blank" rel="noopener"><span>${date(invoice.created_at)} · ${escape(label(invoice.status))}</span><strong>${money(invoice.total_cents)}</strong></a>`).join("")}</div>` : ""}
    ${adminTools(project, snapshot, schedule, charges, subscription, communications)}
  </article>`;
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    let details;
    try { details = await error.context?.clone?.().json(); } catch { /* Use the SDK message below. */ }
    throw new Error(details?.error || data?.error || error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data;
}

function openReview(title, body, confirmLabel, action) {
  dialogTitle.textContent = title;
  dialogBody.innerHTML = body;
  dialogConfirm.textContent = confirmLabel;
  dialogAction = action;
  dialog.showModal();
}

async function load() {
  const projectId = new URLSearchParams(location.search).get("project");
  const tenantResolution = adminMode ? null : await resolvePortalTenant(supabase);
  records = await invoke("get-website-billing-status", adminMode || tenantResolution?.mode !== "unbound"
    ? {}
    : (projectId ? { project_id: projectId } : {}));

  if (adminMode) {
    const { data, error } = await supabase.from("client_websites").select("id,name,status").order("name");
    if (error) throw error;
    websites = data || [];
    const linkedProject = records.projects.find((project) => project.id === projectId);
    const context = readWorkspaceContext("admin", currentUser.id);
    const pendingKey = availableWorkspaceKey(pendingWorkspaceKey);
    selectedWorkspaceKey = linkedProject
      ? (linkedProject.managed_website_id ? `website:${linkedProject.managed_website_id}` : `project:${linkedProject.id}`)
      : pendingKey
        || (websites.some((website) => website.id === context.websiteId) ? `website:${context.websiteId}` : "")
        || (records.projects.some((project) => project.id === context.projectId) ? `project:${context.projectId}` : "")
        || (websites[0]?.id ? `website:${websites[0].id}` : "")
        || (records.projects[0]?.id ? `project:${records.projects[0].id}` : "");
    pendingWorkspaceKey = "";
    renderWebsiteSelector();
    renderSelectedBilling();
    if (!linkedProject) {
      const latestKey = availableWorkspaceKey(workspaceKey(readWorkspaceContext("admin", currentUser.id)));
      if (latestKey && latestKey !== selectedWorkspaceKey) {
        selectedWorkspaceKey = latestKey;
        renderWebsiteSelector();
        renderSelectedBilling({ persist: false });
      }
    }
    return;
  }

  records.projects = scopeRowsToPortalTenant(records.projects || [], tenantResolution, (project) => project.managed_website_id);
  const tenantProjectIds = new Set(records.projects.map((project) => project.id));
  for (const key of ["snapshots", "subscriptions", "invoices", "schedules", "charges", "communications"]) {
    records[key] = (records[key] || []).filter((item) => tenantProjectIds.has(item.project_id));
  }

  const context = readWorkspaceContext("client", currentUser.id);
  const linkedProject = records.projects.find((project) => project.id === projectId);
  const selectedWebsiteId = tenantResolution.mode === "tenant"
    ? tenantResolution.website_id
    : linkedProject?.managed_website_id || context.websiteId;
  const selectedProjects = selectedWebsiteId
    ? records.projects.filter((project) => project.managed_website_id === selectedWebsiteId)
    : linkedProject ? [linkedProject] : records.projects.slice(0, 1);
  if (selectedProjects[0]?.managed_website_id && selectedProjects[0].managed_website_id !== context.websiteId) {
    writeWorkspaceContext("client", currentUser.id, {
      websiteId: selectedProjects[0].managed_website_id,
      projectId: selectedProjects[0].id,
      name: selectedProjects[0].name,
    });
  }
  content.innerHTML = selectedProjects.length ? selectedProjects.map(card).join("") : `<div class="portal-empty"><p>No website billing records are available for this organization yet.</p></div>`;
}

function renderWebsiteSelector() {
  if (!websiteSelect) return;
  const websiteOptions = websites.map((website) => ({
    value: `website:${website.id}`,
    label: website.name,
  }));
  const unlinkedOptions = records.projects
    .filter((project) => !project.managed_website_id)
    .map((project) => ({
      value: `project:${project.id}`,
      label: `${project.name} · proposal project`,
    }));
  const options = [...websiteOptions, ...unlinkedOptions];
  websiteSelect.innerHTML = options.length
    ? options.map((option) => `<option value="${option.value}"${option.value === selectedWorkspaceKey ? " selected" : ""}>${escape(option.label)}</option>`).join("")
    : '<option value="">No managed websites</option>';
}

function persistSelectedContext(values) {
  const current = readWorkspaceContext("admin", currentUser.id);
  const unchanged = current.websiteId === values.websiteId && current.projectId === values.projectId && current.name === values.name;
  if (!unchanged) writeWorkspaceContext("admin", currentUser.id, values);
}

function renderSelectedBilling({ persist = true } = {}) {
  const [kind, selectedId] = selectedWorkspaceKey.split(":");
  const website = kind === "website" ? websites.find((item) => item.id === selectedId) : null;
  const projects = kind === "website"
    ? records.projects.filter((project) => project.managed_website_id === selectedId)
    : records.projects.filter((project) => project.id === selectedId);
  if (persist && website) {
    const project = projects[0];
    persistSelectedContext({
      websiteId: website.id,
      projectId: project?.id,
      name: website.name,
    });
  } else if (persist && projects[0]) {
    persistSelectedContext({
      websiteId: null,
      projectId: projects[0].id,
      name: projects[0].name,
    });
  }
  content.innerHTML = projects.length
    ? projects.map(card).join("")
    : `<div class="portal-empty"><p>This website does not have a billing project yet. Prepare billing from its approved proposal when it is ready.</p></div>`;
}

content.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.matches("[data-schedule-form]")) {
      const values = new FormData(form);
      status.textContent = "Saving the reviewed service schedule…";
      await invoke("website-billing-operations", { action: "save_schedule", project_id: form.dataset.scheduleForm, service_start_at: values.get("service_start_at"), collection_method: values.get("collection_method"), days_until_due: values.get("days_until_due") });
      status.textContent = "Service schedule saved.";
      await load();
    } else if (form.matches("[data-charge-form]")) {
      const values = Object.fromEntries(new FormData(form));
      const projectId = form.dataset.chargeForm;
      const amountCents = Math.round(Number(values.amount || 0) * 100);
      const preview = `<dl class="billing-review-list"><div><dt>Charge</dt><dd>${escape(values.name)}</dd></div><div><dt>Amount</dt><dd>${money(amountCents)}</dd></div><div><dt>Source</dt><dd>${escape(label(values.source))}</dd></div><div><dt>Collection</dt><dd>${escape(label(values.collection_method))}</dd></div><div><dt>Issue date</dt><dd>${values.scheduled_for ? dateTime(values.scheduled_for) : "Now"}</dd></div></dl><p>This creates an approved draft. You will review it once more before Stripe issues it.</p>`;
      openReview("Review approved charge", preview, "Create approved draft", async () => {
        await invoke("website-billing-operations", { action: "create_charge", project_id: projectId, source: values.source, category: values.category, name: values.name, description: values.description, amount_cents: amountCents, scheduled_for: values.scheduled_for, collection_method: values.collection_method, approval_reference: values.approval_reference, approval_confirmed: values.approval_confirmed === "on" });
        status.textContent = "Approved draft charge created.";
        await load();
      });
    } else if (form.matches("[data-message-form]")) {
      const values = new FormData(form);
      const projectId = form.dataset.messageForm;
      const preview = await invoke("website-billing-operations", { action: "preview_communication", project_id: projectId, template: values.get("template") });
      openReview(`Email preview · ${preview.recipient}`, `<p><strong>${escape(preview.subject)}</strong></p><iframe class="billing-email-preview" title="Billing email preview"></iframe>`, "Send email", async () => {
        await invoke("website-billing-operations", { action: "send_communication", project_id: projectId, template: values.get("template") });
        status.textContent = `Billing email sent to ${preview.recipient}.`;
        await load();
      });
      dialogBody.querySelector("iframe").srcdoc = preview.html;
    }
  } catch (error) {
    status.textContent = error?.message || "Billing action failed.";
  }
});

content.addEventListener("click", async (event) => {
  const offlineSubscription = event.target.closest("[data-record-offline-subscription]");
  const checkout = event.target.closest("[data-checkout]");
  const adminCheckout = event.target.closest("[data-admin-checkout]");
  const portal = event.target.closest("[data-portal]");
  const copy = event.target.closest("[data-copy]");
  const issue = event.target.closest("[data-issue-charge]");
  const voidCharge = event.target.closest("[data-void-charge]");
  const cancel = event.target.closest("[data-cancel-subscription]");
  try {
    if (offlineSubscription) {
      const project = records.projects.find((item) => item.id === offlineSubscription.dataset.recordOfflineSubscription);
      const snapshot = records.snapshots.find((item) => item.project_id === project?.id);
      const now = new Date();
      const receivedOn = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
      const renewalPeriod = snapshot?.recurring_interval === "yearly" ? "yearly" : "monthly";
      openReview("Record paid recurring plan", `<p>This is for money you already received. It creates the ${money(snapshot?.recurring_cents)} ${renewalPeriod} Stripe invoice, marks it paid outside Stripe, and activates the ${escape(label(snapshot?.service_plan))} subscription.</p><div class="billing-review-fields"><label>How they paid<select name="offline_method"><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank transfer</option><option value="other">Other</option></select></label><label>Date received<input name="received_on" type="date" value="${receivedOn}" required></label><label class="billing-form-wide">Reference or note<input name="reference" maxlength="160" placeholder="Optional receipt, check number, or note"></label></div><p><strong>No card will be charged and no payment request will be sent.</strong> Future ${renewalPeriod} renewals will be invoiced through Stripe.</p>`, "Create paid invoice & activate plan", async () => {
        const method = dialogBody.querySelector('[name="offline_method"]').value;
        const paymentDate = dialogBody.querySelector('[name="received_on"]').value;
        const reference = dialogBody.querySelector('[name="reference"]').value;
        await invoke("website-billing-operations", { action: "record_offline_subscription_payment", project_id: project.id, payment_method: method, received_on: paymentDate, reference });
        status.textContent = "Paid recurring invoice created and subscription activated.";
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await load();
      });
    } else if (issue) {
      const charge = records.charges.find((item) => item.id === issue.dataset.issueCharge);
      openReview("Issue Stripe invoice", `<dl class="billing-review-list"><div><dt>Charge</dt><dd>${escape(charge.name)}</dd></div><div><dt>Amount</dt><dd>${money(charge.amount_cents)}</dd></div><div><dt>Collection</dt><dd>${escape(label(charge.collection_method))}</dd></div><div><dt>Schedule</dt><dd>${charge.scheduled_for ? dateTime(charge.scheduled_for) : "Issue now"}</dd></div></dl><p>After this step, the approved financial terms cannot be edited.</p>`, "Issue invoice", async () => {
        await invoke("website-billing-operations", { action: "issue_charge", project_id: issue.dataset.project, charge_id: charge.id });
        status.textContent = "Stripe invoice issued.";
        await load();
      });
    } else if (voidCharge) {
      openReview("Void this invoice?", "<p>This stops collection of the open or scheduled invoice. It does not erase the billing record.</p>", "Void invoice", async () => {
        await invoke("website-billing-operations", { action: "void_charge_invoice", project_id: voidCharge.dataset.project, charge_id: voidCharge.dataset.voidCharge });
        status.textContent = "Invoice voided.";
        await load();
      });
    } else if (cancel) {
      openReview("Schedule cancellation?", "<p>The website service remains active through the current paid term. Stripe will stop future renewal afterward.</p>", "Schedule cancellation", async () => {
        await invoke("website-billing-operations", { action: "schedule_cancellation", project_id: cancel.dataset.cancelSubscription });
        status.textContent = "Cancellation scheduled for the end of the paid term.";
        await load();
      });
    } else if (checkout || adminCheckout) {
      const target = checkout || adminCheckout;
      target.disabled = true;
      status.textContent = adminCheckout ? "Creating the secure client payment link…" : "Opening secure Stripe Checkout…";
      const result = await invoke("create-website-checkout-session", { snapshot_id: checkout?.dataset.checkout || adminCheckout.dataset.adminCheckout });
      if (adminCheckout) { await navigator.clipboard.writeText(result.url); status.textContent = "Secure client payment link copied."; await load(); }
      else location.href = result.url;
    } else if (portal) {
      portal.disabled = true;
      status.textContent = "Opening Stripe billing management…";
      location.href = (await invoke("create-website-portal-session", { project_id: portal.dataset.portal })).url;
    } else if (copy) {
      await navigator.clipboard.writeText(copy.dataset.copy);
      status.textContent = "Payment link copied.";
    }
  } catch (error) {
    status.textContent = error?.message || "Billing action failed.";
  }
});

dialogConfirm?.addEventListener("click", async () => {
  if (!dialogAction) return;
  dialogConfirm.disabled = true;
  try { await dialogAction(); dialog.close(); }
  catch (error) { status.textContent = error?.message || "Billing action failed."; }
  finally { dialogConfirm.disabled = false; dialogAction = null; }
});
document.querySelectorAll("[data-close-billing-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
dialog?.addEventListener("cancel", () => { dialogAction = null; });

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  currentUser = data?.session?.user;
  if (!currentUser) return location.replace(portalLoginUrl());
  if (adminMode && !await verifyPlatformAdmin(supabase, currentUser)) throw new Error("Website billing administration access is required.");
  websiteSelect?.addEventListener("change", () => {
    selectedWorkspaceKey = websiteSelect.value;
    renderSelectedBilling();
  });
  await load();
  document.body.classList.remove("portal-loading");
  screen.hidden = true;
}

init().catch((error) => { screen.textContent = error?.message || "Website billing could not be opened."; });
