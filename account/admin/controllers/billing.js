let billing = [];
let selectedBillingKey = "";
let invoke;
let escapeHtml;
let formatDate;
let deriveStripeState;
let setStatus;

function billingKey(item) {
  return `${item?.product || "product"}:${item?.id || item?.email || "account"}`;
}

function normalizeBillingStatus(value) {
  return String(value || "unknown").trim().toLowerCase().replaceAll("-", "_");
}

function billingHealth(item) {
  const status = normalizeBillingStatus(item?.status);
  const hasCustomer = Boolean(item?.customerId);
  const hasSubscription = Boolean(item?.subscriptionId);
  if (["past_due", "unpaid", "incomplete", "incomplete_expired"].includes(status)) {
    return { key: "attention", label: "Needs attention", detail: `The subscription is ${status.replaceAll("_", " ")}. Review it in Stripe before changing local access.` };
  }
  if (hasCustomer && !hasSubscription) {
    return { key: "attention", label: "Customer without subscription", detail: "A Stripe customer exists, but no subscription is connected to this product record." };
  }
  if (hasCustomer && hasSubscription) {
    return { key: "connected", label: "Stripe connected", detail: "The local billing record is connected to both a Stripe customer and subscription." };
  }
  if (["active", "trial", "trialing"].includes(status)) {
    return { key: "internal", label: "Internal access only", detail: "This account has product access without a connected Stripe customer or subscription." };
  }
  if (["canceled", "cancelled"].includes(status)) {
    return { key: "canceled", label: "Canceled", detail: "This product record is canceled and has no connected Stripe subscription." };
  }
  return { key: "disconnected", label: "No Stripe record", detail: "No Stripe customer or subscription is connected to this product record." };
}

function billingMatchesHealth(item, filter) {
  if (filter === "all") return true;
  const status = normalizeBillingStatus(item.status);
  if (filter === "active") return status === "active";
  if (filter === "trialing") return ["trial", "trialing"].includes(status);
  if (filter === "disconnected") return !item.customerId && !item.subscriptionId;
  return billingHealth(item).key === filter;
}

function billingProductLink(item) {
  const params = new URLSearchParams({ email: item.email || "" });
  if (item.product === "records") {
    params.set("organization", item.id || "");
    return { href: `/n3xra-admin/records/organizations/?${params.toString()}`, label: "Open Records admin" };
  }
  if (item.product === "websites") {
    params.set("project", item.id || "");
    return { href: `/n3xra-admin/billing/?${params.toString()}`, label: "Open website billing" };
  }
  if (item.product === "ai_music") return { href: `/ai-music-generator/app/?${params.toString()}`, label: "Open AI Music" };
  if (item.product === "virals") return { href: `/virals/?${params.toString()}`, label: "Open Virals" };
  return null;
}

function renderBillingDetail(item) {
  const detail = document.getElementById("billing-detail");
  if (!detail) return;
  if (!item) {
    detail.innerHTML = '<div class="billing-empty-detail"><p class="portal-kicker">Billing operations</p><h2>No billing account selected</h2><p>Choose a billing record from the list to review its plan, usage, and Stripe connection.</p></div>';
    return;
  }
  const health = billingHealth(item);
  const status = normalizeBillingStatus(item.status).replaceAll("_", " ");
  const accountParams = new URLSearchParams({ email: item.email || "" });
  const productLink = billingProductLink(item);
  const stripeCustomerUrl = item.customerId ? `https://dashboard.stripe.com/customers/${encodeURIComponent(item.customerId)}` : "";
  const stripeSubscriptionUrl = item.subscriptionId ? `https://dashboard.stripe.com/subscriptions/${encodeURIComponent(item.subscriptionId)}` : "";
  const invoiceParams = new URLSearchParams({ view: "invoices", create: "invoice", email: item.email || "" });
  if (item.accountUserId) invoiceParams.set("account_user_id", item.accountUserId);
  if (item.product === "websites") invoiceParams.set("website_project_id", item.id || "");
  detail.innerHTML = `
    <header class="billing-detail-head">
      <div><p class="portal-kicker">${escapeHtml(item.productLabel || "Product billing")}</p><h2>${escapeHtml(item.account || item.email || "Billing account")}</h2><p>${escapeHtml(item.email || "No account email")}</p><span class="billing-state is-${escapeHtml(health.key)}">${escapeHtml(status)}</span></div>
      <div class="billing-detail-actions"><a class="portal-button portal-button-secondary" href="/account/admin/accounts/?${escapeHtml(accountParams.toString())}">Account oversight</a><a class="portal-button portal-button-secondary" href="/account/admin/operations/?${escapeHtml(invoiceParams.toString())}">Create or record invoice</a>${productLink ? `<a class="portal-button" href="${escapeHtml(productLink.href)}">${escapeHtml(productLink.label)}</a>` : ""}</div>
    </header>
    <div class="billing-detail-facts">
      <div><span>Plan</span><strong>${escapeHtml(item.plan || "Not set")}</strong></div>
      <div><span>Billing cycle</span><strong>${escapeHtml(item.cycle || "Not recorded")}</strong></div>
      <div><span>Current period end</span><strong>${escapeHtml(formatDate(item.periodEnd))}</strong></div>
      <div><span>Usage</span><strong>${escapeHtml(item.usage || "Not recorded")}</strong></div>
    </div>
    <section class="billing-detail-section">
      <div class="billing-section-heading"><div><p class="portal-kicker">Billing health</p><h3>${escapeHtml(health.label)}</h3><p>${escapeHtml(health.detail)}</p></div><span class="billing-health-mark is-${escapeHtml(health.key)}" aria-hidden="true"></span></div>
      <div class="billing-detail-rows">
        <div><span>Product status</span><strong>${escapeHtml(status)}</strong></div>
        <div><span>Stripe connection</span><strong>${escapeHtml(deriveStripeState(item))}</strong></div>
        <div><span>Renewal information</span><strong>${item.periodEnd ? escapeHtml(formatDate(item.periodEnd)) : "No period end recorded"}</strong></div>
      </div>
    </section>
    <section class="billing-detail-section">
      <div class="billing-section-heading"><div><p class="portal-kicker">Stripe records</p><h3>Customer and subscription</h3><p>Open the source billing records directly when they exist. Payment changes remain in Stripe.</p></div></div>
      <div class="billing-detail-rows">
        <div><span>Customer ID</span><strong class="billing-identifier">${escapeHtml(item.customerId || "Not connected")}</strong>${stripeCustomerUrl ? `<a href="${escapeHtml(stripeCustomerUrl)}" target="_blank" rel="noreferrer">Open customer in Stripe</a>` : ""}</div>
        <div><span>Subscription ID</span><strong class="billing-identifier">${escapeHtml(item.subscriptionId || "Not connected")}</strong>${stripeSubscriptionUrl ? `<a href="${escapeHtml(stripeSubscriptionUrl)}" target="_blank" rel="noreferrer">Open subscription in Stripe</a>` : ""}</div>
        <div><span>Local billing record</span><strong class="billing-identifier">${escapeHtml(item.id || "Not recorded")}</strong></div>
      </div>
    </section>
  `;
}

