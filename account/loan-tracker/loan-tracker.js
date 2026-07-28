import { createBrowserSupabase, getSessionOrNull, hasConfig } from "/shared/lib/supabase-client.js";
import {
  buildSchedule,
  comparePlans,
  fromCents,
  monthsToWords,
  nextMonthlyDate,
  rebuildPayments,
  summarizeSchedule,
  toCents,
} from "./loan-engine.mjs";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const shortDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const monthDate = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
const ACCOUNT_FIELDS = "id,user_id,name,borrower_name,payment_recipient_name,lender_name,loan_number_last_four,original_balance,amount_financed,current_official_balance,official_balance_date,annual_interest_rate,required_monthly_payment,planned_monthly_payment,private_payment_day,lender_due_day,first_payment_date,calculation_start_date,status,notes,created_at,updated_at";
const FULL_PERMISSIONS = Object.freeze({
  view_payments: true,
  use_calculator: true,
  export_data: true,
  manage_payments: true,
  reveal_loan_number: true,
});
const PERMISSION_LABELS = {
  view_payments: "Payment history",
  use_calculator: "Projections",
  export_data: "Exports",
  manage_payments: "Manage payments",
  reveal_loan_number: "Loan number",
};
const SETTING_LABELS = {
  current_official_balance: "Official current balance",
  official_balance_date: "Official balance effective date",
  planned_monthly_payment: "Planned monthly payment",
  private_payment_day: "Dave’s payment day",
  first_payment_date: "First private payment date",
  notes: "Loan notes",
  original_balance: "Original starting balance",
  amount_financed: "Amount financed",
  annual_interest_rate: "Annual percentage rate",
  required_monthly_payment: "Required monthly payment",
  lender_due_day: "Credit-union due day",
  calculation_start_date: "Calculation start date",
  borrower_name: "Borrower name",
  payment_recipient_name: "Payment recipient",
  lender_name: "Lender",
  loan_number: "Loan number",
};
const MONEY_SETTINGS = new Set(["current_official_balance", "planned_monthly_payment", "original_balance", "amount_financed", "required_monthly_payment"]);
const NUMBER_SETTINGS = new Set([...MONEY_SETTINGS, "annual_interest_rate", "private_payment_day", "lender_due_day"]);
const DATE_SETTINGS = new Set(["official_balance_date", "first_payment_date", "calculation_start_date"]);
let supabase;
let session;
let account;
let payments = [];
let rebuiltPayments = [];
let futureSchedule = [];
let overviewComparison;
let toastTimer;
let access = { isOwner: false, isAdmin: false, permissions: {} };
let invitations = [];
let members = [];
let revealedLoanNumber = "";
let settingsHistory = [];
let pendingSettingsChanges = null;

function money(value) {
  return currency.format(Number(value || 0));
}

function moneyCents(value) {
  return currency.format(Number(value || 0) / 100);
}

function dateLabel(value, monthOnly = false) {
  if (!value) return "—";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return (monthOnly ? monthDate : shortDate).format(date);
}

function ordinal(value) {
  const number = Number(value);
  const remainder = number % 100;
  if (remainder >= 11 && remainder <= 13) return `${number}th`;
  return `${number}${number % 10 === 1 ? "st" : number % 10 === 2 ? "nd" : number % 10 === 3 ? "rd" : "th"}`;
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 3500);
}

function showError(title, message) {
  $("#loading-state").hidden = true;
  $("#app").hidden = true;
  $("#error-state").hidden = false;
  setText("error-title", title);
  setText("error-message", message);
}

