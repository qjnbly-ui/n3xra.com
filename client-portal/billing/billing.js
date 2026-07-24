import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";
import { verifyPlatformAdmin } from "/client-portal/admin-access.js";

const adminMode = document.body.dataset.billingRole === "admin";
const content = document.getElementById("billing-content");
const status = document.getElementById("billing-status");
const screen = document.getElementById("portal-status");
let supabase;
let records;

const money = (value) => new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
const date = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "Not available";
const escape = (value = "") => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const label = (value = "") => String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

function card(project) {
  const snapshot = records.snapshots.find((item) => item.project_id === project.id);
  const subscription = records.subscriptions.find((item) => item.project_id === project.id);
  const invoices = records.invoices.filter((item) => item.project_id === project.id);
  const cardInfo = subscription?.website_billing_customers || records.customers.find((item) => item.user_id === project.client_user_id);
  return `<article class="billing-card" data-project="${project.id}">
    <div class="billing-card-head"><div><p class="portal-kicker">${escape(project.status)}</p><h3>${escape(project.name)}</h3></div><span class="portal-badge">${escape(label(subscription?.status || snapshot?.status || "Not prepared"))}</span></div>
    ${snapshot ? `<div class="billing-detail-grid">
      <div><span>Service plan</span><strong>${escape(label(snapshot.service_plan))} · ${escape(label(snapshot.recurring_interval || "one time"))}</strong></div>
      <div><span>Initial amount</span><strong>${money(snapshot.amount_due_now_cents)}</strong></div>
      <div><span>Remaining proposal balance</span><strong>${money(snapshot.remaining_build_balance_cents)}</strong></div>
      <div><span>Recurring service</span><strong>${money(snapshot.recurring_cents)}${snapshot.recurring_interval ? ` / ${escape(snapshot.recurring_interval)}` : ""}</strong></div>
      <div><span>Referral discount</span><strong>${money(snapshot.discount_cents)}${snapshot.referral_code ? ` · ${escape(snapshot.referral_code)}` : ""}</strong></div>
      <div><span>Payment method</span><strong>${cardInfo?.payment_method_last4 ? `${escape(cardInfo.payment_method_brand)} •••• ${escape(cardInfo.payment_method_last4)}` : "Not saved"}</strong></div>
      ${subscription ? `<div><span>Renewal</span><strong>${date(subscription.current_period_end)}</strong></div><div><span>Annual commitment ends</span><strong>${date(subscription.commitment_ends_at)}</strong></div>` : ""}
    </div>` : `<div class="portal-empty"><p>Billing has not been prepared for this approved proposal.</p></div>`}
    <div class="portal-form-actions">
      ${!adminMode && snapshot && snapshot.status !== "active" ? `<button class="portal-button" data-checkout="${snapshot.id}">Complete secure billing setup</button>` : ""}
      ${!adminMode && subscription ? `<button class="portal-button" data-portal="${project.id}">Manage billing in Stripe</button>` : ""}
      ${adminMode && snapshot && snapshot.status !== "active" ? `<button class="portal-button" data-admin-checkout="${snapshot.id}">${snapshot.checkout_url ? "Refresh payment link" : "Create payment link"}</button>` : ""}
      ${adminMode && snapshot?.checkout_url ? `<button class="portal-button portal-button-secondary" data-copy="${escape(snapshot.checkout_url)}">Copy payment link</button>` : ""}
      ${adminMode && cardInfo?.stripe_customer_id ? `<a class="portal-button portal-button-secondary" href="https://dashboard.stripe.com/customers/${escape(cardInfo.stripe_customer_id)}" target="_blank" rel="noopener">Open Stripe record</a>` : ""}
      ${adminMode && snapshot ? `<a class="portal-button portal-button-secondary" href="/n3xra-admin/proposals/?proposal=${escape(snapshot.proposal_id)}">Open accepted proposal</a>` : ""}
      ${adminMode ? `<a class="portal-button portal-button-secondary" href="/client-portal/billing/?project=${project.id}">Open client billing view</a>` : ""}
    </div>
    ${invoices.length ? `<div class="billing-invoices"><h4>Recent invoices</h4>${invoices.map((invoice) => `<a class="billing-invoice" href="${escape(invoice.hosted_invoice_url || invoice.invoice_pdf_url || "#")}" target="_blank" rel="noopener"><span>${date(invoice.created_at)} · ${escape(label(invoice.status))}</span><strong>${money(invoice.total_cents)}</strong></a>`).join("")}</div>` : ""}
  </article>`;
}

async function invoke(name, body) {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

async function load() {
  const project = new URLSearchParams(location.search).get("project");
  records = await invoke("get-website-billing-status", project ? { project_id: project } : {});
  content.innerHTML = records.projects.length ? records.projects.map(card).join("") : `<div class="portal-empty"><p>No website billing records are available yet.</p></div>`;
}

content.addEventListener("click", async (event) => {
  const checkout = event.target.closest("[data-checkout]");
  const adminCheckout = event.target.closest("[data-admin-checkout]");
  const portal = event.target.closest("[data-portal]");
  const copy = event.target.closest("[data-copy]");
  try {
    if (checkout || adminCheckout) {
      const target = checkout || adminCheckout;
      target.disabled = true;
      status.textContent = adminCheckout ? "Creating the secure client payment link…" : "Opening secure Stripe Checkout…";
      const result = await invoke("create-website-checkout-session", { snapshot_id: checkout?.dataset.checkout || adminCheckout.dataset.adminCheckout });
      if (adminCheckout) {
        await navigator.clipboard.writeText(result.url);
        status.textContent = "Secure client payment link copied.";
        await load();
      } else location.href = result.url;
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

async function init() {
  if (!hasConfig()) throw new Error("Supabase configuration is missing.");
  supabase = createBrowserSupabase();
  const { data } = await supabase.auth.getSession();
  const user = data?.session?.user;
  if (!user) return location.replace(`/account/?next=${encodeURIComponent(location.pathname + location.search)}`);
  if (adminMode && !await verifyPlatformAdmin(supabase, user)) throw new Error("Website billing administration access is required.");
  await load();
  document.body.classList.remove("portal-loading");
  screen.hidden = true;
}

init().catch((error) => { screen.textContent = error?.message || "Website billing could not be opened."; });
