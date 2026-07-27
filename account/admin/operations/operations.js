import { outstandingInvoiceCents, summarizeOperations, toCents } from "/lib/operations/calculations.mjs";
import {
  normalizeImportRecords,
  normalizeHeader,
  parseCsv,
  rowsToObjects,
} from "/lib/operations/import-review.mjs";

let supabase;
let session;
let invokeAdmin;
let state = {
  parties: [],
  products: [],
  projects: [],
  financialAccounts: [],
  invoices: [],
  deposits: [],
  transactions: [],
  importBatches: [],
  importRows: [],
  audit: [],
  platformAccounts: [],
};
let activeFormType = "";
let activeImportBatchId = "";

const TABLES = {
  party: "operations_parties",
  product: "operations_products",
  project: "operations_projects",
  account: "operations_financial_accounts",
  invoice: "operations_invoices",
  deposit: "operations_deposits",
  transaction: "operations_transactions",
};

const PAYMENT_METHODS = [
  "cash", "check", "stripe", "ach", "paypal", "venmo", "square",
  "bank_transfer", "business_debit", "business_credit", "manual", "other",
];

const EXPENSE_CATEGORIES = [
  "Hosting", "Domains", "Software", "Advertising", "Equipment", "Office Supplies",
  "Travel", "Fuel", "Meals", "Payroll", "Contractors", "Insurance", "Taxes",
  "Utilities", "Subscriptions", "Legal", "Accounting", "Training", "Miscellaneous",
];

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function moneyCents(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value || 0) / 100);
}

function dateLabel(value) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dateTimeLabel(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function titleCase(value) {
  return String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function todayValue() {
  return new Date().toISOString().slice(0, 10);
}

async function sha256(value) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function setStatus(message = "", tone = "") {
  const element = $("#admin-status");
  if (!element) return;
  element.textContent = message;
  element.className = `admin-status${tone ? ` ${tone}` : ""}`;
}

function partyById(id) {
  return state.parties.find((item) => item.id === id);
}

function productById(id) {
  return state.products.find((item) => item.id === id);
}

function projectById(id) {
  return state.projects.find((item) => item.id === id);
}

function invoiceById(id) {
  return state.invoices.find((item) => item.id === id);
}

function accountById(id) {
  return state.financialAccounts.find((item) => item.id === id);
}

function depositById(id) {
  return state.deposits.find((item) => item.id === id);
}

function emptyState(title, copy) {
  return `<div class="operations-empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(copy)}</span></div>`;
}

function statusBadge(status) {
  return `<span class="operations-status" data-status="${escapeHtml(status)}">${escapeHtml(titleCase(status))}</span>`;
}

function optionList(items, selected, placeholder, labeler = (item) => item.name) {
  return `<option value="">${escapeHtml(placeholder)}</option>${items.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === selected ? " selected" : ""}>${escapeHtml(labeler(item))}</option>`).join("")}`;
}

function valueAttribute(value) {
  return value === null || value === undefined ? "" : escapeHtml(value);
}

function field(label, name, control, { wide = false, help = "" } = {}) {
  return `<label class="operations-field${wide ? " operations-field-wide" : ""}">${escapeHtml(label)}${control}${help ? `<small>${escapeHtml(help)}</small>` : ""}</label>`;
}

function textInput(name, value = "", attributes = "") {
  return `<input name="${name}" value="${valueAttribute(value)}" ${attributes}>`;
}

function textarea(name, value = "", attributes = "") {
  return `<textarea name="${name}" ${attributes}>${escapeHtml(value || "")}</textarea>`;
}

function selectInput(name, options, attributes = "") {
  return `<select name="${name}" ${attributes}>${options}</select>`;
}

function fixedOptions(values, selected, placeholder = "") {
  return `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}${values.map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(titleCase(value))}</option>`).join("")}`;
}

function recordFor(type, id) {
  const collections = {
    party: state.parties,
    product: state.products,
    project: state.projects,
    account: state.financialAccounts,
    invoice: state.invoices,
    deposit: state.deposits,
    transaction: state.transactions,
  };
  return collections[type]?.find((item) => item.id === id) || null;
}

async function loadAll() {
  setStatus("Loading N3XRA Operations…");
  const queries = await Promise.all([
    supabase.from("operations_parties").select("*").order("name"),
    supabase.from("operations_products").select("*").order("name"),
    supabase.from("operations_projects").select("*").order("updated_at", { ascending: false }),
    supabase.from("operations_financial_accounts").select("*").order("name"),
    supabase.from("operations_invoices").select("*").order("issue_date", { ascending: false }),
    supabase.from("operations_deposits").select("*").order("deposit_date", { ascending: false }),
    supabase.from("operations_transactions").select("*").order("transaction_date", { ascending: false }).order("created_at", { ascending: false }),
    supabase.from("operations_import_batches").select("*").order("created_at", { ascending: false }),
    supabase.from("operations_import_rows").select("*").order("row_number"),
    supabase.from("operations_audit_log").select("*").order("created_at", { ascending: false }).limit(250),
  ]);
  const failed = queries.find((query) => query.error);
  if (failed?.error) throw failed.error;
  [
    state.parties,
    state.products,
    state.projects,
    state.financialAccounts,
    state.invoices,
    state.deposits,
    state.transactions,
    state.importBatches,
    state.importRows,
    state.audit,
  ] = queries.map((query) => query.data || []);

  if (!state.importBatches.some((batch) => batch.id === activeImportBatchId)) {
    activeImportBatchId = state.importBatches[0]?.id || "";
  }

  try {
    const data = await invokeAdmin("list-platform-accounts");
    state.platformAccounts = data.accounts || [];
  } catch {
    state.platformAccounts = [];
  }

  renderAll();
  setStatus("Operations records loaded.", "success");
}