function renderBilling() {
  const list = document.getElementById("billing-list");
  if (!list) return;
  const query = String(document.getElementById("billing-filter")?.value || "").trim().toLowerCase();
  const product = document.getElementById("billing-product")?.value || "all";
  const healthFilter = document.getElementById("billing-health")?.value || "all";
  const rows = billing.filter((item) => {
    const searchable = [item.account, item.email, item.productLabel, item.plan, item.status, item.usage, deriveStripeState(item)].join(" ").toLowerCase();
    return (product === "all" || item.product === product) && billingMatchesHealth(item, healthFilter) && (!query || searchable.includes(query));
  });
  if (!rows.some((item) => billingKey(item) === selectedBillingKey)) selectedBillingKey = rows[0] ? billingKey(rows[0]) : "";
  list.innerHTML = rows.length ? rows.map((item) => {
    const health = billingHealth(item);
    const selected = billingKey(item) === selectedBillingKey;
    return `<button class="billing-roster-item${selected ? " is-selected" : ""}" type="button" data-billing-key="${escapeHtml(billingKey(item))}"><span class="billing-product-mark">${escapeHtml(String(item.productLabel || "B").split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase())}</span><span class="billing-roster-copy"><strong>${escapeHtml(item.account || item.email)}</strong><small>${escapeHtml(item.productLabel || "Product")} · ${escapeHtml(item.plan || "No plan")}</small></span><span class="billing-roster-state is-${escapeHtml(health.key)}" title="${escapeHtml(health.label)}"></span></button>`;
  }).join("") : '<p class="billing-empty-list">No billing accounts match these filters.</p>';
  const count = document.getElementById("billing-count");
  if (count) count.textContent = `${rows.length} of ${billing.length}`;
  const connected = billing.filter((item) => item.customerId && item.subscriptionId).length;
  const attention = billing.filter((item) => billingHealth(item).key === "attention").length;
  const internal = billing.filter((item) => billingHealth(item).key === "internal").length;
  const summary = document.getElementById("billing-summary");
  if (summary) summary.innerHTML = `<span><strong>${connected}</strong> connected</span><span><strong>${internal}</strong> internal</span><span class="${attention ? "has-attention" : ""}"><strong>${attention}</strong> attention</span>`;
  renderBillingDetail(rows.find((item) => billingKey(item) === selectedBillingKey));
}

async function loadBilling() {
  setStatus("Loading billing accounts…");
  const data = await invoke("list-platform-billing");
  billing = data.billing || [];
  const params = new URLSearchParams(window.location.search);
  const email = String(params.get("email") || "").trim();
  const product = String(params.get("product") || "").trim();
  const user = String(params.get("user") || "").trim();
  const filter = document.getElementById("billing-filter");
  const productSelect = document.getElementById("billing-product");
  if (filter && email) filter.value = email;
  if (productSelect && product && Array.from(productSelect.options).some((option) => option.value === product)) productSelect.value = product;
  const requested = billing.find((item) => (email && String(item.email || "").toLowerCase() === email.toLowerCase()) || (user && String(item.id || "") === user));
  if (requested) selectedBillingKey = billingKey(requested);
  renderBilling();
  setStatus(`${billing.length} billing account${billing.length === 1 ? "" : "s"} loaded.`, "success");
}

export async function startBilling(context = {}) {
  ({ invoke, escapeHtml, formatDate, deriveStripeState, setStatus } = context);
  document.getElementById("billing-filter")?.addEventListener("input", renderBilling);
  document.getElementById("billing-product")?.addEventListener("change", renderBilling);
  document.getElementById("billing-health")?.addEventListener("change", renderBilling);
  document.getElementById("billing-list")?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-billing-key]");
    if (!button) return;
    selectedBillingKey = button.dataset.billingKey || "";
    renderBilling();
  });
  await loadBilling();
}
