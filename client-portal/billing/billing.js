import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";
import { readWorkspaceContext, writeWorkspaceContext } from "/client-portal/workspace-context.js";

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

const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Not scheduled";
const dateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Not scheduled";
const escape = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const label = (value = "") => String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const localInput = (value) => value ? new Date(new Date(value).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";

function adminTools(project, snapshot, schedule, charges, subscription, communications) {
  if (!adminMode || !snapshot) return "";
  const committed = charges
    .filter((item) => ["proposal_balance", "milestone"].includes(item.source) && !["void", "canceled"].includes(item.status))
    .reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
  const available = Math.max(0, Number(snapshot.remaining_build_balance_cents || 0) - committed);
  return `<section class="billing-admin-tools">
    <details open>
      <summary><span><strong>Service schedule</strong><small>Choose when recurring website service starts.</small></span></summary>
      <form class="billing-operation-form" data-schedule-form="${project.id}">
        <label>Service starts<input type="datetime-local" name="service_start_at" value="${escape(localInput(schedule?.service_start_at))}"></label>
        <label>Default collection<select name="collection_method"><option value="charge_automatically"${schedule?.collection_method !== "send_invoice" ? " selected" : ""}>Charge saved card</option><option value="send_invoice"${schedule?.collection_method === "send_invoice" ? " selected" : ""}>Email invoice</option></select></label>
        <label>Invoice due in days<input type="number" name="days_until_due" min="1" max="60" value="${escape(schedule?.days_until_due || 7)}"></label>
        <button class="portal-button" type="submit">Save schedule</button>
      </form>
    </details>
    <details>
      <summary><span><strong>Create an approved charge</strong><small>${money(available)} of the accepted proposal balance is not yet allocated.</small></span></summary>
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
      <summary><span><strong>Client communication</strong><small>Preview every message before sending.</small></span></summary>
      <form class="billing-operation-form" data-message-form="${project.id}">
        <label>Message<select name="template"><option value="billing_setup_ready">Billing setup ready</option><option value="invoice_issued">Invoice issued</option><option value="payment_received">Payment received</option><option value="upcoming_renewal">Upcoming renewal</option><option value="payment_failed">Payment failed</option><option value="card_expiring">Card expiring</option><option value="cancellation_scheduled">Cancellation scheduled</option></select></label>
        <button class="portal-button portal-button-secondary" type="submit">Preview email</button>
      </form>
      ${communications.length ? `<p class="billing-last-message">Last sent: ${dateTime(communications[0].sent_at || communications[0].created_at)} · ${escape(communications[0].subject)}</p>` : ""}
    </details>
    ${subscription ? `<button class="portal-button portal-button-danger" data-cancel-subscription="${project.id}">Schedule cancellation at term end</button>` : ""}
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
  return `<article class="billing-card" data-project="${project.id}">
    <div class="billing-card-head"><div><p class="portal-kicker">${escape(project.status)}</p><h3>${escape(project.name)}</h3></div><span class="portal-badge">${escape(label(subscription?.status || snapshot?.status || "Not prepared"))}</span></div>
    ${snapshot ? `<div class="billing-detail-grid">
      <div><span>Service plan</span><strong>${escape(label(snapshot.service_plan))} · ${escape(label(snapshot.recurring_interval || "one time"))}</strong></div>
      <div><span>Service starts</span><strong>${dateTime(schedule?.service_start_at || snapshot.activated_at)}</strong></div>
      <div><span>Initial amount</span><strong>${money(snapshot.amount_due_now_cents)}</strong></div>
      <div><span>Unbilled proposal balance</span><strong>${money(remaining)}</strong></div>
      <div><span>Recurring service</span><strong>${money(snapshot.recurring_cents)}${snapshot.recurring_interval ? ` / ${escape(snapshot.recurring_interval)}` : ""}</strong></div>
      <div><span>Payment method</span><strong>${cardInfo?.payment_method_last4 ? `${escape(cardInfo.payment_method_brand)} •••• ${escape(cardInfo.payment_method_last4)}` : "Not saved"}</strong></div>
      ${subscription ? `<div><span>Next renewal</span><strong>${date(subscription.current_period_end)}</strong></div><div><span>Annual commitment ends</span><strong>${date(subscription.commitment_ends_at)}</strong></div>` : ""}
    </div>` : `<div class="portal-empty"><p>Billing has not been prepared for this approved proposal.</p></div>`}
    <div class="portal-form-actions">
      ${!adminMode && snapshot && snapshot.status !== "active" ? `<button class="portal-button" data-checkout="${snapshot.id}">Complete secure billing setup</button>` : ""}
      ${!adminMode && subscription ? `<button class="portal-button" data-portal="${project.id}">Manage billing in Stripe</button>` : ""}
      ${adminMode && snapshot && snapshot.status !== "active" ? `<button class="portal-button" data-admin-checkout="${snapshot.id}">${snapshot.checkout_url ? "Refresh payment link" : "Create payment link"}</button>` : ""}
      ${adminMode && snapshot?.checkout_url ? `<button class="portal-button portal-button-secondary" data-copy="${escape(snapshot.checkout_url)}">Copy payment link</button>` : ""}
      ${adminMode && cardInfo?.stripe_customer_id ? `<a class="portal-button portal-button-secondary" href="https://dashboard.stripe.com/customers/${escape(cardInfo.stripe_customer_id)}" target="_blank" rel="noopener">Open Stripe record</a>` : ""}
    </div>
    ${chargeList(charges)}
    ${invoices.length ? `<div class="billing-invoices"><h4>Recent invoices</h4>${invoices.map((invoice) => `<a class="billing-invoice" href="${escape(invoice.hosted_invoice_url || invoice.invoice_pdf_url || "#")}" target="_blank" rel="noopener"><span>${date(invoice.created_at)} · ${escape(label(invoice.status))}</span><strong>${money(invoice.total_cents)}</strong></a>`).join("")}</div>` : ""}
    ${adminTools(project, snapshot, schedule, charges, subscription, communications)}
  </article>`;
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw new Error(data?.error || error.message);
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
  records = await invoke("get-website-billing-status", adminMode ? {} : (projectId ? { project_id: projectId } : {}));

  if (adminMode) {
    const { data, error } = await supabase.from("client_websites").select("id,name,status").order("name");
    if (error) throw error;
    websites = data || [];
    const linkedProject = records.projects.find((project) => project.id === projectId);
    const context = readWorkspaceContext("admin", currentUser.id);
    selectedWorkspaceKey = linkedProject
      ? (linkedProject.managed_website_id ? `website:${linkedProject.managed_website_id}` : `project:${linkedProject.id}`)
      : (websites.some((website) => website.id === context.websiteId) ? `website:${context.websiteId}` : "")
        || (records.projects.some((project) => project.id === context.projectId) ? `project:${context.projectId}` : "")
        || (websites[0]?.id ? `website:${websites[0].id}` : "")
        || (records.projects[0]?.id ? `project:${records.projects[0].id}` : "");
    renderWebsiteSelector();
    renderSelectedBilling();
    return;
  }

  const context = readWorkspaceContext("client", currentUser.id);
  const linkedProject = records.projects.find((project) => project.id === projectId);
  const selectedWebsiteId = linkedProject?.managed_website_id || context.websiteId;
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

function renderSelectedBilling() {
  const [kind, selectedId] = selectedWorkspaceKey.split(":");
  const website = kind === "website" ? websites.find((item) => item.id === selectedId) : null;
  const projects = kind === "website"
    ? records.projects.filter((project) => project.managed_website_id === selectedId)
    : records.projects.filter((project) => project.id === selectedId);
  if (website) {
    const project = projects[0];
    writeWorkspaceContext("admin", currentUser.id, {
      websiteId: website.id,
      projectId: project?.id,
      name: website.name,
    });
  } else if (projects[0]) {
    writeWorkspaceContext("admin", currentUser.id, {
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
  const checkout = event.target.closest("[data-checkout]");
  const adminCheckout = event.target.closest("[data-admin-checkout]");
  const portal = event.target.closest("[data-portal]");
  const copy = event.target.closest("[data-copy]");
  const issue = event.target.closest("[data-issue-charge]");
  const voidCharge = event.target.closest("[data-void-charge]");
  const cancel = event.target.closest("[data-cancel-subscription]");
  try {
    if (issue) {
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
  if (!currentUser) return location.replace(`/account/?next=${encodeURIComponent(location.pathname + location.search)}`);
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