function showView(view) {
  const targetButton = $$("[data-view]").find((button) => button.dataset.view === view);
  const valid = Boolean(targetButton && !targetButton.hidden);
  const next = valid ? view : "overview";
  $$("[data-view]").forEach((button) => button.classList.toggle("is-active", button.dataset.view === next));
  $$("[data-panel]").forEach((panel) => { panel.hidden = panel.dataset.panel !== next; });
  const base = `${location.pathname}${location.search}`;
  history.replaceState(null, "", next === "overview" ? base : `${base}#${next}`);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function can(permission) {
  return access.isOwner || access.isAdmin || access.permissions?.[permission] === true;
}

function normalizePermissions(value = {}) {
  return Object.fromEntries(Object.keys(FULL_PERMISSIONS).map((key) => [key, value?.[key] === true]));
}

function permissionSummary(value = {}) {
  const labels = Object.entries(normalizePermissions(value)).filter(([, enabled]) => enabled).map(([key]) => PERMISSION_LABELS[key]);
  return labels.length ? labels : ["Overview only"];
}

function getActivePayments() {
  return rebuiltPayments.filter((payment) => payment.status !== "voided" && payment.applied_to_loan !== false);
}

function projectionAnchor() {
  const active = getActivePayments();
  const latest = active.at(-1);
  const originalCents = toCents(account.original_balance);
  if (account.current_official_balance !== null && account.current_official_balance !== undefined && account.official_balance_date) {
    let nextDate = account.first_payment_date;
    let safety = 0;
    while (nextDate && nextDate <= account.official_balance_date && safety < 1200) {
      nextDate = nextMonthlyDate(nextDate, 1);
      safety += 1;
    }
    return {
      balanceCents: toCents(account.current_official_balance),
      firstPaymentDate: nextDate || account.first_payment_date,
      latest: {
        payment_date: account.official_balance_date,
        official_balance_after_payment: account.current_official_balance,
      },
    };
  }
  return {
    balanceCents: latest ? toCents(latest.ending_balance) : originalCents,
    firstPaymentDate: nextMonthlyDate(account.first_payment_date, active.length),
    latest,
  };
}

function calculateFuture(paymentCents = toCents(account.planned_monthly_payment)) {
  const anchor = projectionAnchor();
  return buildSchedule({
    balanceCents: anchor.balanceCents,
    aprBasisPoints: Math.round(Number(account.annual_interest_rate) * 100),
    paymentCents,
    firstPaymentDate: anchor.firstPaymentDate,
  });
}

function renderOverview() {
  const anchor = projectionAnchor();
  futureSchedule = calculateFuture();
  const summary = summarizeSchedule(futureSchedule);
  overviewComparison = comparePlans({
    balanceCents: anchor.balanceCents,
    aprBasisPoints: Math.round(Number(account.annual_interest_rate) * 100),
    paymentCents: toCents(account.planned_monthly_payment),
    firstPaymentDate: anchor.firstPaymentDate,
  }, toCents(account.required_monthly_payment));
  const latest = anchor.latest;
  const isOfficial = Boolean(latest?.official_balance_after_payment);
  const originalCents = toCents(account.original_balance);
  const paidCents = Math.max(0, originalCents - anchor.balanceCents);
  const progress = originalCents ? Math.min(100, (paidCents / originalCents) * 100) : 0;

  setText("current-balance", moneyCents(anchor.balanceCents));
  setText("balance-kind", isOfficial ? "official" : "estimated");
  setText("balance-as-of", latest ? `${isOfficial ? "Official" : "Estimated"} as of ${dateLabel(latest.payment_date)}` : "Projection starting balance");
  setText("planned-payment", money(account.planned_monthly_payment));
  setText("payment-vs-minimum", `${money(Number(account.planned_monthly_payment) - Number(account.required_monthly_payment))} above minimum`);
  setText("payoff-date", dateLabel(summary.payoffDate, true));
  setText("payoff-duration", monthsToWords(summary.payments));
  setText("months-remaining", String(summary.payments));
  setText("interest-remaining", moneyCents(summary.totalInterestCents));
  setText("time-saved", monthsToWords(overviewComparison.monthsSaved));
  setText("interest-saved", `${moneyCents(overviewComparison.interestSavedCents)} interest saved`);
  setText("required-payment", money(account.required_monthly_payment));
  setText("interest-rate", `${Number(account.annual_interest_rate).toFixed(2)}% APR`);
  setText("progress-label", `${progress.toFixed(progress >= 10 ? 0 : 1)}% of principal paid`);
  setText("principal-paid", `${moneyCents(paidCents)} paid`);
  $("#progress-bar").style.width = `${progress}%`;
  setText("lender-name", account.lender_name || "Loan account");
  setText("private-day-badge", account.private_payment_day ? String(account.private_payment_day).padStart(2, "0") : "—");
  setText("private-day-copy", account.private_payment_day ? `${ordinal(account.private_payment_day)} of each month` : "Not set");
  setText("lender-day-badge", account.lender_due_day ? String(account.lender_due_day).padStart(2, "0") : "—");
  setText("lender-day-copy", account.lender_due_day ? `${ordinal(account.lender_due_day)} of each month` : "Not set");
  setText("private-payment-label", `${account.borrower_name?.split(" ")[0] || "Dave"} pays ${account.payment_recipient_name?.split(" ")[0] || "Brent"}`);

  const recent = [...rebuiltPayments].reverse().slice(0, 4);
  $("#recent-payments").innerHTML = !can("view_payments")
    ? '<p class="empty-copy">Payment history is not included in your access.</p>'
    : recent.length ? recent.map((payment) => `
    <div class="recent-row ${payment.status === "voided" ? "is-voided" : ""}">
      <span>${dateLabel(payment.payment_date).split(" ")[0].slice(0, 3)}</span>
      <p><strong>${payment.status === "voided" ? "Voided payment" : `Payment ${payment.payment_number || ""}`}</strong><small>${dateLabel(payment.payment_date)}${payment.notes ? ` · ${escapeHtml(payment.notes)}` : ""}</small></p>
      <strong>${money(payment.amount)}</strong>
    </div>`).join("") : '<p class="empty-copy">No payments recorded yet. Add the first payment when Dave pays Brent.</p>';
}

function renderCalculator() {
  $("#calc-balance").value = fromCents(projectionAnchor().balanceCents);
  $("#calc-apr").value = Number(account.annual_interest_rate).toFixed(2);
  $("#calc-payment").value = Number(account.planned_monthly_payment).toFixed(2);
  $("#calc-date").value = projectionAnchor().firstPaymentDate;
  $("#quick-minimum-payment").dataset.payment = Number(account.required_monthly_payment).toFixed(2);
  $("#quick-minimum-payment").innerHTML = `Minimum <small>${money(account.required_monthly_payment)}</small>`;
  $("#minimum-plan-payment").innerHTML = `${money(account.required_monthly_payment)} <small>per month</small>`;
  updateCalculator();
}

function updateCalculator() {
  const error = $("#calculator-error");
  error.textContent = "";
  try {
    const balanceCents = toCents($("#calc-balance").value);
    const paymentCents = toCents($("#calc-payment").value);
    const aprBasisPoints = Math.round(Number($("#calc-apr").value) * 100);
    if (balanceCents <= 0 || paymentCents <= 0 || !Number.isFinite(aprBasisPoints) || aprBasisPoints < 0) throw new Error("Use positive balance and payment values.");
    const comparison = comparePlans({
      balanceCents, paymentCents, aprBasisPoints, firstPaymentDate: $("#calc-date").value,
    }, toCents(account.required_monthly_payment));
    const { selected, minimum } = comparison;
    setText("calc-payoff-date", dateLabel(selected.payoffDate, true));
    setText("calc-duration", `${selected.payments} payments · ${monthsToWords(selected.payments)}`);
    setText("calc-interest", moneyCents(selected.totalInterestCents));
    setText("calc-total", moneyCents(selected.totalPaidCents));
    setText("calc-final", moneyCents(selected.finalPaymentCents));
    setText("calc-saved", moneyCents(comparison.interestSavedCents));
    setText("calc-time-saved", monthsToWords(comparison.monthsSaved));
    setText("minimum-payoff", dateLabel(minimum.payoffDate, true));
    setText("minimum-interest", moneyCents(minimum.totalInterestCents));
    setText("minimum-count", String(minimum.payments));
    setText("selected-plan-payment", `${moneyCents(paymentCents)} per month`);
    setText("selected-payoff", dateLabel(selected.payoffDate, true));
    setText("selected-interest", moneyCents(selected.totalInterestCents));
    setText("selected-count", String(selected.payments));
  } catch (caught) {
    error.textContent = caught.message || "Unable to calculate this plan.";
  }
}

function renderPaymentYears() {
  const select = $("#payment-year");
  const selected = select.value;
  const years = [...new Set(rebuiltPayments.map((payment) => String(payment.payment_date).slice(0, 4)))].sort().reverse();
  select.innerHTML = '<option value="">All years</option>' + years.map((year) => `<option value="${year}">${year}</option>`).join("");
  select.value = years.includes(selected) ? selected : "";
}

function renderPayments() {
  renderPaymentYears();
  const year = $("#payment-year").value;
  const filtered = rebuiltPayments.filter((payment) => !year || String(payment.payment_date).startsWith(year));
  $("#payment-table").innerHTML = filtered.length ? filtered.map((payment) => `
    <tr class="${payment.status === "voided" ? "is-voided" : ""}">
      <td>${payment.payment_number || "—"}</td><td>${dateLabel(payment.scheduled_date)}</td><td>${dateLabel(payment.payment_date)}</td>
      <td class="money">${money(payment.amount)}</td><td class="money">${payment.interest_amount === null ? "—" : money(payment.interest_amount)}</td>
      <td class="money">${payment.principal_amount === null ? "—" : money(payment.principal_amount)}</td>
      <td class="money">${payment.ending_balance === null ? "—" : money(payment.ending_balance)}${payment.official_balance_after_payment ? " · official" : ""}</td>
      <td>${escapeHtml(payment.notes || payment.confirmation_number || "—")}</td>
      <td><div class="row-menu">${can("manage_payments") && payment.status !== "voided" ? `<button type="button" data-edit-payment="${payment.id}">Edit</button><button type="button" data-void-payment="${payment.id}">Void</button>` : ""}</div></td>
    </tr>`).join("") : '<tr><td colspan="9">No payments recorded for this period.</td></tr>';
}

function renderSchedule() {
  const summary = summarizeSchedule(futureSchedule);
  setText("schedule-summary", `${summary.payments} payments · ${moneyCents(summary.totalInterestCents)} estimated interest`);
  $("#schedule-table").innerHTML = futureSchedule.map((row) => `
    <tr><td>${row.paymentNumber}</td><td>${dateLabel(row.paymentDate)}</td>
    <td class="money">${moneyCents(row.beginningBalanceCents)}</td><td class="money">${moneyCents(row.paymentCents)}</td>
    <td class="money">${moneyCents(row.interestCents)}</td><td class="money">${moneyCents(row.principalCents)}</td>
    <td class="money">${moneyCents(row.endingBalanceCents)}</td></tr>`).join("");
}

function renderAll() {
  rebuiltPayments = rebuildPayments(account, payments);
  renderOverview();
  renderCalculator();
  renderPayments();
  renderSchedule();
}

async function persistBreakdowns() {
  if (!can("manage_payments")) return;
  const calculated = rebuildPayments(account, payments);
  const writes = calculated.map((payment) => supabase.from("loan_payments").update({
    payment_number: payment.payment_number,
    beginning_balance: payment.beginning_balance,
    interest_amount: payment.interest_amount,
    principal_amount: payment.principal_amount,
    ending_balance: payment.ending_balance,
  }).eq("id", payment.id).eq("loan_account_id", account.id));
  const results = await Promise.all(writes);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  rebuiltPayments = calculated;
}

async function loadPayments() {
  if (!can("view_payments") && !can("manage_payments")) {
    payments = [];
    return;
  }
  const { data, error } = await supabase.from("loan_payments").select("*").eq("loan_account_id", account.id).order("payment_date").order("created_at");
  if (error) throw error;
  payments = data || [];
}

function openPaymentDialog(payment = null) {
  if (!can("manage_payments")) return showToast("You do not have permission to manage payments.");
  $("#payment-form").reset();
  $("#payment-id").value = payment?.id || "";
  $("#payment-dialog-title").textContent = payment ? "Edit payment" : "Add payment";
  $("#payment-date").value = payment?.payment_date || new Date().toISOString().slice(0, 10);
  $("#payment-amount").value = payment ? Number(payment.amount).toFixed(2) : Number(account.planned_monthly_payment).toFixed(2);
  $("#scheduled-date").value = payment?.scheduled_date || "";
  $("#confirmation-number").value = payment?.confirmation_number || "";
  $("#official-balance").value = payment?.official_balance_after_payment ?? "";
  $("#payment-notes").value = payment?.notes || "";
  $("#applied-to-loan").checked = payment?.applied_to_loan !== false;
  $("#payment-error").textContent = "";
  $("#payment-dialog").showModal();
}

async function savePayment() {
  if (!can("manage_payments")) return showToast("You do not have permission to manage payments.");
  const errorBox = $("#payment-error");
  errorBox.textContent = "";
  const id = $("#payment-id").value;
  try {
    const amountCents = toCents($("#payment-amount").value);
    if (amountCents <= 0) throw new Error("Payment amount must be greater than zero.");
    const officialValue = $("#official-balance").value.trim();
    if (officialValue && toCents(officialValue) < 0) throw new Error("Official balance cannot be negative.");
    const payload = {
      loan_account_id: account.id,
      payment_date: $("#payment-date").value,
      scheduled_date: $("#scheduled-date").value || null,
      amount: fromCents(amountCents),
      official_balance_after_payment: officialValue ? fromCents(toCents(officialValue)) : null,
      confirmation_number: $("#confirmation-number").value.trim() || null,
      notes: $("#payment-notes").value.trim() || null,
      applied_to_loan: $("#applied-to-loan").checked,
      status: "completed",
    };
    const query = id
      ? supabase.from("loan_payments").update(payload).eq("id", id).eq("loan_account_id", account.id)
      : supabase.from("loan_payments").insert(payload);
    const { error } = await query;
    if (error) throw error;
    await loadPayments();
    await persistBreakdowns();
    renderAll();
    $("#payment-dialog").close();
    showToast(id ? "Payment updated." : "Payment recorded.");
  } catch (caught) {
    errorBox.textContent = caught.message || "Unable to save this payment.";
  }
}

async function voidPayment(id) {
  if (!can("manage_payments")) return showToast("You do not have permission to manage payments.");
  const payment = payments.find((item) => item.id === id);
  if (!payment || !window.confirm(`Void the ${money(payment.amount)} payment from ${dateLabel(payment.payment_date)}? It will remain in the history.`)) return;
  const { error } = await supabase.from("loan_payments").update({ status: "voided" }).eq("id", id).eq("loan_account_id", account.id);
  if (error) return showToast(error.message || "Unable to void payment.");
  await loadPayments();
  await persistBreakdowns();
  renderAll();
  showToast("Payment voided and retained in history.");
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function download(filename, content, type) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([content], { type }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportCsv(kind) {
  if (!can("export_data")) return showToast("Exports are not included in your access.");
  let headers;
  let rows;
  if (kind === "payments") {
    headers = ["Payment #", "Due Date", "Paid Date", "Amount", "Interest", "Principal", "Remaining Balance", "Status", "Notes"];
    rows = rebuiltPayments.map((p) => [p.payment_number, p.scheduled_date, p.payment_date, p.amount, p.interest_amount, p.principal_amount, p.ending_balance, p.status, p.notes]);
  } else {
    headers = ["Payment #", "Payment Date", "Beginning Balance", "Payment", "Interest", "Principal", "Ending Balance"];
    rows = futureSchedule.map((r) => [r.paymentNumber, r.paymentDate, fromCents(r.beginningBalanceCents), fromCents(r.paymentCents), fromCents(r.interestCents), fromCents(r.principalCents), fromCents(r.endingBalanceCents)]);
  }
  download(`dave-wilson-loan-${kind}.csv`, [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n"), "text/csv;charset=utf-8");
}

function xmlEscape(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function excelCell(value, style = "") {
  const numeric = typeof value === "number";
  return `<Cell${style ? ` ss:StyleID="${style}"` : ""}><Data ss:Type="${numeric ? "Number" : "String"}">${xmlEscape(value)}</Data></Cell>`;
}

function excelDate(value) {
  if (!value) return "";
  return Math.floor((new Date(`${value}T00:00:00Z`).getTime() / 86_400_000) + 25569);
}

function excelSheet(name, headers, rows, types = []) {
  const header = `<Row>${headers.map((value) => excelCell(value, "Header")).join("")}</Row>`;
  const body = rows.map((row) => `<Row>${row.map((value, index) => excelCell(value ?? "", types[index] || "")).join("")}</Row>`).join("");
  return `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${header}${body}</Table><WorksheetOptions xmlns="urn:schemas-microsoft-com:office:excel"><FreezePanes/><FrozenNoSplit/><SplitHorizontal>1</SplitHorizontal><TopRowBottomPane>1</TopRowBottomPane></WorksheetOptions></Worksheet>`;
}

function exportExcel() {
  if (!can("export_data")) return showToast("Exports are not included in your access.");
  const anchor = projectionAnchor();
  const summary = summarizeSchedule(futureSchedule);
  const summaryRows = [
    ["Original balance", Number(account.original_balance), "Currency"], ["Current estimated balance", anchor.balanceCents / 100, "Currency"],
    ["APR", Number(account.annual_interest_rate) / 100, "Percent"], ["Required payment", Number(account.required_monthly_payment), "Currency"],
    ["Planned payment", Number(account.planned_monthly_payment), "Currency"], ["Estimated payoff date", excelDate(summary.payoffDate), "Date"],
    ["Estimated interest", summary.totalInterestCents / 100, "Currency"], ["Time saved (months)", overviewComparison.monthsSaved, ""],
    ["Interest saved", overviewComparison.interestSavedCents / 100, "Currency"],
  ];
  const paymentRows = rebuiltPayments.map((p) => [p.payment_number || "", excelDate(p.payment_date), Number(p.amount), p.interest_amount === null ? "" : Number(p.interest_amount), p.principal_amount === null ? "" : Number(p.principal_amount), p.ending_balance === null ? "" : Number(p.ending_balance), p.status, p.notes || ""]);
  const scheduleRows = futureSchedule.map((r) => [r.paymentNumber, excelDate(r.paymentDate), r.beginningBalanceCents / 100, r.paymentCents / 100, r.interestCents / 100, r.principalCents / 100, r.endingBalanceCents / 100]);
  const summarySheet = `<Worksheet ss:Name="Loan Summary"><Table><Row>${excelCell("Field", "Header")}${excelCell("Value", "Header")}</Row>${summaryRows.map(([label, value, style]) => `<Row>${excelCell(label)}${excelCell(value, style)}</Row>`).join("")}</Table></Worksheet>`;
  const workbook = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Styles><Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#DCEADE" ss:Pattern="Solid"/></Style><Style ss:ID="Currency"><NumberFormat ss:Format="$#,##0.00"/></Style><Style ss:ID="Percent"><NumberFormat ss:Format="0.00%"/></Style><Style ss:ID="Date"><NumberFormat ss:Format="mmm d, yyyy"/></Style></Styles>${excelSheet("Amortization Schedule", ["Payment #", "Payment Date", "Beginning Balance", "Payment", "Interest", "Principal", "Ending Balance"], scheduleRows, ["", "Date", "Currency", "Currency", "Currency", "Currency", "Currency"])}${excelSheet("Payment History", ["Payment #", "Date", "Amount", "Interest", "Principal", "Balance", "Status", "Notes"], paymentRows, ["", "Date", "Currency", "Currency", "Currency", "Currency"])}${summarySheet}</Workbook>`;
  download("dave-wilson-loan-tracker.xls", workbook, "application/vnd.ms-excel");
}

function exportPdf() {
  if (!can("export_data")) return showToast("Exports are not included in your access.");
  const reportFrame = document.createElement("iframe");
  reportFrame.setAttribute("aria-hidden", "true");
  reportFrame.style.cssText = "position:fixed;width:1px;height:1px;right:0;bottom:0;border:0;opacity:0;pointer-events:none";
  document.body.append(reportFrame);
  const reportWindow = reportFrame.contentWindow;
  if (!reportWindow) {
    reportFrame.remove();
    return showToast("Unable to prepare the print preview. Please try again.");
  }
  const summary = summarizeSchedule(futureSchedule);
  const anchor = projectionAnchor();
  const rows = futureSchedule.map((row) => `<tr><td>${row.paymentNumber}</td><td>${escapeHtml(dateLabel(row.paymentDate))}</td><td>${escapeHtml(moneyCents(row.beginningBalanceCents))}</td><td>${escapeHtml(moneyCents(row.paymentCents))}</td><td>${escapeHtml(moneyCents(row.interestCents))}</td><td>${escapeHtml(moneyCents(row.principalCents))}</td><td>${escapeHtml(moneyCents(row.endingBalanceCents))}</td></tr>`).join("");
  reportWindow.document.write(`<!doctype html><html><head><title>N3XRA Loan Tracker - Amortization Schedule</title><style>@page{size:letter portrait;margin:.35in}:root{color-scheme:light;font-family:Arial,Helvetica,sans-serif}body{color:#17211b;margin:0;font-size:8pt}.brand{display:flex;align-items:center;gap:8px;border-bottom:2px solid #1e5c43;padding-bottom:7px;margin-bottom:8px}.brand img{width:22px;height:22px;object-fit:contain}.brand strong{color:#1e5c43;font-size:11pt;letter-spacing:.08em}h1{margin:0;font-size:17pt;letter-spacing:-.03em}h2{margin:10px 0 4px;font-size:10pt;color:#1e5c43}.meta{display:flex;justify-content:space-between;color:#68736c;font-size:7pt;margin-top:2px}.summary{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;margin:9px 0}.card{border:1px solid #dddcd2;border-radius:4px;padding:5px}.card span{display:block;color:#68736c;font-size:5.8pt;text-transform:uppercase;letter-spacing:.04em}.card strong{display:block;margin-top:2px;font-size:8.5pt}table{width:100%;border-collapse:collapse;table-layout:fixed}col:nth-child(1){width:5%}col:nth-child(2){width:15%}col:nth-child(3){width:17%}col:nth-child(4){width:15%}col:nth-child(5){width:15%}col:nth-child(6){width:15%}col:nth-child(7){width:18%}thead{display:table-header-group}tr{break-inside:avoid}th{background:#1e5c43;color:white;text-align:left;font-size:5.8pt;text-transform:uppercase;letter-spacing:.015em}th,td{padding:3.5px 2px;border-bottom:1px solid #dddcd2;white-space:nowrap;overflow:hidden;text-overflow:clip}td:nth-child(n+3),th:nth-child(n+3){text-align:right;font-variant-numeric:tabular-nums}.note{color:#68736c;font-size:6.5pt;margin:0 0 5px}</style></head><body><div class="brand"><img src="${window.location.origin}/assets/n3xra_logo_transparent_small.png" alt="N3XRA"><strong>N3XRA</strong></div><h1>Loan Tracker</h1><div class="meta"><span>${escapeHtml(account.borrower_name || "Dave Wilson")} · ${escapeHtml(account.lender_name || "Vibrant Credit Union")}</span><span>Generated ${escapeHtml(dateLabel(new Date().toISOString()))}</span></div><div class="summary"><div class="card"><span>Current balance</span><strong>${escapeHtml(moneyCents(anchor.balanceCents))}</strong></div><div class="card"><span>Monthly payment</span><strong>${escapeHtml(money(account.planned_monthly_payment))}</strong></div><div class="card"><span>Estimated payoff</span><strong>${escapeHtml(dateLabel(summary.payoffDate, true))}</strong></div><div class="card"><span>Payments remaining</span><strong>${summary.payments}</strong></div><div class="card"><span>Estimated interest</span><strong>${escapeHtml(moneyCents(summary.totalInterestCents))}</strong></div></div><h2>Amortization Schedule</h2><p class="note">Estimated schedule based on the current balance and planned payment. Official lender records take priority.</p><table><colgroup><col><col><col><col><col><col><col></colgroup><thead><tr><th>#</th><th>Payment date</th><th>Beginning balance</th><th>Payment</th><th>Interest</th><th>Principal</th><th>Ending balance</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);
  reportWindow.document.close();
  reportWindow.addEventListener("afterprint", () => reportFrame.remove(), { once: true });
  setTimeout(() => {
    reportWindow.focus();
    reportWindow.print();
  }, 250);
}

async function createDirectPdf() {
  if (!can("export_data")) return showToast("Exports are not included in your access.");
  const button = document.querySelector('[data-export="pdf"]');
  if (button) {
    button.disabled = true;
    button.textContent = "Preparing PDF…";
  }
  try {
    const { PDFDocument, StandardFonts, rgb } = await import("https://esm.sh/pdf-lib@1.17.1");
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const dark = rgb(0.09, 0.13, 0.11);
    const green = rgb(0.12, 0.36, 0.26);
    const muted = rgb(0.39, 0.45, 0.42);
    const line = rgb(0.84, 0.84, 0.79);
    const pageWidth = 612;
    const pageHeight = 792;
    const left = 30;
    const right = pageWidth - 30;
    const rowHeight = 15;
    const columns = [24, 70, 91, 76, 76, 76, 91];
    const labels = ["#", "PAYMENT DATE", "BEGINNING BALANCE", "PAYMENT", "INTEREST", "PRINCIPAL", "ENDING BALANCE"];
    const summary = summarizeSchedule(futureSchedule);
    const anchor = projectionAnchor();
    let page;
    let y;

    const text = (value, x, top, size, font = regular, color = dark, align = "left") => {
      const safe = String(value ?? "");
      const width = font.widthOfTextAtSize(safe, size);
      page.drawText(safe, { x: align === "right" ? x - width : x, y: top - size, size, font, color });
    };
    const header = () => {
      page = pdf.addPage([pageWidth, pageHeight]);
      y = pageHeight - 30;
      text("N3XRA", left, y, 12, bold, green);
      page.drawLine({ start: { x: left, y: y - 20 }, end: { x: right, y: y - 20 }, thickness: 2, color: green });
      y -= 37;
      text("Loan Tracker", left, y, 20, bold);
      text(`${account.borrower_name || "Dave Wilson"} · ${account.lender_name || "Vibrant Credit Union"}`, left, y - 18, 8, regular, muted);
      text(`Generated ${dateLabel(new Date().toISOString())}`, right, y - 18, 8, regular, muted, "right");
      y -= 37;
    };
    const tableHeader = () => {
      let x = left;
      page.drawRectangle({ x: left, y: y - 13, width: right - left, height: 13, color: green });
      labels.forEach((label, index) => {
        text(label, index >= 2 ? x + columns[index] - 3 : x + 3, y - 3, 5.4, bold, rgb(1, 1, 1), index >= 2 ? "right" : "left");
        x += columns[index];
      });
      y -= 13;
    };
    const newPage = (withSummary = false) => {
      header();
      if (withSummary) {
        const cards = [
          ["CURRENT BALANCE", moneyCents(anchor.balanceCents)],
          ["MONTHLY PAYMENT", money(account.planned_monthly_payment)],
          ["ESTIMATED PAYOFF", dateLabel(summary.payoffDate, true)],
          ["PAYMENTS REMAINING", String(summary.payments)],
          ["ESTIMATED INTEREST", moneyCents(summary.totalInterestCents)],
        ];
        const cardWidth = (right - left - 16) / 5;
        cards.forEach(([label, value], index) => {
          const x = left + index * (cardWidth + 4);
          page.drawRectangle({ x, y: y - 35, width: cardWidth, height: 35, borderColor: line, borderWidth: 0.7 });
          text(label, x + 4, y - 6, 5.5, bold, muted);
          text(value, x + 4, y - 19, 8, bold);
        });
        y -= 52;
        text("Amortization Schedule", left, y, 11, bold, green);
        text("Estimated schedule based on the current balance and planned payment.", left, y - 14, 7, regular, muted);
        y -= 28;
      }
      tableHeader();
    };

    newPage(true);
    futureSchedule.forEach((row, index) => {
      if (y - rowHeight < 38) newPage(false);
      const values = [String(row.paymentNumber), dateLabel(row.paymentDate), moneyCents(row.beginningBalanceCents), moneyCents(row.paymentCents), moneyCents(row.interestCents), moneyCents(row.principalCents), moneyCents(row.endingBalanceCents)];
      let x = left;
      values.forEach((value, column) => {
        text(value, column >= 2 ? x + columns[column] - 3 : x + 3, y - 4, 6.2, regular, dark, column >= 2 ? "right" : "left");
        x += columns[column];
      });
      page.drawLine({ start: { x: left, y: y - rowHeight }, end: { x: right, y: y - rowHeight }, thickness: 0.45, color: line });
      y -= rowHeight;
      if (index === futureSchedule.length - 1) text("N3XRA Loan Tracker", left, 24, 6.5, regular, muted);
    });
    const blob = new Blob([await pdf.save()], { type: "application/pdf" });
    download("n3xra-loan-tracker-amortization-schedule.pdf", blob, "application/pdf");
    showToast("PDF downloaded.");
  } catch (error) {
    console.error(error);
    showToast("Unable to create the PDF. Please try again.");
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = "Download PDF";
    }
  }
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createInvitationToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function selectedInvitePermissions() {
  return Object.fromEntries($$("[data-permission]").map((input) => [input.dataset.permission, input.checked]));
}

function setPermissionPreset(name) {
  const presets = {
    view: { view_payments: true, use_calculator: true, export_data: false, manage_payments: false, reveal_loan_number: false },
    helper: { view_payments: true, use_calculator: true, export_data: true, manage_payments: true, reveal_loan_number: false },
  };
  if (presets[name]) {
    $$("[data-permission]").forEach((input) => { input.checked = presets[name][input.dataset.permission]; });
  }
  $$("[data-permission-preset]").forEach((button) => button.classList.toggle("is-active", button.dataset.permissionPreset === name));
}

function memberPermissionEditor(member) {
  return `<details class="member-access-editor">
    <summary>Change access</summary>
    <div>${Object.entries(PERMISSION_LABELS).map(([key, label]) => `<label><input type="checkbox" data-member-permission="${key}" ${member.permissions?.[key] === true ? "checked" : ""}> ${label}</label>`).join("")}</div>
    <button class="button secondary" type="button" data-save-member="${member.id}">Save access</button>
  </details>`;
}

function renderAccessList() {
  const activeMembers = members.filter((member) => member.status === "active");
  const pendingInvitations = invitations.filter((invitation) => invitation.status === "pending");
  const rows = [
    ...activeMembers.map((member) => `<article class="access-person" data-member-row="${member.id}">
      <div class="access-person-head"><p><strong>${escapeHtml(member.display_name || member.invited_email)}</strong><small>${escapeHtml(member.invited_email)}</small></p><span class="access-status">Active</span></div>
      <div class="access-permissions">${permissionSummary(member.permissions).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
      ${memberPermissionEditor(member)}
      <div class="access-actions"><button type="button" data-revoke-member="${member.id}">Revoke access</button></div>
    </article>`),
    ...pendingInvitations.map((invitation) => `<article class="access-person">
      <div class="access-person-head"><p><strong>${escapeHtml(invitation.invited_name || invitation.invited_email)}</strong><small>${escapeHtml(invitation.invited_email)} · expires ${dateLabel(invitation.expires_at)}</small></p><span class="access-status pending">Pending</span></div>
      <div class="access-permissions">${permissionSummary(invitation.permissions).map((label) => `<span>${escapeHtml(label)}</span>`).join("")}</div>
      <div class="access-actions"><button type="button" data-revoke-invitation="${invitation.id}">Cancel invitation</button></div>
    </article>`),
  ];
  $("#access-list").innerHTML = rows.length ? rows.join("") : '<p class="empty-copy">No one else has access.</p>';
}

async function loadAccessContext() {
  if (account.user_id === session.user.id) {
    access = { isOwner: true, isAdmin: false, permissions: { ...FULL_PERMISSIONS } };
    return;
  }
  const { data, error } = await supabase
    .from("loan_members")
    .select("id,permissions,status")
    .eq("loan_account_id", account.id)
    .eq("user_id", session.user.id)
    .eq("status", "active")
    .maybeSingle();
  if (error) throw error;
  access = data
    ? { isOwner: false, isAdmin: false, permissions: normalizePermissions(data.permissions) }
    : { isOwner: false, isAdmin: true, permissions: { ...FULL_PERMISSIONS } };
}

async function loadAccessData() {
  if (!access.isOwner && !access.isAdmin) return;
  const [invitationResult, memberResult] = await Promise.all([
    supabase.from("loan_invitations").select("id,invited_email,invited_name,permissions,status,expires_at,created_at").eq("loan_account_id", account.id).order("created_at", { ascending: false }),
    supabase.from("loan_members").select("id,user_id,invited_email,display_name,permissions,status,created_at").eq("loan_account_id", account.id).order("created_at", { ascending: false }),
  ]);
  if (invitationResult.error) throw invitationResult.error;
  if (memberResult.error) throw memberResult.error;
  invitations = invitationResult.data || [];
  members = memberResult.data || [];
  renderAccessList();
}

function applyAccessUi() {
  const ownerControls = access.isOwner || access.isAdmin;
  $$("[data-access-owner]").forEach((element) => { element.hidden = !ownerControls; });
  $$("[data-settings-owner]").forEach((element) => { element.hidden = !ownerControls; });
  $("#admin-settings-card").hidden = !access.isAdmin;
  $$('[data-view="calculator"],[data-view="schedule"],[data-open-view="schedule"]').forEach((element) => { element.hidden = !can("use_calculator"); });
  $$('[data-view="payments"],[data-open-view="payments"]').forEach((element) => { element.hidden = !can("view_payments"); });
  $$("[data-add-payment]").forEach((element) => { element.hidden = !can("manage_payments"); });
  $$("[data-export]").forEach((element) => { element.hidden = !can("export_data"); });
  $("#reveal-loan").hidden = !can("reveal_loan_number");
  $("#reveal-loan").innerHTML = `••••••${escapeHtml(account.loan_number_last_four || "••••")} <small>Reveal</small>`;
}

function normalizeSettingValue(field, value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  if (NUMBER_SETTINGS.has(field)) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${SETTING_LABELS[field]} must be a valid number.`);
    return number;
  }
  return String(value).trim() || null;
}

function settingDisplay(field, value) {
  if (value === null || value === undefined || value === "") return "Not set";
  if (MONEY_SETTINGS.has(field)) return money(value);
  if (field === "annual_interest_rate") return `${Number(value).toFixed(2)}%`;
  if (field === "private_payment_day" || field === "lender_due_day") return `Day ${value}`;
  if (DATE_SETTINGS.has(field)) return dateLabel(value);
  if (field === "loan_number") {
    const text = String(value);
    return text.startsWith("•") ? text : `••••••${text.slice(-4)}`;
  }
  return String(value);
}

function populateSettingsForm() {
  const values = {
    current_official_balance: account.current_official_balance,
    official_balance_date: account.official_balance_date,
    planned_monthly_payment: account.planned_monthly_payment,
    private_payment_day: account.private_payment_day,
    first_payment_date: account.first_payment_date,
    notes: account.notes,
    original_balance: account.original_balance,
    amount_financed: account.amount_financed,
    annual_interest_rate: account.annual_interest_rate,
    required_monthly_payment: account.required_monthly_payment,
    lender_due_day: account.lender_due_day,
    calculation_start_date: account.calculation_start_date,
    borrower_name: account.borrower_name,
    payment_recipient_name: account.payment_recipient_name,
    lender_name: account.lender_name,
  };
  Object.entries(values).forEach(([field, value]) => {
    const input = $(`[data-setting="${field}"]`);
    if (!input) return;
    input.value = value ?? "";
  });
  $("#settings-loan-number").value = "";
  $("#settings-loan-number").placeholder = `Current: ••••••${account.loan_number_last_four || "••••"} — leave blank to keep`;
  const hasPayments = payments.some((payment) => payment.status === "completed" && payment.applied_to_loan !== false);
  $("#settings-original-balance").disabled = hasPayments;
  $("#settings-first-date").disabled = hasPayments;
  setText("original-balance-help", hasPayments
    ? "Locked because payment history exists. Use an official balance correction."
    : "Editable until the first payment is recorded.");
}

async function loadSettingsHistory() {
  if (!access.isOwner && !access.isAdmin) return;
  const { data, error } = await supabase
    .from("loan_account_changes")
    .select("id,actor_user_id,actor_is_admin,changes,created_at")
    .eq("loan_account_id", account.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  settingsHistory = data || [];
  renderSettingsHistory();
}

function settingsChangeRows(changes, history = false) {
  return Object.entries(changes).map(([field, change]) => {
    const oldValue = settingDisplay(field, change.old);
    const newValue = settingDisplay(field, change.new);
    const className = history ? "settings-history-change" : "settings-review-row";
    return `<div class="${className}">
      <strong>${escapeHtml(SETTING_LABELS[field] || field)}</strong>
      <span class="old-value">${escapeHtml(oldValue)}</span>
      <span class="change-arrow">→</span>
      <span>${escapeHtml(newValue)}</span>
    </div>`;
  }).join("");
}

function renderSettingsHistory() {
  $("#settings-history-list").innerHTML = settingsHistory.length
    ? settingsHistory.map((entry) => `<article class="settings-history-item">
      <div class="settings-history-head">
        <p><strong>${entry.actor_user_id === session.user.id ? "You" : entry.actor_is_admin ? "N3XRA administrator" : "Loan owner"}</strong><small>${entry.actor_is_admin ? "Administrator change" : "Owner change"}</small></p>
        <span class="access-status">${dateLabel(entry.created_at)}</span>
      </div>
      <div class="settings-history-changes">${settingsChangeRows(entry.changes, true)}</div>
    </article>`).join("")
    : '<p class="empty-copy">No loan-setting changes have been recorded.</p>';
}

function collectSettingsChanges() {
  const changes = {};
  $$("[data-setting]").forEach((input) => {
    if (input.disabled || input.closest("[hidden]")) return;
    const field = input.dataset.setting;
    if (field === "loan_number" && !input.value.trim()) return;
    const nextValue = normalizeSettingValue(field, input.value);
    const oldValue = field === "loan_number"
      ? null
      : normalizeSettingValue(field, account[field]);
    if (field === "loan_number" || JSON.stringify(nextValue) !== JSON.stringify(oldValue)) {
      changes[field] = nextValue;
    }
  });
  const resultingOfficialBalance = Object.hasOwn(changes, "current_official_balance")
    ? changes.current_official_balance
    : normalizeSettingValue("current_official_balance", account.current_official_balance);
  const resultingOfficialDate = Object.hasOwn(changes, "official_balance_date")
    ? changes.official_balance_date
    : normalizeSettingValue("official_balance_date", account.official_balance_date);
  if (resultingOfficialBalance === null && account.current_official_balance !== null && account.current_official_balance !== undefined) {
    changes.official_balance_date = null;
  } else if ((resultingOfficialBalance === null) !== (resultingOfficialDate === null)) {
    throw new Error("Official balance and its effective date must be entered or cleared together.");
  }
  return changes;
}

function reviewSettingsChanges() {
  const errorBox = $("#settings-error");
  errorBox.textContent = "";
  try {
    pendingSettingsChanges = collectSettingsChanges();
    if (!Object.keys(pendingSettingsChanges).length) throw new Error("No loan information has changed.");
    const reviewChanges = Object.fromEntries(Object.entries(pendingSettingsChanges).map(([field, value]) => [
      field,
      {
        old: field === "loan_number" ? `••••••${account.loan_number_last_four || "••••"}` : account[field],
        new: value,
      },
    ]));
    $("#settings-review-list").innerHTML = settingsChangeRows(reviewChanges);
    $("#settings-review").hidden = false;
    $("#settings-review").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (caught) {
    errorBox.textContent = caught.message || "Unable to review these changes.";
  }
}

async function saveSettingsChanges() {
  if (!pendingSettingsChanges) return;
  const button = $("#confirm-settings");
  button.disabled = true;
  button.textContent = "Saving…";
  try {
    const { data, error } = await supabase.rpc("update_loan_account_settings", {
      input_loan_account_id: account.id,
      input_changes: pendingSettingsChanges,
    });
    if (error) throw error;
    account = { ...account, ...(data?.account || {}) };
    pendingSettingsChanges = null;
    $("#settings-review").hidden = true;
    await loadSettingsHistory();
    populateSettingsForm();
    applyAccessUi();
    renderAll();
    showToast("Loan settings saved permanently.");
  } catch (caught) {
    $("#settings-error").textContent = caught.message || "Unable to save these settings.";
    $("#settings-review").hidden = true;
  } finally {
    button.disabled = false;
    button.textContent = "Confirm and save permanently";
  }
}

async function createInvitation() {
  const errorBox = $("#invite-error");
  errorBox.textContent = "";
  try {
    const email = $("#invite-email").value.trim().toLowerCase();
    if (!email) throw new Error("Enter the email address the guest will use to sign in.");
    const token = createInvitationToken();
    const payload = {
      loan_account_id: account.id,
      owner_user_id: account.user_id,
      invited_email: email,
      invited_name: $("#invite-name").value.trim() || null,
      token_hash: await sha256Hex(token),
      permissions: selectedInvitePermissions(),
      invited_by: session.user.id,
    };
    const { error } = await supabase.from("loan_invitations").insert(payload);
    if (error) throw error.code === "23505" ? new Error("A pending invitation already exists for this email. Cancel it before creating another.") : error;
    const link = `${location.origin}${location.pathname}?invite=${encodeURIComponent(token)}`;
    $("#invite-link").value = link;
    $("#invite-result").hidden = false;
    $("#invite-email").value = "";
    await loadAccessData();
    showToast("Secure invitation created.");
  } catch (caught) {
    errorBox.textContent = caught.message || "Unable to create this invitation.";
  }
}

async function revokeAccess(kind, id) {
  if (!window.confirm(kind === "member" ? "Revoke this person’s loan access?" : "Cancel this invitation?")) return;
  const table = kind === "member" ? "loan_members" : "loan_invitations";
  const payload = kind === "member" ? { status: "revoked" } : { status: "revoked", revoked_at: new Date().toISOString() };
  const { error } = await supabase.from(table).update(payload).eq("id", id).eq("loan_account_id", account.id);
  if (error) return showToast(error.message || "Unable to revoke access.");
  await loadAccessData();
  showToast(kind === "member" ? "Access revoked." : "Invitation canceled.");
}

async function saveMemberAccess(id, row) {
  const permissions = Object.fromEntries($$("[data-member-permission]", row).map((input) => [input.dataset.memberPermission, input.checked]));
  const { error } = await supabase.from("loan_members").update({ permissions }).eq("id", id).eq("loan_account_id", account.id);
  if (error) return showToast(error.message || "Unable to update access.");
  await loadAccessData();
  showToast("Access updated.");
}

function bindEvents() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$("[data-open-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.openView)));
  $$("[data-add-payment]").forEach((button) => button.addEventListener("click", () => openPaymentDialog()));
  $$(`[data-export]`).forEach((button) => button.addEventListener("click", () => button.dataset.export === "excel" ? exportExcel() : button.dataset.export === "pdf" ? exportPdf() : exportCsv(button.dataset.export)));
  $("#calculator-form").addEventListener("input", updateCalculator);
  $$(".quick-payments button").forEach((button) => button.addEventListener("click", () => {
    $$(".quick-payments button").forEach((item) => item.classList.remove("is-active"));
    button.classList.add("is-active");
    if (button.dataset.payment !== "custom") $("#calc-payment").value = Number(button.dataset.payment).toFixed(2);
    else $("#calc-payment").focus();
    updateCalculator();
  }));
  $("#payment-year").addEventListener("change", renderPayments);
  $("#payment-table").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-edit-payment]");
    const voidButton = event.target.closest("[data-void-payment]");
    if (edit) openPaymentDialog(payments.find((payment) => payment.id === edit.dataset.editPayment));
    if (voidButton) voidPayment(voidButton.dataset.voidPayment);
  });
  $("#payment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.submitter?.value === "cancel") return $("#payment-dialog").close();
    if (!event.currentTarget.reportValidity()) return;
    savePayment();
  });
  $("#reveal-loan").addEventListener("click", async (event) => {
    const revealed = event.currentTarget.dataset.revealed === "true";
    if (!revealed && !revealedLoanNumber) {
      const { data, error } = await supabase.rpc("reveal_loan_number", { input_loan_account_id: account.id });
      if (error) return showToast(error.message || "Unable to reveal the loan number.");
      revealedLoanNumber = data || "";
    }
    event.currentTarget.dataset.revealed = String(!revealed);
    event.currentTarget.innerHTML = revealed ? `••••••${escapeHtml(account.loan_number_last_four || "••••")} <small>Reveal</small>` : `${escapeHtml(revealedLoanNumber || "Not recorded")} <small>Hide</small>`;
  });
  $$("[data-permission-preset]").forEach((button) => button.addEventListener("click", () => setPermissionPreset(button.dataset.permissionPreset)));
  $$("[data-permission]").forEach((input) => input.addEventListener("change", () => setPermissionPreset("custom")));
  $("#invite-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) createInvitation();
  });
  $("#copy-invite").addEventListener("click", async () => {
    await navigator.clipboard.writeText($("#invite-link").value);
    showToast("Invitation link copied.");
  });
  $("#access-list").addEventListener("click", (event) => {
    const memberButton = event.target.closest("[data-revoke-member]");
    const invitationButton = event.target.closest("[data-revoke-invitation]");
    const saveButton = event.target.closest("[data-save-member]");
    if (memberButton) revokeAccess("member", memberButton.dataset.revokeMember);
    if (invitationButton) revokeAccess("invitation", invitationButton.dataset.revokeInvitation);
    if (saveButton) saveMemberAccess(saveButton.dataset.saveMember, saveButton.closest("[data-member-row]"));
  });
  $("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (event.currentTarget.reportValidity()) reviewSettingsChanges();
  });
  $("#cancel-settings").addEventListener("click", () => {
    pendingSettingsChanges = null;
    $("#settings-review").hidden = true;
  });
  $("#confirm-settings").addEventListener("click", saveSettingsChanges);
  $("#sign-out").addEventListener("click", async () => {
    await supabase.auth.signOut({ scope: "local" });
    location.assign("/account/");
  });
}

async function init() {
  if (!hasConfig()) return showError("Configuration missing", "The N3XRA database connection is not configured.");
  supabase = createBrowserSupabase();
  session = await getSessionOrNull(supabase);
  if (!session?.user) {
    location.replace(`/account/?next=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`);
    return;
  }
  const url = new URL(location.href);
  const inviteToken = url.searchParams.get("invite");
  let acceptedLoanId = "";
  if (inviteToken) {
    const { data, error: inviteError } = await supabase.rpc("accept_loan_invitation", { input_token: inviteToken });
    if (inviteError) return showError("Invitation unavailable", inviteError.message || "This invitation could not be accepted.");
    acceptedLoanId = data;
    url.searchParams.delete("invite");
    history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    showToast("Invitation accepted.");
  }
  const requestedUserId = url.searchParams.get("user");
  const targetUserId = requestedUserId || session.user.id;
  let accountQuery = supabase.from("loan_accounts").select(ACCOUNT_FIELDS).eq("status", "active");
  accountQuery = acceptedLoanId ? accountQuery.eq("id", acceptedLoanId) : accountQuery.eq("user_id", targetUserId);
  let { data, error } = await accountQuery.maybeSingle();
  if (error) return showError("Loan data unavailable", error.message || "Unable to load this loan.");
  if (!data && !requestedUserId) {
    const fallback = await supabase
      .from("loan_accounts")
      .select(ACCOUNT_FIELDS)
      .eq("status", "active")
      .order("created_at")
      .limit(2);
    if (fallback.error) return showError("Loan data unavailable", fallback.error.message || "Unable to load this loan.");
    if (fallback.data?.length === 1) {
      [data] = fallback.data;
    }
  }
  if (!data) return showError("No accessible loan tracker", "No active loan is available to this account, or you do not have permission to view it.");
  account = data;
  await loadAccessContext();
  applyAccessUi();
  if (access.isAdmin) {
    $("#admin-view-notice").hidden = false;
    setText("admin-borrower-name", account.borrower_name || "this customer");
  }
  await loadPayments();
  await loadAccessData();
  await loadSettingsHistory();
  rebuiltPayments = rebuildPayments(account, payments);
  populateSettingsForm();
  bindEvents();
  renderAll();
  $("#loading-state").hidden = true;
  $("#app").hidden = false;
  showView(location.hash.slice(1) || "overview");
}

init().catch((error) => showError("Something went wrong", error.message || "Unable to open Loan Tracker."));