function renderSummary() {
  const summary = summarizeOperations(state);
  $("#ops-bank-balance").textContent = moneyCents(summary.bankBalanceCents);
  $("#ops-outstanding").textContent = moneyCents(summary.outstandingCents);
  $("#ops-month-revenue").textContent = moneyCents(summary.revenueCents);
  $("#ops-month-expenses").textContent = moneyCents(summary.expenseCents);
  $("#ops-net-profit").textContent = moneyCents(summary.netProfitCents);
  $("#ops-activity-count").textContent = `${summary.activeCustomers} / ${summary.activeProjects}`;
  $("#ops-bank-balance-note").textContent = state.financialAccounts.some((item) => item.status === "active" && item.account_type !== "credit" && item.current_balance_cents !== null)
    ? "Latest cash and bank balances"
    : "No confirmed account balances";
  $("#ops-summary-month").textContent = new Date().toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

function renderRecentTransactions() {
  const active = state.transactions.filter((item) => item.status !== "void").slice(0, 6);
  $("#ops-recent-transactions").innerHTML = active.length
    ? active.map((item) => `<div class="operations-list-item"><div><strong>${escapeHtml(item.description)}</strong><small>${dateLabel(item.transaction_date)} · ${escapeHtml(partyById(item.party_id)?.name || titleCase(item.category || item.payment_method))}</small></div><span class="operations-amount-${item.transaction_type}">${item.transaction_type === "expense" ? "−" : "+"}${moneyCents(item.amount_cents)}</span></div>`).join("")
    : emptyState("No transactions yet", "Record the first revenue or expense when N3XRA is ready.");
}

function renderAttention() {
  const outstanding = state.invoices.filter((invoice) => outstandingInvoiceCents(invoice, state.transactions) > 0);
  const pending = state.transactions.filter((item) => item.status === "pending");
  const unmatchedCash = state.transactions.filter((item) => item.transaction_type === "revenue" && item.status === "completed" && ["cash", "check"].includes(item.payment_method) && !item.deposit_id);
  const unreconciledAccounts = state.financialAccounts.filter((item) => item.status === "active" && item.current_balance_cents === null);
  const checks = [
    [outstanding.length, "Outstanding invoices", `${outstanding.length} invoice${outstanding.length === 1 ? "" : "s"} still have a balance.`],
    [pending.length, "Pending transactions", `${pending.length} transaction${pending.length === 1 ? "" : "s"} need confirmation.`],
    [unmatchedCash.length, "Unmatched cash or checks", `${unmatchedCash.length} receipt${unmatchedCash.length === 1 ? "" : "s"} are not linked to a deposit.`],
    [unreconciledAccounts.length, "Balances not confirmed", `${unreconciledAccounts.length} financial account${unreconciledAccounts.length === 1 ? "" : "s"} need a balance.`],
  ].filter(([count]) => count);
  $("#ops-attention-list").innerHTML = checks.length
    ? checks.map(([, title, copy]) => `<div class="operations-list-item"><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(copy)}</small></div></div>`).join("")
    : emptyState("Nothing needs attention", state.transactions.length ? "Current records are reconciled." : "Checks will appear after records are added.");
}

function renderProductSummary() {
  const rows = state.products.map((product) => {
    const transactions = state.transactions.filter((item) => item.product_id === product.id && item.status === "completed");
    const revenue = transactions.filter((item) => item.transaction_type === "revenue").reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const expenses = transactions.filter((item) => item.transaction_type === "expense").reduce((sum, item) => sum + Number(item.amount_cents), 0);
    return { product, revenue, expenses, net: revenue - expenses };
  }).filter((row) => row.revenue || row.expenses);
  $("#ops-product-summary").innerHTML = rows.length
    ? rows.map((row) => `<tr><td><strong>${escapeHtml(row.product.name)}</strong></td><td>${moneyCents(row.revenue)}</td><td>${moneyCents(row.expenses)}</td><td class="${row.net < 0 ? "operations-amount-expense" : "operations-amount-revenue"}">${moneyCents(row.net)}</td></tr>`).join("")
    : '<tr><td colspan="4">No product-linked transactions yet.</td></tr>';
}

function renderYearOptions() {
  const select = $("#ops-ledger-year");
  const current = select.value;
  const years = [...new Set(state.transactions.map((item) => String(item.transaction_date).slice(0, 4)))].filter(Boolean).sort().reverse();
  select.innerHTML = `<option value="">All years</option>${years.map((year) => `<option value="${escapeHtml(year)}">${escapeHtml(year)}</option>`).join("")}`;
  if (years.includes(current)) select.value = current;
}

function renderLedger() {
  const query = $("#ops-ledger-search").value.trim().toLowerCase();
  const type = $("#ops-ledger-type").value;
  const status = $("#ops-ledger-status").value;
  const year = $("#ops-ledger-year").value;
  const rows = state.transactions.filter((item) => {
    const haystack = [
      item.description, item.category, item.reference_number, item.payment_method,
      partyById(item.party_id)?.name, productById(item.product_id)?.name, projectById(item.project_id)?.name,
    ].join(" ").toLowerCase();
    return (!query || haystack.includes(query))
      && (type === "all" || item.transaction_type === type)
      && (status === "all" || (status === "active" ? item.status !== "void" : item.status === status))
      && (!year || String(item.transaction_date).startsWith(year));
  });
  $("#ops-ledger-table").innerHTML = rows.length
    ? rows.map((item) => `<tr>
      <td>${dateLabel(item.transaction_date)}</td>
      <td>${escapeHtml(titleCase(item.transaction_type))}</td>
      <td><strong>${escapeHtml(item.description)}</strong><small>${escapeHtml(item.category || "Uncategorized")}${item.receipt_path ? ' · <button class="operations-row-action" type="button" data-receipt="' + escapeHtml(item.id) + '">Receipt</button>' : ""}</small></td>
      <td>${escapeHtml(partyById(item.party_id)?.name || "—")}</td>
      <td>${escapeHtml(productById(item.product_id)?.name || "—")}<small>${escapeHtml(projectById(item.project_id)?.name || "")}</small></td>
      <td>${escapeHtml(titleCase(item.payment_method))}</td>
      <td>${statusBadge(item.status)}</td>
      <td class="operations-amount-${item.transaction_type}">${item.transaction_type === "expense" ? "−" : ""}${moneyCents(item.amount_cents)}</td>
      <td>${item.status === "void" ? "" : `<button class="operations-row-action" type="button" data-edit="transaction" data-id="${item.id}">Edit</button> · <button class="operations-row-action" type="button" data-void="${item.id}">Void</button>`}</td>
    </tr>`).join("")
    : '<tr><td colspan="9">No transactions match this view.</td></tr>';
}

function invoicePaidCents(invoice) {
  return state.transactions
    .filter((item) => item.invoice_id === invoice.id && item.transaction_type === "revenue" && item.status === "completed")
    .reduce((sum, item) => sum + Number(item.amount_cents || 0), 0);
}

function renderInvoices() {
  $("#ops-invoice-table").innerHTML = state.invoices.length
    ? state.invoices.map((invoice) => {
      const paid = invoicePaidCents(invoice);
      const outstanding = outstandingInvoiceCents(invoice, state.transactions);
      const source = invoice.source === "stripe" ? " · Stripe sync" : "";
      return `<tr><td><strong>${escapeHtml(invoice.invoice_number)}</strong><small>${escapeHtml(productById(invoice.product_id)?.name || projectById(invoice.project_id)?.name || "")}${source}</small></td><td>${escapeHtml(partyById(invoice.customer_id)?.name || "—")}</td><td>${dateLabel(invoice.issue_date)}</td><td>${dateLabel(invoice.due_date)}</td><td>${statusBadge(invoice.status)}</td><td>${moneyCents(invoice.total_cents)}</td><td>${moneyCents(paid)}</td><td>${moneyCents(outstanding)}</td><td><button class="operations-row-action" type="button" data-edit="invoice" data-id="${invoice.id}">Edit</button></td></tr>`;
    }).join("")
    : '<tr><td colspan="9">No invoices have been created.</td></tr>';
}

function listWithActions(items, renderer, type, emptyTitle, emptyCopy) {
  return items.length
    ? items.map((item) => `<div class="operations-list-item"><div>${renderer(item)}</div><button class="operations-row-action" type="button" data-edit="${type}" data-id="${item.id}">Edit</button></div>`).join("")
    : emptyState(emptyTitle, emptyCopy);
}

function renderDirectory() {
  $("#ops-party-list").innerHTML = listWithActions(
    state.parties,
    (item) => `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(titleCase(item.party_type))} · ${escapeHtml(item.email || "No email")} · ${escapeHtml(titleCase(item.status))}</small>`,
    "party", "No customers or vendors", "Add a party only when there is a real business relationship.",
  );
  $("#ops-product-list").innerHTML = listWithActions(
    state.products,
    (item) => `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.category || "Uncategorized")} · ${escapeHtml(titleCase(item.status))}</small>`,
    "product", "No products or services", "Add N3XRA offerings when you are ready to track profitability.",
  );
  $("#ops-project-list").innerHTML = listWithActions(
    state.projects,
    (item) => `<strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(partyById(item.customer_id)?.name || "No customer")} · ${escapeHtml(productById(item.product_id)?.name || "No product")} · ${escapeHtml(titleCase(item.status))}</small>`,
    "project", "No projects", "Projects can connect customers, products, invoices, revenue, and expenses.",
  );
}

function renderBanking() {
  $("#ops-account-list").innerHTML = listWithActions(
    state.financialAccounts,
    (item) => `<strong>${escapeHtml(item.name)}${item.last_four ? ` ••••${escapeHtml(item.last_four)}` : ""}</strong><small>${escapeHtml(titleCase(item.account_type))} · ${item.current_balance_cents === null ? "Balance not confirmed" : `${moneyCents(item.current_balance_cents)} as of ${dateLabel(item.balance_as_of)}`}</small>`,
    "account", "No financial accounts", "Add only the accounts N3XRA wants to reconcile here.",
  );
  $("#ops-deposit-list").innerHTML = listWithActions(
    state.deposits,
    (item) => `<strong>${moneyCents(item.amount_cents)} · ${dateLabel(item.deposit_date)}</strong><small>${escapeHtml(accountById(item.financial_account_id)?.name || "No account")} · ${escapeHtml(titleCase(item.payment_method))} · ${escapeHtml(titleCase(item.status))}</small>`,
    "deposit", "No deposits", "Deposits will help match cash and checks to a financial account.",
  );
  const cashReceived = state.transactions
    .filter((item) => item.transaction_type === "revenue" && item.status === "completed" && ["cash", "check"].includes(item.payment_method))
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  const matched = state.transactions
    .filter((item) => item.transaction_type === "revenue" && item.status === "completed" && ["cash", "check"].includes(item.payment_method) && item.deposit_id)
    .reduce((sum, item) => sum + Number(item.amount_cents), 0);
  $("#ops-deposit-reconciliation").innerHTML = `<div class="operations-reconciliation"><div><span>Cash and checks received</span><strong>${moneyCents(cashReceived)}</strong></div><div><span>Matched to deposits</span><strong>${moneyCents(matched)}</strong></div><div><span>Unmatched</span><strong>${moneyCents(Math.max(0, cashReceived - matched))}</strong></div></div>`;
}

function importBatch() {
  return state.importBatches.find((batch) => batch.id === activeImportBatchId) || null;
}

function classificationOptions(selected) {
  return ["business", "personal", "mixed", "transfer", "needs_review"]
    .map((value) => `<option value="${value}"${value === selected ? " selected" : ""}>${escapeHtml(titleCase(value))}</option>`)
    .join("");
}

function renderExpenseReview() {
  const accountSelect = $("#ops-import-account");
  const selectedAccount = accountSelect.value;
  accountSelect.innerHTML = `<option value="">Not linked yet</option>${state.financialAccounts
    .filter((account) => account.status === "active")
    .map((account) => `<option value="${escapeHtml(account.id)}">${escapeHtml(account.name)}${account.last_four ? ` ••••${escapeHtml(account.last_four)}` : ""}</option>`)
    .join("")}`;
  if (state.financialAccounts.some((account) => account.id === selectedAccount)) accountSelect.value = selectedAccount;

  const batchSelect = $("#ops-import-batch");
  batchSelect.innerHTML = state.importBatches.length
    ? state.importBatches.map((batch) => `<option value="${escapeHtml(batch.id)}"${batch.id === activeImportBatchId ? " selected" : ""}>${escapeHtml(batch.file_name)} · ${dateLabel(batch.created_at)} · ${escapeHtml(titleCase(batch.status))}</option>`).join("")
    : '<option value="">No batches</option>';

  const batch = importBatch();
  const rows = batch ? state.importRows.filter((row) => row.batch_id === batch.id) : [];
  const proposed = rows
    .filter((row) => row.flow === "debit" && ["business", "mixed", "needs_review"].includes(row.classification))
    .reduce((sum, row) => sum + Number(row.deductible_cents || 0), 0);
  const approved = rows.filter((row) => ["approved", "posted"].includes(row.status));
  const pending = rows.filter((row) => row.status === "pending");
  const duplicates = rows.filter((row) => row.is_duplicate);
  $("#ops-review-count").textContent = String(rows.length);
  $("#ops-review-deductible").textContent = moneyCents(proposed);
  $("#ops-review-approved").textContent = String(approved.length);
  $("#ops-review-pending").textContent = String(pending.length);
  $("#ops-review-duplicates").textContent = String(duplicates.length);

  const locked = batch?.status === "posted";
  $$("[data-import-bulk], [data-import-post]").forEach((button) => { button.disabled = !batch || locked; });
  $("#ops-import-rows").innerHTML = rows.length
    ? rows.map((row) => {
      const approvable = row.flow === "debit"
        && ["business", "mixed"].includes(row.classification)
        && !row.is_duplicate
        && Number(row.deductible_cents) > 0;
      const controlsDisabled = locked || row.status === "posted";
      let decision = "";
      if (row.status === "posted") decision = statusBadge("posted");
      else if (row.status === "approved") decision = `${statusBadge("approved")}<button class="operations-row-action" type="button" data-import-action="reset" data-id="${row.id}">Change</button>`;
      else if (row.status === "excluded") decision = `${statusBadge("excluded")}<button class="operations-row-action" type="button" data-import-action="reset" data-id="${row.id}">Change</button>`;
      else decision = `<button class="operations-row-action" type="button" data-import-action="approve" data-id="${row.id}"${approvable ? "" : " disabled"}>Approve</button><button class="operations-row-action" type="button" data-import-action="exclude" data-id="${row.id}">Exclude</button>`;
      return `<tr data-import-row="${row.id}">
        <td>${dateLabel(row.transaction_date)}</td>
        <td><strong>${escapeHtml(row.description)}</strong><small>${escapeHtml(row.suggestion_reason || "")}${row.is_duplicate ? " · Possible duplicate" : ""}</small></td>
        <td class="${row.flow === "debit" ? "operations-amount-expense" : "operations-amount-revenue"}">${row.flow === "debit" ? "−" : "+"}${moneyCents(row.amount_cents)}</td>
        <td><select data-import-field="classification"${controlsDisabled ? " disabled" : ""}>${classificationOptions(row.classification)}</select><small>${row.confidence}% confidence</small></td>
        <td><input data-import-field="business_use_percent" type="number" min="0" max="100" step="0.01" value="${escapeHtml(row.business_use_percent)}"${controlsDisabled || ["personal", "transfer"].includes(row.classification) ? " disabled" : ""}>%</td>
        <td><input data-import-field="category" type="text" maxlength="120" value="${valueAttribute(row.category)}"${controlsDisabled ? " disabled" : ""}></td>
        <td><strong>${moneyCents(row.deductible_cents)}</strong></td>
        <td class="operations-review-decision">${decision}</td>
      </tr>`;
    }).join("")
    : '<tr><td colspan="8">Upload a CSV or Excel workbook to create a review batch.</td></tr>';
}

function renderAudit() {
  $("#ops-audit-list").innerHTML = state.audit.length
    ? state.audit.map((entry) => {
      const actor = state.platformAccounts.find((account) => account.id === entry.actor_user_id);
      const actorLabel = actor?.email || entry.actor_user_id || "System";
      return `<article class="operations-audit-item"><header><div><strong>${escapeHtml(titleCase(entry.action))} · ${escapeHtml(titleCase(entry.table_name.replace("operations_", "")))}</strong><p>${escapeHtml(actorLabel)} · Record ${escapeHtml(entry.record_id)}</p></div><small>${dateTimeLabel(entry.created_at)}</small></header><details><summary>View recorded snapshot</summary><pre>${escapeHtml(JSON.stringify(entry.snapshot, null, 2))}</pre></details></article>`;
    }).join("")
    : emptyState("No audit events", "The first saved Operations record will create the first audit entry.");
}

function renderAll() {
  renderSummary();
  renderRecentTransactions();
  renderAttention();
  renderProductSummary();
  renderYearOptions();
  renderLedger();
  renderInvoices();
  renderDirectory();
  renderBanking();
  renderExpenseReview();
  renderAudit();
}

function showPanel(name) {
  $$("[data-operations-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.operationsView === name));
  $$("[data-operations-panel]").forEach((panel) => { panel.hidden = panel.dataset.operationsPanel !== name; });
}

function transactionFields(item = {}) {
  const customers = state.parties.filter((party) => party.status === "active");
  const activeProducts = state.products.filter((product) => product.status === "active");
  const activeProjects = state.projects.filter((project) => !["canceled", "archived"].includes(project.status));
  const activeAccounts = state.financialAccounts.filter((account) => account.status === "active");
  const activeDeposits = state.deposits.filter((deposit) => deposit.status !== "void");
  return [
    field("Transaction type", "transaction_type", selectInput("transaction_type", fixedOptions(["revenue", "expense"], item.transaction_type || "revenue"), "required")),
    field("Date", "transaction_date", textInput("transaction_date", item.transaction_date || todayValue(), 'type="date" required')),
    field("Amount", "amount", textInput("amount", item.amount_cents === undefined ? "" : (Number(item.amount_cents) / 100).toFixed(2), 'inputmode="decimal" required placeholder="0.00"')),
    field("Status", "status", selectInput("status", fixedOptions(["pending", "completed"], item.status === "pending" ? "pending" : "completed"), "required")),
    field("Description", "description", textInput("description", item.description, 'maxlength="240" required'), { wide: true }),
    field("Customer or vendor", "party_id", selectInput("party_id", optionList(customers, item.party_id, "Not linked"))),
    field("Product", "product_id", selectInput("product_id", optionList(activeProducts, item.product_id, "Not linked"))),
    field("Project", "project_id", selectInput("project_id", optionList(activeProjects, item.project_id, "Not linked"))),
    field("Invoice", "invoice_id", selectInput("invoice_id", optionList(state.invoices.filter((invoice) => invoice.status !== "void"), item.invoice_id, "Not linked", (invoice) => invoice.invoice_number))),
    field("Financial account", "financial_account_id", selectInput("financial_account_id", optionList(activeAccounts, item.financial_account_id, "Not linked"))),
    field("Deposit", "deposit_id", selectInput("deposit_id", optionList(activeDeposits, item.deposit_id, "Not matched", (deposit) => `${dateLabel(deposit.deposit_date)} · ${moneyCents(deposit.amount_cents)}`))),
    field("Category", "category", `${textInput("category", item.category, 'list="operations-category-options" maxlength="100"')}<datalist id="operations-category-options">${EXPENSE_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}"></option>`).join("")}</datalist>`),
    field("Payment method", "payment_method", selectInput("payment_method", fixedOptions(PAYMENT_METHODS, item.payment_method || "manual"), "required")),
    field("Reference number", "reference_number", textInput("reference_number", item.reference_number, 'maxlength="120"')),
    field("Recurring", "recurring", `<input name="recurring" type="checkbox"${item.recurring ? " checked" : ""}>`, { help: "Marks this as part of recurring operations." }),
    field("Receipt", "receipt_file", '<input name="receipt_file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp">', { help: item.receipt_path ? "A receipt is already attached. Choose a new file to replace it." : "Private PDF or image, up to 10 MB." }),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function invoiceFields(item = {}) {
  const customers = state.parties.filter((party) => party.status === "active" && ["customer", "both"].includes(party.party_type));
  return [
    field("Invoice number", "invoice_number", textInput("invoice_number", item.invoice_number, 'maxlength="80" required')),
    field("Customer", "customer_id", selectInput("customer_id", optionList(customers, item.customer_id, "Choose customer"), "required")),
    field("Project", "project_id", selectInput("project_id", optionList(state.projects, item.project_id, "Not linked"))),
    field("Product", "product_id", selectInput("product_id", optionList(state.products, item.product_id, "Not linked"))),
    field("Issue date", "issue_date", textInput("issue_date", item.issue_date || todayValue(), 'type="date" required')),
    field("Due date", "due_date", textInput("due_date", item.due_date, 'type="date"')),
    field("Invoice total", "total", textInput("total", item.total_cents === undefined ? "" : (Number(item.total_cents) / 100).toFixed(2), 'inputmode="decimal" required placeholder="0.00"')),
    field("Status", "status", selectInput("status", fixedOptions(["draft", "sent", "partial", "paid", "overdue", "void", "uncollectible"], item.status || "draft"), "required")),
    field("Recurring", "recurring", `<input name="recurring" type="checkbox"${item.recurring ? " checked" : ""}>`),
    field("External invoice URL", "external_url", textInput("external_url", item.external_url, 'type="url" maxlength="1000" placeholder="https://"')),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function partyFields(item = {}) {
  const accounts = state.platformAccounts.map((account) => ({
    id: account.id,
    name: `${account.name || account.email} — ${account.email}`,
  }));
  return [
    field("Type", "party_type", selectInput("party_type", fixedOptions(["customer", "vendor", "both"], item.party_type || "customer"), "required")),
    field("Name", "name", textInput("name", item.name, 'maxlength="160" required')),
    field("Email", "email", textInput("email", item.email, 'type="email" maxlength="320"')),
    field("Phone", "phone", textInput("phone", item.phone, 'maxlength="40"')),
    field("N3XRA account", "account_user_id", selectInput("account_user_id", optionList(accounts, item.account_user_id, "Not linked"))),
    field("Status", "status", selectInput("status", fixedOptions(["active", "archived"], item.status || "active"), "required")),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function productFields(item = {}) {
  return [
    field("Name", "name", textInput("name", item.name, 'maxlength="160" required')),
    field("Product code", "product_code", textInput("product_code", item.product_code, 'maxlength="40" pattern="[a-z0-9][a-z0-9_-]{1,39}" placeholder="loan_tracker"')),
    field("Category", "category", textInput("category", item.category, 'maxlength="100"')),
    field("Status", "status", selectInput("status", fixedOptions(["active", "archived"], item.status || "active"), "required")),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function projectFields(item = {}) {
  const customers = state.parties.filter((party) => ["customer", "both"].includes(party.party_type));
  return [
    field("Project name", "name", textInput("name", item.name, 'maxlength="200" required')),
    field("Customer", "customer_id", selectInput("customer_id", optionList(customers, item.customer_id, "Not linked"))),
    field("Product", "product_id", selectInput("product_id", optionList(state.products, item.product_id, "Not linked"))),
    field("Status", "status", selectInput("status", fixedOptions(["planned", "active", "on_hold", "completed", "canceled", "archived"], item.status || "planned"), "required")),
    field("Started", "started_on", textInput("started_on", item.started_on, 'type="date"')),
    field("Completed", "completed_on", textInput("completed_on", item.completed_on, 'type="date"')),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function accountFields(item = {}) {
  return [
    field("Account name", "name", textInput("name", item.name, 'maxlength="160" required')),
    field("Account type", "account_type", selectInput("account_type", fixedOptions(["checking", "savings", "cash", "credit", "payment_processor", "other"], item.account_type || "checking"), "required")),
    field("Institution", "institution_name", textInput("institution_name", item.institution_name, 'maxlength="160"')),
    field("Last four digits", "last_four", textInput("last_four", item.last_four, 'inputmode="numeric" maxlength="4" pattern="[0-9]{4}"')),
    field("Confirmed current balance", "current_balance", textInput("current_balance", item.current_balance_cents === null || item.current_balance_cents === undefined ? "" : (Number(item.current_balance_cents) / 100).toFixed(2), 'inputmode="decimal" placeholder="0.00"')),
    field("Balance as of", "balance_as_of", textInput("balance_as_of", item.balance_as_of, 'type="date"')),
    field("Status", "status", selectInput("status", fixedOptions(["active", "archived"], item.status || "active"), "required")),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function depositFields(item = {}) {
  return [
    field("Deposit date", "deposit_date", textInput("deposit_date", item.deposit_date || todayValue(), 'type="date" required')),
    field("Amount", "amount", textInput("amount", item.amount_cents === undefined ? "" : (Number(item.amount_cents) / 100).toFixed(2), 'inputmode="decimal" required placeholder="0.00"')),
    field("Financial account", "financial_account_id", selectInput("financial_account_id", optionList(state.financialAccounts.filter((account) => account.status === "active"), item.financial_account_id, "Not linked"))),
    field("Method", "payment_method", selectInput("payment_method", fixedOptions(["cash", "check", "stripe", "ach", "paypal", "venmo", "square", "bank_transfer", "manual", "other"], item.payment_method || "cash"), "required")),
    field("Reference number", "reference_number", textInput("reference_number", item.reference_number, 'maxlength="120"')),
    field("Status", "status", selectInput("status", fixedOptions(["pending", "completed", "void"], item.status || "completed"), "required")),
    field("Notes", "notes", textarea("notes", item.notes, 'rows="3" maxlength="2000"'), { wide: true }),
  ].join("");
}

function openForm(type, id = "") {
  activeFormType = type;
  const item = id ? recordFor(type, id) : null;
  const builders = {
    transaction: transactionFields,
    invoice: invoiceFields,
    party: partyFields,
    product: productFields,
    project: projectFields,
    account: accountFields,
    deposit: depositFields,
  };
  const labels = {
    transaction: "transaction",
    invoice: "invoice",
    party: "customer or vendor",
    product: "product or service",
    project: "project",
    account: "financial account",
    deposit: "deposit",
  };
  $("#operations-record-id").value = id;
  $("#operations-dialog-title").textContent = `${item ? "Edit" : "Add"} ${labels[type]}`;
  $("#operations-form-fields").innerHTML = builders[type](item || {});
  $("#operations-form-error").textContent = "";
  $("#operations-save").textContent = item ? "Save changes" : "Save record";
  $("#operations-dialog").showModal();
}

function nullable(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function formPayload(type, form) {
  const data = new FormData(form);
  const common = (keys) => Object.fromEntries(keys.map((key) => [key, nullable(data.get(key))]));
  if (type === "transaction") {
    return {
      ...common(["transaction_type", "transaction_date", "status", "party_id", "product_id", "project_id", "invoice_id", "financial_account_id", "deposit_id", "category", "payment_method", "description", "reference_number", "notes"]),
      amount_cents: toCents(data.get("amount")),
      recurring: data.get("recurring") === "on",
    };
  }
  if (type === "invoice") {
    return {
      ...common(["invoice_number", "customer_id", "project_id", "product_id", "issue_date", "due_date", "status", "external_url", "notes"]),
      total_cents: toCents(data.get("total")),
      recurring: data.get("recurring") === "on",
    };
  }
  if (type === "party") return common(["party_type", "name", "email", "phone", "account_user_id", "status", "notes"]);
  if (type === "product") return common(["name", "product_code", "category", "status", "notes"]);
  if (type === "project") return common(["name", "customer_id", "product_id", "status", "started_on", "completed_on", "notes"]);
  if (type === "account") {
    const payload = common(["name", "account_type", "institution_name", "last_four", "balance_as_of", "status", "notes"]);
    payload.current_balance_cents = nullable(data.get("current_balance")) === null ? null : toCents(data.get("current_balance"));
    if ((payload.current_balance_cents === null) !== (payload.balance_as_of === null)) {
      throw new Error("A confirmed balance and its as-of date must be entered or cleared together.");
    }
    return payload;
  }
  if (type === "deposit") {
    return {
      ...common(["financial_account_id", "deposit_date", "payment_method", "reference_number", "status", "notes"]),
      amount_cents: toCents(data.get("amount")),
    };
  }
  throw new Error("Unknown Operations record type.");
}

async function uploadReceipt(recordId, file) {
  if (!file?.size) return null;
  if (file.size > 10 * 1024 * 1024) throw new Error("Receipts must be 10 MB or smaller.");
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "receipt";
  const path = `${new Date().getFullYear()}/${recordId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from("operations-receipts").upload(path, file, { upsert: false, contentType: file.type });
  if (error) throw error;
  return path;
}

async function saveForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $("#operations-form-error");
  errorBox.textContent = "";
  const button = $("#operations-save");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const id = $("#operations-record-id").value;
    const payload = formPayload(activeFormType, form);
    if (!id) payload.created_by_user_id = session.user.id;
    const table = TABLES[activeFormType];
    const query = id
      ? supabase.from(table).update(payload).eq("id", id)
      : supabase.from(table).insert(payload);
    const { data, error } = await query.select("*").single();
    if (error) throw error;

    if (activeFormType === "transaction") {
      const receipt = new FormData(form).get("receipt_file");
      const receiptPath = await uploadReceipt(data.id, receipt);
      if (receiptPath) {
        const { error: receiptError } = await supabase.from(table).update({ receipt_path: receiptPath }).eq("id", data.id);
        if (receiptError) throw receiptError;
      }
    }

    $("#operations-dialog").close();
    await loadAll();
    setStatus(`${titleCase(activeFormType)} saved.`, "success");
  } catch (error) {
    errorBox.textContent = error.message || "Unable to save this record.";
  } finally {
    button.disabled = false;
    button.textContent = $("#operations-record-id").value ? "Save changes" : "Save record";
  }
}

function openVoidDialog(id) {
  $("#operations-void-id").value = id;
  $("#operations-void-reason").value = "";
  $("#operations-void-error").textContent = "";
  $("#operations-void-dialog").showModal();
}

async function voidTransaction(event) {
  event.preventDefault();
  const id = $("#operations-void-id").value;
  const reason = $("#operations-void-reason").value.trim();
  const errorBox = $("#operations-void-error");
  errorBox.textContent = "";
  try {
    const { error } = await supabase.from("operations_transactions").update({
      status: "void",
      void_reason: reason,
      voided_at: new Date().toISOString(),
      voided_by_user_id: session.user.id,
    }).eq("id", id);
    if (error) throw error;
    $("#operations-void-dialog").close();
    await loadAll();
    setStatus("Transaction voided and retained in the audit history.", "success");
  } catch (error) {
    errorBox.textContent = error.message || "Unable to void this transaction.";
  }
}

async function openReceipt(id) {
  const transaction = state.transactions.find((item) => item.id === id);
  if (!transaction?.receipt_path) return;
  const { data, error } = await supabase.storage.from("operations-receipts").createSignedUrl(transaction.receipt_path, 60);
  if (error) return setStatus(error.message || "Unable to open the receipt.", "error");
  window.open(data.signedUrl, "_blank", "noopener,noreferrer");
}

function csvCell(value) {
  let text = String(value ?? "");
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportData(kind) {
  if (kind === "invoices") {
    downloadCsv(
      `n3xra-invoices-${todayValue()}.csv`,
      ["Invoice", "Customer", "Issue Date", "Due Date", "Status", "Total", "Paid", "Outstanding", "Product", "Project", "Notes"],
      state.invoices.map((invoice) => [
        invoice.invoice_number,
        partyById(invoice.customer_id)?.name,
        invoice.issue_date,
        invoice.due_date,
        invoice.status,
        (Number(invoice.total_cents) / 100).toFixed(2),
        (invoicePaidCents(invoice) / 100).toFixed(2),
        (outstandingInvoiceCents(invoice, state.transactions) / 100).toFixed(2),
        productById(invoice.product_id)?.name,
        projectById(invoice.project_id)?.name,
        invoice.notes,
      ]),
    );
    return;
  }
  downloadCsv(
    `n3xra-operations-ledger-${todayValue()}.csv`,
    ["Date", "Type", "Status", "Description", "Amount", "Party", "Product", "Project", "Invoice", "Category", "Payment Method", "Financial Account", "Deposit", "Recurring", "Reference", "Receipt Path", "Notes"],
    state.transactions.map((item) => [
      item.transaction_date,
      item.transaction_type,
      item.status,
      item.description,
      (Number(item.amount_cents) / 100).toFixed(2),
      partyById(item.party_id)?.name,
      productById(item.product_id)?.name,
      projectById(item.project_id)?.name,
      invoiceById(item.invoice_id)?.invoice_number,
      item.category,
      item.payment_method,
      accountById(item.financial_account_id)?.name,
      depositById(item.deposit_id)?.reference_number || item.deposit_id,
      item.recurring ? "Yes" : "No",
      item.reference_number,
      item.receipt_path,
      item.notes,
    ]),
  );
}

function looksLikeTransactionSheet(rows) {
  const headers = (rows[0] || []).map(normalizeHeader);
  const hasDate = headers.some((header) => ["date", "transaction date", "posted date", "posting date"].includes(header));
  const hasDescription = headers.some((header) => ["description", "merchant", "name", "memo", "details", "transaction"].includes(header));
  const hasAmount = headers.some((header) => ["amount", "transaction amount", "debit", "withdrawal", "credit", "deposit"].includes(header));
  return hasDate && hasDescription && hasAmount;
}

async function readImportFile(file) {
  if (!file || file.size === 0) throw new Error("Choose a CSV or Excel file.");
  if (file.size > 10 * 1024 * 1024) throw new Error("Import files must be 10 MB or smaller.");
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "xls"].includes(extension)) throw new Error("Use a CSV, XLSX, or XLS file.");
  const buffer = await file.arrayBuffer();
  const fileFingerprint = await sha256(buffer);
  let records;

  if (extension === "csv") {
    records = rowsToObjects(parseCsv(new TextDecoder().decode(buffer)));
  } else {
    if (!window.XLSX) throw new Error("The Excel reader did not load. Refresh the page or export the workbook as CSV.");
    const workbook = window.XLSX.read(buffer, { type: "array", cellDates: true });
    const sheetName = workbook.SheetNames.find((name) => {
      const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: false, defval: "" });
      return looksLikeTransactionSheet(rows);
    });
    if (!sheetName) throw new Error("No transaction sheet with date, description, and amount columns was found.");
    const rows = window.XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: false, defval: "" });
    records = rowsToObjects(rows);
  }

  return { extension, fileFingerprint, ...normalizeImportRecords(records) };
}

