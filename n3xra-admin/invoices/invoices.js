// @ts-expect-error Existing browser module is JavaScript and has no declaration file.
import { getAdminSession } from "../../account/admin/admin-session.js";
const RATES_KEY = "n3xra-invoice-desk-rates-v1";
const INVOICES_KEY = "n3xra-invoice-desk-invoices-v1";
const agencies = ["USDA Forest Service", "DOI", "F&W", "NPS", "ODF"];
const defaultRates = {
    apparatus: {
        "Type 1 Engine": 100, "Type 2 Engine": 80, "Type 3 Engine": 75, "Type 4 Engine": 60,
        "Type 5 Engine": 60, "Type 6 Engine": 50, "Type 7 Engine": 45, "Type 1 WT": 80,
        "Type 2 WT": 65, "Type 3 WT": 45, "Utility Trailer": 20, "Type 1 Command": 100,
        "Type 2 Command": 100, "Type 3 Command": 45, "Ambulance ALS": 55, "Ambulance BLS": 45, "TBD": 0,
    },
    personnel: { "FFT2/FFT1": 20.1, "Apparatus Op": 22.6, "ENGB": 24, "STLD/TFLD": 26.8 },
};
const app = document.querySelector("#invoice-app");
const boot = document.querySelector("#invoice-boot");
const view = (document.body.dataset.invoiceView || "dashboard");
let editorState = null;
const currency = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
const dateLabel = (value) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
const number = (value) => Number(value || 0) || 0;
const id = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] || character);
function readRates() {
    try {
        const stored = JSON.parse(localStorage.getItem(RATES_KEY) || "null");
        return stored?.apparatus && stored?.personnel ? stored : structuredClone(defaultRates);
    }
    catch {
        return structuredClone(defaultRates);
    }
}
function sampleInvoice() {
    const responseAt = "2026-08-30T06:30";
    const releaseAt = "2026-08-31T18:30";
    return {
        id: "demo-north-ridge", incidentNumber: "24-047", incidentName: "North Ridge",
        location: "Lake County, OR", agency: "ODF", responseAt, releaseAt,
        apparatus: [{ id: id(), type: "Type 3 Engine", unit: "E-312", hours: 36, rate: 75, amount: 2700 }],
        personnel: [{ id: id(), type: "ENGB", people: 2, hours: 36, rate: 24, amount: 1728 }],
        miscellaneous: [{ id: id(), type: "Repairs", amount: 185 }], status: "ready", updatedAt: "2026-09-02T16:10:00.000Z",
    };
}
function readInvoices() {
    try {
        const stored = JSON.parse(localStorage.getItem(INVOICES_KEY) || "null");
        return Array.isArray(stored) ? stored : [sampleInvoice()];
    }
    catch {
        return [sampleInvoice()];
    }
}
function writeInvoices(invoices) { localStorage.setItem(INVOICES_KEY, JSON.stringify(invoices)); }
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
function shell(content, title, subtitle) {
    const links = [
        ["dashboard", "/n3xra-admin/invoices/", "Invoices"],
        ["editor", "/n3xra-admin/invoices/new/", "New invoice"],
        ["rates", "/n3xra-admin/invoices/rates/", "Rate library"],
    ];
    return `<div class="invoice-shell">
    <aside class="invoice-sidebar">
      <a class="invoice-brand" href="/n3xra-admin/invoices/"><span class="invoice-brand-mark">N</span><span><strong>N3XRA</strong><small>Invoice Desk</small></span></a>
      <p class="invoice-nav-label">Workspace</p>
      <nav class="invoice-nav" aria-label="Invoice Desk">${links.map(([key, href, label]) => `<a class="${view === key ? "is-current" : ""}" href="${href}">${label}</a>`).join("")}</nav>
      <div class="invoice-sidebar-foot"><strong>Private workspace</strong><span>Platform owner access only</span></div>
    </aside>
    <main class="invoice-main">
      <header class="invoice-topbar"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div><div class="invoice-top-actions"><span class="invoice-admin-chip">Admin demo</span><a class="invoice-button secondary small" href="/account/admin/">Exit product</a></div></header>
      <div class="invoice-content">${content}</div>
    </main>
  </div>`;
}
function dashboard() {
    const invoices = readInvoices();
    const ready = invoices.filter((invoice) => invoice.status === "ready");
    const outstanding = ready.reduce((sum, invoice) => sum + totals(invoice).total, 0);
    const latest = invoices.slice().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const rows = latest.length ? latest.map((invoice) => {
        const total = totals(invoice).total;
        return `<tr><td><strong>${escapeHtml(invoice.incidentName || "Untitled incident")}</strong><small>Incident ${escapeHtml(invoice.incidentNumber || "Not assigned")}</small></td><td>${escapeHtml(invoice.agency || "—")}</td><td>${escapeHtml(invoice.location || "—")}</td><td><span class="invoice-status ${invoice.status}">${invoice.status}</span></td><td><strong>${currency(total)}</strong><small>Updated ${dateLabel(invoice.updatedAt)}</small></td></tr>`;
    }).join("") : `<tr><td colspan="5"><div class="invoice-empty"><strong>No invoices yet</strong><p>Start with an incident and the totals will build themselves.</p><a class="invoice-button" href="/n3xra-admin/invoices/new/">Create invoice</a></div></td></tr>`;
    const content = `<div class="invoice-page-head"><div><p class="invoice-kicker">Operations</p><h2>Incident invoices, without the spreadsheet.</h2><p>Build agency-ready invoices from response details, standard rates, personnel time, and approved expenses.</p></div><a class="invoice-button" href="/n3xra-admin/invoices/new/">+ New invoice</a></div>
    <section class="invoice-stats">
      <article class="invoice-stat"><span>Total invoices</span><strong>${invoices.length}</strong><small>In this browser demo</small></article>
      <article class="invoice-stat"><span>Ready to submit</span><strong>${ready.length}</strong><small>Calculated and reviewed</small></article>
      <article class="invoice-stat"><span>Drafts</span><strong>${invoices.length - ready.length}</strong><small>Still being prepared</small></article>
      <article class="invoice-stat"><span>Invoice value</span><strong>${currency(outstanding)}</strong><small>Ready invoices</small></article>
    </section>
    <section class="invoice-card"><header class="invoice-card-head"><div><h3>Recent invoices</h3><p>All incident billing records in this demo workspace.</p></div><a class="invoice-button ghost small" href="/n3xra-admin/invoices/rates/">Manage rates →</a></header>
      <table class="invoice-table"><thead><tr><th>Incident</th><th>Agency</th><th>Location</th><th>Status</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table></section>`;
    return shell(content, "Invoice Desk", "Fast incident billing for N3XRA administrators");
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
    <label class="field">Rate<input data-key="rate" type="number" min="0" step=".01" value="${line.rate || ""}"></label>
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
    <label class="field">Rate<input data-key="rate" type="number" min="0" step=".01" value="${line.rate || ""}"></label>
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
    const content = `<div class="invoice-page-head"><div><p class="invoice-kicker">New invoice</p><h2>Start with the incident.</h2><p>Response time flows into every line item. Rates remain editable when an agreement requires an exception.</p></div><a class="invoice-button secondary" href="/n3xra-admin/invoices/">Cancel</a></div>
    <div class="editor-layout"><div class="editor-sections">
      <section class="editor-card"><header class="editor-card-head"><div><h3>Incident details</h3><p>The identifying information that appears on the invoice.</p></div><span class="editor-step">01</span></header>
        <div class="field-grid"><label class="field">Incident number<input id="incident-number" placeholder="24-048"></label><label class="field">Incident name<input id="incident-name" placeholder="Incident name"></label><label class="field">Location<input id="incident-location" placeholder="County, state"></label><label class="field">Protection agency<select id="incident-agency"><option value="">Choose agency</option>${agencies.map((agency) => `<option>${agency}</option>`).join("")}</select></label></div></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Response window</h3><p>Elapsed time is calculated automatically.</p></div><span class="editor-step">02</span></header>
        <div class="field-grid four"><label class="field">Response<input id="response-at" type="datetime-local" value="${editorState.responseAt}"></label><label class="field">Release<input id="release-at" type="datetime-local" value="${editorState.releaseAt}"></label><label class="field">Elapsed hours<input id="elapsed-hours" value="${elapsedHours(editorState).toFixed(2)}" readonly></label></div></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Apparatus</h3><p>Add each unit used during the response.</p></div><span class="editor-step">03</span></header><div class="line-items" id="apparatus-lines">${apparatusRows()}</div><button class="invoice-button secondary small add-line" data-add-line="apparatus" type="button">+ Add apparatus</button></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Personnel</h3><p>People × hours × rate calculates each position total.</p></div><span class="editor-step">04</span></header><div class="line-items" id="personnel-lines">${personnelRows()}</div><button class="invoice-button secondary small add-line" data-add-line="personnel" type="button">+ Add personnel</button></section>
      <section class="editor-card"><header class="editor-card-head"><div><h3>Miscellaneous</h3><p>Repairs, replacement equipment, and approved outside costs.</p></div><span class="editor-step">05</span></header><div class="line-items" id="miscellaneous-lines">${miscRows()}</div><button class="invoice-button secondary small add-line" data-add-line="miscellaneous" type="button">+ Add charge</button></section>
    </div><aside class="editor-summary" aria-label="Invoice summary"><div class="summary-head"><span>Live preview</span><h3 id="summary-title">New incident invoice</h3><p id="summary-meta">Add incident details to begin</p></div><div class="summary-body"><div class="summary-row"><span>Elapsed time</span><strong id="summary-hours">${elapsedHours(editorState).toFixed(2)} hours</strong></div><div class="summary-row"><span>Apparatus</span><strong id="summary-apparatus">$0.00</strong></div><div class="summary-row"><span>Personnel</span><strong id="summary-personnel">$0.00</strong></div><div class="summary-row"><span>Miscellaneous</span><strong id="summary-misc">$0.00</strong></div><div class="summary-row total"><span>Invoice total</span><strong id="summary-total">$0.00</strong></div></div><div class="summary-actions"><button class="invoice-button" id="save-ready" type="button">Save as ready</button><button class="invoice-button secondary" id="save-draft" type="button">Save draft</button><button class="invoice-button secondary" id="print-invoice" type="button">Print preview</button></div><p class="summary-note" id="editor-status">This demo saves invoice data in this browser only.</p></aside></div>`;
    return shell(content, "New invoice", "Guided incident billing with automatic totals");
}
function ratesPage() {
    const rates = readRates();
    const rateRows = (map, group) => Object.entries(map).map(([name, rate]) => `<div class="rate-row"><strong>${escapeHtml(name)}</strong><label class="rate-field"><input type="number" min="0" step=".01" value="${rate}" data-rate-group="${group}" data-rate-name="${escapeHtml(name)}" aria-label="${escapeHtml(name)} hourly rate"></label></div>`).join("");
    const content = `<div class="invoice-page-head"><div><p class="invoice-kicker">Rate library</p><h2>One rate source for every invoice.</h2><p>These defaults come from the supplied Bly RFPD workbook. Update a rate here and new invoice lines use it immediately.</p></div><a class="invoice-button secondary" href="/n3xra-admin/invoices/">Back to invoices</a></div>
    <div class="rates-grid"><section class="rate-card"><header class="rate-card-head"><h3>Apparatus rates</h3><p>Hourly rate by equipment type</p></header><div class="rate-list">${rateRows(rates.apparatus, "apparatus")}</div></section><section class="rate-card"><header class="rate-card-head"><h3>Personnel rates</h3><p>Hourly rate by incident position</p></header><div class="rate-list">${rateRows(rates.personnel, "personnel")}</div></section></div>
    <div class="rates-save"><p class="inline-status" id="rates-status"></p><button class="invoice-button secondary" id="reset-rates" type="button">Reset workbook defaults</button><button class="invoice-button" id="save-rates" type="button">Save rates</button></div>`;
    return shell(content, "Rate library", "Controlled defaults for apparatus and personnel");
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
    syncIncident();
    const message = document.querySelector("#editor-status");
    if (status === "ready" && (!editorState.incidentNumber || !editorState.incidentName || !editorState.agency)) {
        if (message)
            message.textContent = "Add the incident number, incident name, and protection agency before marking this ready.";
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
        if (button.id === "print-invoice")
            window.print();
    });
}
function bindRates() {
    document.querySelector("#save-rates")?.addEventListener("click", () => {
        const next = structuredClone(defaultRates);
        document.querySelectorAll("[data-rate-group]").forEach((input) => {
            const group = input.dataset.rateGroup;
            const name = input.dataset.rateName || "";
            if (name)
                next[group][name] = number(input.value);
        });
        localStorage.setItem(RATES_KEY, JSON.stringify(next));
        const status = document.querySelector("#rates-status");
        if (status)
            status.textContent = "Rates saved for new invoices.";
    });
    document.querySelector("#reset-rates")?.addEventListener("click", () => { localStorage.removeItem(RATES_KEY); location.reload(); });
}
async function authorize() {
    if (["localhost", "127.0.0.1"].includes(location.hostname))
        return true;
    const context = await getAdminSession({ redirect: true });
    return context.allowed;
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
    document.body.classList.remove("invoice-loading");
}
void init().catch((error) => {
    if (boot)
        boot.textContent = error instanceof Error ? error.message : "Invoice Desk could not be opened.";
});
