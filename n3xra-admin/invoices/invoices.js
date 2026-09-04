// @ts-expect-error Existing browser module is JavaScript and has no declaration file.
import { getAdminSession } from "../../account/admin/admin-session.js";
const RATES_KEY = "n3xra-invoice-desk-rates-v1";
const INVOICES_KEY = "n3xra-invoice-desk-invoices-v1";
const defaultRates = {
    apparatus: {
        "Type 1 Engine": 100, "Type 2 Engine": 80, "Type 3 Engine": 75, "Type 4 Engine": 60,
        "Type 5 Engine": 60, "Type 6 Engine": 50, "Type 7 Engine": 45, "Type 1 WT": 80,
        "Type 2 WT": 65, "Type 3 WT": 45, "Utility Trailer": 20, "Type 1 Command": 100,
        "Type 2 Command": 100, "Type 3 Command": 45, "Ambulance ALS": 55, "Ambulance BLS": 45, "TBD": 0,
    },
    personnel: { "FFT2/FFT1": 20.1, "Apparatus Op": 22.6, "ENGB": 24, "STLD/TFLD": 26.8 },
    agencies: ["USDA Forest Service", "DOI", "F&W", "NPS", "ODF"],
};
const app = document.querySelector("#invoice-app");
const boot = document.querySelector("#invoice-boot");
const view = (document.body.dataset.invoiceView || "dashboard");
let editorState = null;
let activeUserKey = "local-preview";
let activeSupabase = null;
const currency = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
const dateLabel = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const number = (value) => Number(value || 0) || 0;
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
function readRates() {
    try {
        const stored = JSON.parse(localStorage.getItem(`${RATES_KEY}:${activeUserKey}`) || "null");
        return stored?.apparatus && stored?.personnel ? {
            apparatus: stored.apparatus,
            personnel: stored.personnel,
            agencies: Array.isArray(stored.agencies) ? stored.agencies : [...defaultRates.agencies],
        } : structuredClone(defaultRates);
    }
    catch {
        return structuredClone(defaultRates);
    }
}
function readInvoices() {
    try {
        const stored = JSON.parse(localStorage.getItem(`${INVOICES_KEY}:${activeUserKey}`) || "null");
        return Array.isArray(stored) ? stored : [];
    }
    catch {
        return [];
    }
}
function writeInvoices(invoices) { localStorage.setItem(`${INVOICES_KEY}:${activeUserKey}`, JSON.stringify(invoices)); }
function elapsedHours(invoice) {
    if (!invoice.responseAt || !invoice.releaseAt)
        return 0;
    return Math.max(0, (new Date(invoice.releaseAt).getTime() - new Date(invoice.responseAt).getTime()) / 3_600_000);
}
function totals(invoice) {
    const apparatus = invoice.apparatus.reduce((sum, line) => sum + number(line.amount), 0);
    const personnel = invoice.personnel.reduce((sum, line) => sum + number(line.amount), 0);
    const miscellaneous = invoice.miscellaneous.reduce((sum, line) => sum + number(line.amount), 0);
    return { apparatus, personnel, miscellaneous, total: apparatus + personnel + miscellaneous };
}
function shell(content) {
    const links = [
        ["dashboard", "/n3xra-admin/invoices/", "Invoices"],
        ["editor", "/n3xra-admin/invoices/new/", "New invoice"],
        ["rates", "/n3xra-admin/invoices/rates/", "Rate library"],
    ];
    return `<header class="product-app-header"><div class="product-app-header-inner"><a class="product-app-brand" href="/n3xra-admin/invoices/" aria-label="N3XRA Invoice Desk home"><span class="product-app-logo"><b>N3</b><em>XRA</em></span><i aria-hidden="true"></i><strong>Invoice Desk</strong></a><div class="product-app-actions"><a href="/account/admin/">Dashboard</a><button id="invoice-sign-out" type="button">Sign out</button></div></div></header>
  <div class="invoice-shell">
    <aside class="invoice-sidebar">
      <p class="invoice-nav-label">Workspace</p>
      <nav class="invoice-nav" aria-label="Invoice Desk">${links.map(([key, href, label]) => `<a class="${view === key ? "is-current" : ""}" href="${href}">${label}</a>`).join("")}</nav>
      <div class="invoice-sidebar-foot"><strong>Private workspace</strong><span>Platform owner access only</span></div>
    </aside>
    <main class="invoice-main">
      <div class="invoice-content">${content}</div>
    </main>
  </div>`;
}
function dashboard() {
    const invoices = readInvoices();
    const latest = invoices.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rows = latest.length ? latest.map((invoice) => {
        const total = totals(invoice).total;
        return `<tr><td><strong>${escapeHtml(invoice.incidentName || "Untitled incident")}</strong><small>Incident ${escapeHtml(invoice.incidentNumber || "Not assigned")}</small></td><td>${escapeHtml(invoice.agency || "—")}</td><td>${escapeHtml(invoice.location || "—")}</td><td><span class="invoice-status ${invoice.status}">${invoice.status}</span></td><td><strong>${currency(total)}</strong><small>Updated ${dateLabel(invoice.updatedAt)}</small></td></tr>`;
    }).join("") : `<tr><td colspan="5"><div class="invoice-empty"><strong>No previous invoices</strong><p>Invoices you create while signed in will appear here.</p><a class="invoice-button" href="/n3xra-admin/invoices/new/">Add new invoice</a></div></td></tr>`;
    const content = `<div class="invoice-page-head"><div><p class="invoice-kicker">Invoice Desk</p><h2>Your invoices</h2><p>Only invoices saved by this signed-in administrator are shown.</p></div><a class="invoice-button" href="/n3xra-admin/invoices/new/">+ Add new</a></div>
    <section class="invoice-card"><header class="invoice-card-head"><div><h3>Previous invoices</h3><p>${invoices.length ? `${invoices.length} saved invoice${invoices.length === 1 ? "" : "s"}` : "No saved invoices"}</p></div></header>
      <table class="invoice-table"><thead><tr><th>Incident</th><th>Agency</th><th>Location</th><th>Status</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    return shell(content);
}
function blankInvoice() {
    const now = new Date();
    const later = new Date(now.getTime() + 12 * 3_600_000);
    const local = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    return { id: id(), incidentNumber: "", incidentName: "", location: "", agency: "", responseAt: local(now), releaseAt: local(later), apparatus: [], personnel: [], miscellaneous: [], status: "draft", updatedAt: new Date().toISOString() };
}
function rateOptions(map, selected = "") {
    return `<option value="">Choose a rate</option>${Object.keys(map).map((name) => `<option value="${escapeHtml(name)}" ${name === selected ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}`;
}
function apparatusRows() {
    if (!editorState)
        return "";
    const rates = readRates();
    return editorState.apparatus.map((line) => `<div class="line-item" data-line="apparatus" data-id="${line.id}">
    <label class="field">Apparatus type<select data-key="type">${rateOptions(rates.apparatus, line.type)}</select></label>
    <label class="field">Unit identifier<input data-key="unit" value="${escapeHtml(line.unit)}" placeholder="E-312"></label>
    <label class="field">Hours<input data-key="hours" type="number" min="0" step=".25" value="${line.hours || ""}" readonly></label>
    <label class="field">Rate<input data-key="rate" type="number" min="0" step=".01" value="${line.rate || ""}" readonly></label>
    <div class="line-total" data-line-total>${currency(line.amount)}</div><button class="remove-line" data-remove-line="apparatus" type="button" aria-label="Remove apparatus">×</button>
  </div>`).join("");
}
function personnelRows() {
    if (!editorState)
        return "";
    const rates = readRates();
    return editorState.personnel.map((line) => `<div class="line-item personnel" data-line="personnel" data-id="${line.id}">
    <label class="field">Position<select data-key="type">${rateOptions(rates.personnel, line.type)}</select></label>
    <label class="field">People<input data-key="people" type="number" min="1" step="1" value="${line.people || 1}"></label>
    <label class="field">Hours<input data-key="hours" type="number" min="0" step=".25" value="${line.hours || ""}" readonly></label>
    <label class="field">Rate<input data-key="rate" type="number" min="0" step=".01" value="${line.rate || ""}" readonly></label>
    <div class="line-total" data-line-total>${currency(line.amount)}</div><button class="remove-line" data-remove-line="personnel" type="button" aria-label="Remove person">×</button>
  </div>`).join("");
}
function miscRows() {
    if (!editorState)
        return "";
    return editorState.miscellaneous.map((line) => `<div class="line-item misc" data-line="miscellaneous" data-id="${line.id}">
    <label class="field">Charge type<select data-key="type"><option ${line.type === "Repairs" ? "selected" : ""}>Repairs</option><option ${line.type === "Equipment replacement" ? "selected" : ""}>Equipment replacement</option><option ${line.type === "Other" ? "selected" : ""}>Other</option></select></label>
    <label class="field">Cost<input data-key="amount" type="number" min="0" step=".01" value="${line.amount || ""}"></label><button class="remove-line" data-remove-line="miscellaneous" type="button" aria-label="Remove charge">×</button>
  </div>`).join("");
}
function editor() {
    editorState = blankInvoice();
    const agencies = readRates().agencies;
    const content = `<div class="invoice-page-head"><div><p class="invoice-kicker">New invoice</p><h2>Start with the incident.</h2><p>Elapsed hours are calculated from response to release. Every apparatus and personnel line uses that time and its rate-library price.</p></div><a class="invoice-button secondary" href="/n3xra-admin/invoices/">Cancel</a></div>
    <div class="editor-layout"><div class="editor-sections">
      <section class="editor-card"><header class="editor-card-head"><div><h3>Incident details</h3><p>The identifying information that appears on the invoice.</p></div><span class="editor-step">01</span></header>
        <div class="field-grid"><label class="field">Incident number<input id="incident-number" placeholder="24-048"></label><label class="field">Incident name<input id="incident-name" placeholder="Incident name"></label><label class="field">Location<input id="incident-location" placeholder="County, state"></label><label class="field">Protection agency<select id="incident-agency"><option value="">Choose agency</option>${agencies.map((agency) => `<option>${agency}</option>`).join("")}</select></label></div></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Response window</h3><p>Elapsed time is calculated automatically.</p></div><span class="editor-step">02</span></header>
        <div class="field-grid four"><label class="field">Response<input id="response-at" type="datetime-local" value="${editorState.responseAt}"></label><label class="field">Release<input id="release-at" type="datetime-local" value="${editorState.releaseAt}"></label><label class="field">Elapsed hours<input id="elapsed-hours" value="${elapsedHours(editorState).toFixed(2)}" readonly></label></div></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Apparatus</h3><p>Add each unit used during the response.</p></div><span class="editor-step">03</span></header><div class="line-items" id="apparatus-lines">${apparatusRows()}</div><button class="invoice-button secondary small add-line" data-add-line="apparatus" type="button">+ Add apparatus</button></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Personnel</h3><p>People × hours × rate calculates each position total.</p></div><span class="editor-step">04</span></header><div class="line-items" id="personnel-lines">${personnelRows()}</div><button class="invoice-button secondary small add-line" data-add-line="personnel" type="button">+ Add personnel</button></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Miscellaneous</h3><p>Repairs, replacement equipment, and approved outside costs.</p></div><span class="editor-step">05</span></header><div class="line-items" id="miscellaneous-lines">${miscRows()}</div><button class="invoice-button secondary small add-line" data-add-line="miscellaneous" type="button">+ Add charge</button></section>
    </div><aside class="editor-summary" aria-label="Invoice summary"><div class="summary-head"><span>Live preview</span><h3 id="summary-title">New incident invoice</h3><p id="summary-meta">Add incident details to begin</p></div><div class="summary-body"><div class="summary-row"><span>Elapsed time</span><strong id="summary-hours">${elapsedHours(editorState).toFixed(2)} hours</strong></div><div class="summary-row"><span>Apparatus</span><strong id="summary-apparatus">$0.00</strong></div><div class="summary-row"><span>Personnel</span><strong id="summary-personnel">$0.00</strong></div><div class="summary-row"><span>Miscellaneous</span><strong id="summary-misc">$0.00</strong></div><div class="summary-row total"><span>Invoice total</span><strong id="summary-total">$0.00</strong></div></div><div class="summary-actions"><button class="invoice-button" id="save-ready" type="button">Save as ready</button><button class="invoice-button secondary" id="save-draft" type="button">Save draft</button><button class="invoice-button secondary" id="print-invoice" type="button">Print / Save PDF</button></div><p class="summary-note" id="editor-status">Saved invoices stay private to this signed-in administrator.</p></aside></div><section class="invoice-print-sheet" id="invoice-print-sheet" aria-hidden="true"></section>`;
    return shell(content);
}
function ratesPage() {
    const rates = readRates();
    const rateRows = (map, group) => Object.entries(map).map(([name, rate]) => editableRateRow(group, name, rate)).join("");
    const agencyRows = rates.agencies.map((agency) => editableAgencyRow(agency)).join("");
    const content = `<div class="invoice-page-head"><div><p class="invoice-kicker">Rate library</p><h2>Rates and agencies</h2><p>Edit, add, or remove the options available on new invoices.</p></div><a class="invoice-button secondary" href="/n3xra-admin/invoices/">Back to invoices</a></div>
    <div class="rates-grid"><section class="rate-card apparatus"><header class="rate-card-head"><div><h3>Apparatus rates</h3><p>Hourly rate by equipment type</p></div><button class="invoice-button secondary small" data-add-rate="apparatus" type="button">+ Add</button></header><div class="rate-list" data-rate-list="apparatus">${rateRows(rates.apparatus, "apparatus")}</div></section><section class="rate-card"><header class="rate-card-head"><div><h3>Personnel rates</h3><p>Hourly rate by incident position</p></div><button class="invoice-button secondary small" data-add-rate="personnel" type="button">+ Add</button></header><div class="rate-list" data-rate-list="personnel">${rateRows(rates.personnel, "personnel")}</div></section><section class="rate-card agencies"><header class="rate-card-head"><div><h3>Protection agencies</h3><p>Agencies available on invoices</p></div><button class="invoice-button secondary small" data-add-agency type="button">+ Add</button></header><div class="rate-list" data-agency-list>${agencyRows}</div></section></div>
    <div class="rates-save"><p class="inline-status" id="rates-status"></p><button class="invoice-button secondary" id="reset-rates" type="button">Reset workbook defaults</button><button class="invoice-button" id="save-rates" type="button">Save rates</button></div>`;
    return shell(content);
}
function editableRateRow(group, name = "", rate = 0) {
    return `<div class="rate-row" data-rate-row="${group}"><label class="rate-name"><span>Name</span><input value="${escapeHtml(name)}" data-rate-name placeholder="New ${group === "apparatus" ? "apparatus" : "position"}"></label><label class="rate-field"><span>Hourly rate</span><input type="number" min="0" step=".01" value="${rate || ""}" data-rate-value></label><button class="remove-line" data-delete-rate type="button" aria-label="Delete ${escapeHtml(name || "rate")}">×</button></div>`;
}
function editableAgencyRow(name = "") {
    return `<div class="rate-row agency-row" data-agency-row><label class="rate-name"><span>Agency</span><input value="${escapeHtml(name)}" data-agency-name placeholder="New protection agency"></label><button class="remove-line" data-delete-rate type="button" aria-label="Delete ${escapeHtml(name || "agency")}">×</button></div>`;
}
function addLine(kind) {
    if (!editorState)
        return;
    const hours = elapsedHours(editorState);
    const rates = readRates();
    if (kind === "apparatus") {
        const type = Object.keys(rates.apparatus)[0] || "";
        const rate = rates.apparatus[type] || 0;
        editorState.apparatus.push({ id: id(), type, unit: "", hours, rate, amount: hours * rate });
    }
    else if (kind === "personnel") {
        const type = Object.keys(rates.personnel)[0] || "";
        const rate = rates.personnel[type] || 0;
        editorState.personnel.push({ id: id(), type, people: 1, hours, rate, amount: hours * rate });
    }
    else
        editorState.miscellaneous.push({ id: id(), type: "Repairs", amount: 0 });
    renderLineKind(kind);
    updateSummary();
}
function renderLineKind(kind) {
    const target = document.querySelector(`#${kind}-lines`);
    if (!target)
        return;
    target.innerHTML = kind === "apparatus" ? apparatusRows() : kind === "personnel" ? personnelRows() : miscRows();
}
function syncIncident() {
    if (!editorState)
        return;
    editorState.incidentNumber = (document.querySelector("#incident-number")?.value || "").trim();
    editorState.incidentName = (document.querySelector("#incident-name")?.value || "").trim();
    editorState.location = (document.querySelector("#incident-location")?.value || "").trim();
    editorState.agency = document.querySelector("#incident-agency")?.value || "";
    editorState.responseAt = document.querySelector("#response-at")?.value || "";
    editorState.releaseAt = document.querySelector("#release-at")?.value || "";
}
function printableInvoice(invoice) {
    const summary = totals(invoice);
    const formatDateTime = (value) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
    const apparatusRows = invoice.apparatus.map((line) => `<tr><td>${escapeHtml(line.type)}</td><td>${escapeHtml(line.unit || "—")}</td><td>${line.hours.toFixed(2)}</td><td>${currency(line.rate)}</td><td>${currency(line.amount)}</td></tr>`).join("") || `<tr><td colspan="5">No apparatus charges</td></tr>`;
    const personnelRows = invoice.personnel.map((line) => `<tr><td>${escapeHtml(line.type)}</td><td>${line.people || 1}</td><td>${line.hours.toFixed(2)}</td><td>${currency(line.rate)}</td><td>${currency(line.amount)}</td></tr>`).join("") || `<tr><td colspan="5">No personnel charges</td></tr>`;
    const miscRows = invoice.miscellaneous.map((line) => `<tr><td colspan="4">${escapeHtml(line.type)}</td><td>${currency(line.amount)}</td></tr>`).join("");
    return `<header class="print-head"><div><span>N3XRA</span><strong>Invoice Desk</strong></div><div><small>Incident invoice</small><b>${escapeHtml(invoice.incidentNumber || "Draft")}</b></div></header>
    <section class="print-title"><p>Invoice for</p><h1>${escapeHtml(invoice.incidentName || "Untitled incident")}</h1><span>${escapeHtml(invoice.agency || "Protection agency not selected")}</span></section>
    <dl class="print-details"><div><dt>Location</dt><dd>${escapeHtml(invoice.location || "—")}</dd></div><div><dt>Response</dt><dd>${formatDateTime(invoice.responseAt)}</dd></div><div><dt>Release</dt><dd>${formatDateTime(invoice.releaseAt)}</dd></div><div><dt>Elapsed</dt><dd>${elapsedHours(invoice).toFixed(2)} hours</dd></div></dl>
    <h2>Apparatus</h2><table><thead><tr><th>Type</th><th>Unit</th><th>Hours</th><th>Rate</th><th>Cost</th></tr></thead><tbody>${apparatusRows}</tbody><tfoot><tr><th colspan="4">Apparatus total</th><th>${currency(summary.apparatus)}</th></tr></tfoot></table>
    <h2>Personnel</h2><table><thead><tr><th>Position</th><th>People</th><th>Hours</th><th>Rate</th><th>Cost</th></tr></thead><tbody>${personnelRows}</tbody><tfoot><tr><th colspan="4">Personnel total</th><th>${currency(summary.personnel)}</th></tr></tfoot></table>
    ${miscRows ? `<h2>Miscellaneous</h2><table><tbody>${miscRows}</tbody><tfoot><tr><th colspan="4">Miscellaneous total</th><th>${currency(summary.miscellaneous)}</th></tr></tfoot></table>` : ""}
    <div class="print-total"><span>Invoice total</span><strong>${currency(summary.total)}</strong></div>`;
}
function updateSummary() {
    if (!editorState)
        return;
    syncIncident();
    const hours = elapsedHours(editorState);
    editorState.apparatus.forEach((line) => { line.hours = hours; line.amount = line.hours * line.rate; });
    editorState.personnel.forEach((line) => { line.hours = hours; line.amount = (line.people || 1) * line.hours * line.rate; });
    document.querySelectorAll("[data-line]").forEach((row) => {
        const kind = row.dataset.line;
        const lineId = row.dataset.id;
        if (!lineId || kind === "miscellaneous")
            return;
        const line = kind === "apparatus" ? editorState?.apparatus.find((item) => item.id === lineId) : editorState?.personnel.find((item) => item.id === lineId);
        const hoursInput = row.querySelector('[data-key="hours"]');
        const lineTotal = row.querySelector("[data-line-total]");
        if (hoursInput)
            hoursInput.value = hours ? String(hours) : "";
        if (lineTotal && line)
            lineTotal.textContent = currency(line.amount);
    });
    const summary = totals(editorState);
    const set = (selector, text) => { const element = document.querySelector(selector); if (element)
        element.textContent = text; };
    set("#elapsed-hours", hours.toFixed(2));
    set("#summary-hours", `${hours.toFixed(2)} hours`);
    set("#summary-apparatus", currency(summary.apparatus));
    set("#summary-personnel", currency(summary.personnel));
    set("#summary-misc", currency(summary.miscellaneous));
    set("#summary-total", currency(summary.total));
    set("#summary-title", editorState.incidentName || "New incident invoice");
    set("#summary-meta", [editorState.incidentNumber && `Incident ${editorState.incidentNumber}`, editorState.agency].filter(Boolean).join(" · ") || "Add incident details to begin");
    const printSheet = document.querySelector("#invoice-print-sheet");
    if (printSheet)
        printSheet.innerHTML = printableInvoice(editorState);
}
function handleLineInput(target) {
    if (!editorState)
        return;
    const row = target.closest("[data-line]");
    const kind = row?.dataset.line;
    const lineId = row?.dataset.id;
    const key = target.dataset.key;
    if (!kind || !lineId || !key)
        return;
    if (kind === "miscellaneous") {
        const line = editorState.miscellaneous.find((item) => item.id === lineId);
        if (!line)
            return;
        if (key === "type")
            line.type = target.value;
        if (key === "amount")
            line.amount = number(target.value);
    }
    else {
        const line = editorState[kind].find((item) => item.id === lineId);
        if (!line)
            return;
        if (key === "type")
            line.type = target.value;
        if (key === "type")
            line.rate = readRates()[kind][target.value] || 0;
        if (["hours", "rate", "people"].includes(key))
            line[key] = number(target.value);
        if (key === "unit" && kind === "apparatus")
            line.unit = target.value;
        line.amount = kind === "apparatus" ? line.hours * line.rate : (line.people || 1) * line.hours * line.rate;
        if (key === "type")
            renderLineKind(kind);
        else {
            const total = row?.querySelector("[data-line-total]");
            if (total)
                total.textContent = currency(line.amount);
        }
    }
    updateSummary();
}
function saveInvoice(status) {
    if (!editorState)
        return;
    updateSummary();
    const message = document.querySelector("#editor-status");
    if (status === "ready" && (!editorState.incidentNumber || !editorState.incidentName || !editorState.agency)) {
        if (message)
            message.textContent = "Add the incident number, incident name, and protection agency before marking this ready.";
        return;
    }
    if (status === "ready" && elapsedHours(editorState) <= 0) {
        if (message)
            message.textContent = "Release must be later than response so elapsed hours can be calculated.";
        return;
    }
    editorState.status = status;
    editorState.updatedAt = new Date().toISOString();
    const invoices = readInvoices().filter((invoice) => invoice.id !== editorState?.id);
    invoices.unshift(structuredClone(editorState));
    writeInvoices(invoices);
    if (message)
        message.textContent = status === "ready" ? "Invoice saved and ready to submit." : "Draft saved in this browser.";
}
function bindEditor() {
    document.querySelector(".invoice-content")?.addEventListener("input", (event) => {
        const target = event.target;
        if (target instanceof HTMLInputElement || target instanceof HTMLSelectElement) {
            if (target.closest("[data-line]"))
                handleLineInput(target);
            else
                updateSummary();
        }
    });
    document.querySelector(".invoice-content")?.addEventListener("change", (event) => {
        const target = event.target;
        if (target instanceof HTMLSelectElement && target.closest("[data-line]"))
            handleLineInput(target);
        else
            updateSummary();
    });
    document.querySelector(".invoice-content")?.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || !editorState)
            return;
        const add = button.dataset.addLine;
        const remove = button.dataset.removeLine;
        if (add)
            addLine(add);
        if (remove) {
            const lineId = button.closest("[data-id]")?.dataset.id;
            if (lineId)
                editorState[remove] = editorState[remove].filter((line) => line.id !== lineId);
            renderLineKind(remove);
            updateSummary();
        }
        if (button.id === "save-ready")
            saveInvoice("ready");
        if (button.id === "save-draft")
            saveInvoice("draft");
        if (button.id === "print-invoice") {
            updateSummary();
            window.print();
        }
    });
}
function bindRates() {
    document.querySelector(".invoice-content")?.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button)
            return;
        const group = button.dataset.addRate;
        if (group)
            document.querySelector(`[data-rate-list="${group}"]`)?.insertAdjacentHTML("beforeend", editableRateRow(group));
        if (button.hasAttribute("data-add-agency"))
            document.querySelector("[data-agency-list]")?.insertAdjacentHTML("beforeend", editableAgencyRow());
        if (button.hasAttribute("data-delete-rate"))
            button.closest(".rate-row")?.remove();
    });
    document.querySelector("#save-rates")?.addEventListener("click", () => {
        const next = { apparatus: {}, personnel: {}, agencies: [] };
        document.querySelectorAll("[data-rate-row]").forEach((row) => {
            const group = row.dataset.rateRow;
            const name = (row.querySelector("[data-rate-name]")?.value || "").trim();
            const rate = number(row.querySelector("[data-rate-value]")?.value);
            if (name)
                next[group][name] = rate;
        });
        document.querySelectorAll("[data-agency-name]").forEach((input) => { const name = input.value.trim(); if (name && !next.agencies.includes(name))
            next.agencies.push(name); });
        localStorage.setItem(`${RATES_KEY}:${activeUserKey}`, JSON.stringify(next));
        const status = document.querySelector("#rates-status");
        if (status)
            status.textContent = "Rates and agencies saved.";
    });
    document.querySelector("#reset-rates")?.addEventListener("click", () => { localStorage.removeItem(`${RATES_KEY}:${activeUserKey}`); location.reload(); });
}
async function authorize() {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
        return true;
    const context = await getAdminSession({ redirect: true });
    activeUserKey = String(context.user?.id || "signed-in-admin");
    activeSupabase = context.supabase || null;
    return context.allowed;
}
function bindHeader() {
    document.querySelector("#invoice-sign-out")?.addEventListener("click", async () => {
        await activeSupabase?.auth.signOut();
        location.replace("/account/");
    });
}
async function init() {
    if (!app)
        return;
    if (!await authorize())
        return;
    app.innerHTML = view === "editor" ? editor() : view === "rates" ? ratesPage() : dashboard();
    if (view === "editor")
        bindEditor();
    if (view === "rates")
        bindRates();
    bindHeader();
    if (view === "editor")
        updateSummary();
    document.body.classList.remove("invoice-loading");
}
void init().catch((error) => {
    if (boot)
        boot.textContent = error instanceof Error ? error.message : "Invoice Desk could not be opened.";
});