async function createImportBatch(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $("#ops-import-error");
  const button = $("#ops-import-submit");
  errorBox.textContent = "";
  button.disabled = true;
  button.textContent = "Reading file…";
  let batchId = "";
  try {
    const file = $("#ops-import-file").files[0];
    const parsed = await readImportFile(file);
    const accountId = $("#ops-import-account").value || null;
    const month = $("#ops-import-month").value;
    const knownFingerprints = new Set([
      ...state.importRows.map((row) => row.fingerprint),
      ...state.transactions.filter((row) => row.source === "bank_import").map((row) => row.external_id),
    ].filter(Boolean));
    const batchFingerprints = new Set();
    const normalizedRows = [];
    for (const record of parsed.records) {
      const fingerprint = await sha256([
        accountId || "unlinked",
        record.transactionDate,
        record.flow,
        record.amountCents,
        normalizeHeader(record.description),
      ].join("|"));
      const isDuplicate = knownFingerprints.has(fingerprint) || batchFingerprints.has(fingerprint);
      batchFingerprints.add(fingerprint);
      normalizedRows.push({ ...record, fingerprint, isDuplicate });
    }

    button.textContent = "Creating review…";
    const { data: batch, error: batchError } = await supabase.from("operations_import_batches").insert({
      file_name: file.name,
      file_type: parsed.extension,
      file_fingerprint: parsed.fileFingerprint,
      financial_account_id: accountId,
      statement_month: month ? `${month}-01` : null,
      row_count: normalizedRows.length,
      assumptions: $("#ops-import-assumptions").value.trim() || null,
      created_by_user_id: session.user.id,
    }).select("id").single();
    if (batchError) throw batchError;
    batchId = batch.id;

    const payload = normalizedRows.map((record) => ({
      batch_id: batch.id,
      row_number: record.rowNumber,
      transaction_date: record.transactionDate,
      posted_date: record.postedDate,
      description: record.description,
      amount_cents: record.amountCents,
      flow: record.flow,
      source_category: record.sourceCategory,
      classification: record.classification,
      business_use_percent: record.businessUsePercent,
      category: record.category,
      confidence: record.confidence,
      suggestion_reason: record.suggestionReason,
      fingerprint: record.fingerprint,
      is_duplicate: record.isDuplicate,
      raw_data: record.rawData,
      created_by_user_id: session.user.id,
    }));
    for (let index = 0; index < payload.length; index += 200) {
      const { error } = await supabase.from("operations_import_rows").insert(payload.slice(index, index + 200));
      if (error) throw error;
    }

    activeImportBatchId = batch.id;
    form.reset();
    await loadAll();
    showPanel("expense-review");
    setStatus(`${normalizedRows.length} transactions loaded for review${parsed.errors.length ? `; ${parsed.errors.length} unusable rows were skipped` : ""}.`, "success");
  } catch (error) {
    if (batchId) await supabase.from("operations_import_batches").update({ status: "void" }).eq("id", batchId);
    errorBox.textContent = error.code === "23505"
      ? "This exact file has already been imported."
      : error.message || "Unable to create the review batch.";
  } finally {
    button.disabled = false;
    button.textContent = "Create review batch";
  }
}

async function updateImportField(control) {
  const rowElement = control.closest("[data-import-row]");
  const row = state.importRows.find((item) => item.id === rowElement?.dataset.importRow);
  if (!row || row.status === "posted") return;
  const fieldName = control.dataset.importField;
  const payload = { status: "pending" };
  if (fieldName === "classification") {
    payload.classification = control.value;
    payload.business_use_percent = ["personal", "transfer"].includes(control.value)
      ? 0
      : control.value === "business"
        ? 100
        : control.value === "mixed" && (Number(row.business_use_percent) <= 0 || Number(row.business_use_percent) >= 100)
          ? 50
          : Number(row.business_use_percent);
  } else if (fieldName === "business_use_percent") {
    const percent = Number(control.value);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      setStatus("Business use must be between 0% and 100%.", "error");
      return renderExpenseReview();
    }
    payload.business_use_percent = percent;
  } else if (fieldName === "category") {
    payload.category = control.value.trim() || null;
  }
  const { error } = await supabase.from("operations_import_rows").update(payload).eq("id", row.id);
  if (error) return setStatus(error.message || "Unable to update the review row.", "error");
  await loadAll();
  showPanel("expense-review");
}

async function setImportDecision(id, action) {
  const row = state.importRows.find((item) => item.id === id);
  if (!row || row.status === "posted") return;
  const status = action === "approve" ? "approved" : action === "exclude" ? "excluded" : "pending";
  const { error } = await supabase.from("operations_import_rows").update({ status }).eq("id", id);
  if (error) return setStatus(error.message || "Unable to save the decision.", "error");
  await loadAll();
  showPanel("expense-review");
}

async function bulkImportDecision(action) {
  const batch = importBatch();
  if (!batch || batch.status === "posted") return;
  const rows = state.importRows.filter((row) => row.batch_id === batch.id && row.status === "pending");
  const targets = action === "approve-safe"
    ? rows.filter((row) => row.flow === "debit" && row.classification === "business" && Number(row.confidence) >= 80 && !row.is_duplicate && Number(row.deductible_cents) > 0)
    : rows.filter((row) => ["personal", "transfer"].includes(row.classification) || row.is_duplicate);
  if (!targets.length) return setStatus("No matching review rows were found.", "error");
  const { error } = await supabase.from("operations_import_rows").update({
    status: action === "approve-safe" ? "approved" : "excluded",
  }).in("id", targets.map((row) => row.id));
  if (error) return setStatus(error.message || "Unable to update the review batch.", "error");
  await loadAll();
  showPanel("expense-review");
  setStatus(`${targets.length} review decisions saved.`, "success");
}

async function postImportBatch() {
  const batch = importBatch();
  if (!batch || batch.status === "posted") return;
  const rows = state.importRows.filter((row) => row.batch_id === batch.id);
  const pending = rows.filter((row) => row.status === "pending").length;
  const approved = rows.filter((row) => row.status === "approved");
  if (pending) return setStatus(`${pending} transactions still need an approval or exclusion decision.`, "error");
  if (!approved.length) return setStatus("Approve at least one business expense before posting.", "error");
  const total = approved.reduce((sum, row) => sum + Number(row.deductible_cents || 0), 0);
  if (!window.confirm(`Post ${approved.length} approved expenses totaling ${moneyCents(total)} to the permanent Operations ledger? Posted rows cannot be edited; corrections must be voided.`)) return;
  const button = $("[data-import-post]");
  button.disabled = true;
  button.textContent = "Posting…";
  try {
    const { data, error } = await supabase.rpc("post_operations_import_batch", { target_batch_id: batch.id });
    if (error) throw error;
    await loadAll();
    showPanel("expense-review");
    setStatus(`${data.posted_count} approved expenses totaling ${moneyCents(data.posted_amount_cents)} were posted.`, "success");
  } catch (error) {
    setStatus(error.message || "Unable to post the approved expenses.", "error");
  } finally {
    button.textContent = "Post approved expenses";
  }
}

function handleWorkspaceClick(event) {
  const tab = event.target.closest("[data-operations-view]");
  const panelLink = event.target.closest("[data-open-panel]");
  const create = event.target.closest("[data-create]");
  const edit = event.target.closest("[data-edit]");
  const voidButton = event.target.closest("[data-void]");
  const receipt = event.target.closest("[data-receipt]");
  const exportButton = event.target.closest("[data-export]");
  const importAction = event.target.closest("[data-import-action]");
  const importBulk = event.target.closest("[data-import-bulk]");
  const importPost = event.target.closest("[data-import-post]");
  if (tab) showPanel(tab.dataset.operationsView);
  if (panelLink) showPanel(panelLink.dataset.openPanel);
  if (create) openForm(create.dataset.create);
  if (edit) openForm(edit.dataset.edit, edit.dataset.id);
  if (voidButton) openVoidDialog(voidButton.dataset.void);
  if (receipt) openReceipt(receipt.dataset.receipt);
  if (exportButton) exportData(exportButton.dataset.export);
  if (importAction) setImportDecision(importAction.dataset.id, importAction.dataset.importAction);
  if (importBulk) bulkImportDecision(importBulk.dataset.importBulk);
  if (importPost) postImportBatch();
}

function bindEvents() {
  const workspace = $(".operations-workspace");
  if (!workspace || workspace.dataset.operationsBound === "true") return;
  workspace.dataset.operationsBound = "true";
  workspace.addEventListener("click", handleWorkspaceClick);
  $("#operations-form").addEventListener("submit", saveForm);
  $("#operations-void-form").addEventListener("submit", voidTransaction);
  $("#ops-import-form").addEventListener("submit", createImportBatch);
  $("#ops-import-batch").addEventListener("change", (event) => {
    activeImportBatchId = event.currentTarget.value;
    renderExpenseReview();
  });
  $("#ops-import-rows").addEventListener("change", (event) => {
    if (event.target.matches("[data-import-field]")) updateImportField(event.target);
  });
  $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => $("#operations-dialog").close()));
  $$("[data-close-void]").forEach((button) => button.addEventListener("click", () => $("#operations-void-dialog").close()));
  ["ops-ledger-search", "ops-ledger-type", "ops-ledger-status", "ops-ledger-year"].forEach((id) => {
    $(`#${id}`).addEventListener(id === "ops-ledger-search" ? "input" : "change", renderLedger);
  });
}

export async function startOperations(context) {
  supabase = context.supabase;
  session = context.session;
  invokeAdmin = context.invoke;
  bindEvents();
  await loadAll();
}
