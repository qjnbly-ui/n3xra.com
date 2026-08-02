import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";

const statusScreen = document.getElementById("portal-status");
const codeForm = document.getElementById("partner-code-form");
const codeInput = document.getElementById("partner-code");
const codeStatus = document.getElementById("partner-code-status");
const codeHelp = document.getElementById("partner-code-help");
const codeCheck = document.getElementById("partner-code-check");
const codeSave = document.getElementById("partner-code-save");
let session;
let availableCode = "";

function showShareLink(code) {
  const wrapper = document.getElementById("partner-share-link");
  const input = document.getElementById("partner-share-url");
  if (!wrapper || !input || !code) return;
  input.value = `${window.location.origin}/website-request/?ref=${encodeURIComponent(code)}`;
  wrapper.hidden = false;
}

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(cents, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents || 0) / 100);
}

function date(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "";
}

function title(value = "") {
  return String(value).replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function api(options = {}) {
  const response = await fetch("/api/partner-portal", {
    ...options,
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.error || "Unable to open partner portal."), { status: response.status });
  return payload;
}

function renderHistory(targetId, items, type) {
  const target = document.getElementById(targetId);
  target.innerHTML = items.length ? items.map((item) => type === "referral" ? `
    <div class="partner-history-row"><div><strong>${escapeHtml(item.referred_name)}</strong><small>${escapeHtml(title(item.program))} · ${date(item.created_at)}</small></div><span class="partner-history-value" data-status="${escapeHtml(item.status)}">${escapeHtml(title(item.status))}</span></div>
  ` : `
    <div class="partner-history-row"><div><strong>${escapeHtml(item.description)}</strong><small>${date(item.earned_at || item.created_at)} · ${escapeHtml(title(item.status))}</small></div><span class="partner-history-value" data-status="${escapeHtml(item.status)}">${money(item.amount_cents, item.currency)}</span></div>
  `).join("") : `<div class="partner-history-empty">No ${type === "referral" ? "referrals" : "commission activity"} recorded yet.</div>`;
}

function render(data) {
  document.getElementById("partner-welcome").textContent = `Welcome, ${data.partner.full_name}`;
  const approvedDate = document.getElementById("partner-approved-date");
  if (approvedDate && data.partner.approved_at) {
    approvedDate.dateTime = data.partner.approved_at;
    approvedDate.textContent = `Approved ${date(data.partner.approved_at)}`;
  }
  document.getElementById("referral-count").textContent = new Intl.NumberFormat().format(data.referrals.length);
  const programs = Array.isArray(data.partner.programs) ? data.partner.programs.filter(Boolean) : [];
  if (programs.length) {
    document.getElementById("partner-programs").hidden = false;
    document.getElementById("partner-program-list").innerHTML = programs.map((program) => `<span>${escapeHtml(title(program))}</span>`).join("");
  }
  codeInput.value = data.partner.referral_code || "";
  if (data.partner.referral_code) {
    codeInput.disabled = true;
    codeCheck.hidden = true;
    codeSave.hidden = true;
    codeHelp.textContent = "This is your permanent referral code.";
    codeStatus.textContent = "Your referral code is active and cannot be changed.";
    showShareLink(data.partner.referral_code);
  }
  document.getElementById("balance-pending").textContent = money(data.balances.pending_cents, data.balances.currency);
  document.getElementById("balance-available").textContent = money(data.balances.available_cents, data.balances.currency);
  document.getElementById("balance-paid").textContent = money(data.balances.paid_cents, data.balances.currency);
  renderHistory("partner-referral-history", data.referrals, "referral");
  renderHistory("partner-commission-history", data.commissions, "commission");
}

async function init() {
  if (!hasConfig()) throw new Error("Portal configuration is missing.");
  const supabase = createBrowserSupabase();
  const result = await supabase.auth.getSession();
  session = result.data?.session;
  if (!session) return window.location.replace("/account/?next=%2Fclient-portal%2Fpartners%2F");
  try {
    render(await api());
  } catch (error) {
    if (error.status === 403) return window.location.replace("/account/");
    throw error;
  }
  codeInput.addEventListener("input", () => {
    availableCode = "";
    codeSave.disabled = true;
    codeStatus.textContent = "";
  });
  codeCheck.addEventListener("click", async () => {
    if (!codeInput.reportValidity()) return;
    codeStatus.textContent = "Checking availability…";
    codeCheck.disabled = true;
    try {
      const data = await api({ method: "POST", body: JSON.stringify({ action: "check_referral_code", referral_code: codeInput.value }) });
      codeInput.value = data.referral_code;
      if (!data.available) {
        availableCode = "";
        codeSave.disabled = true;
        codeStatus.textContent = "That referral code is already in use. Please choose another.";
        return;
      }
      availableCode = data.referral_code;
      codeSave.disabled = false;
      codeStatus.textContent = "Available. You can create this code.";
    } catch (error) {
      availableCode = "";
      codeSave.disabled = true;
      codeStatus.textContent = error.message;
    } finally {
      codeCheck.disabled = false;
    }
  });
  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (codeInput.value.trim().toUpperCase() !== availableCode) {
      codeSave.disabled = true;
      codeStatus.textContent = "Check that this code is available first.";
      return;
    }
    codeStatus.textContent = "Creating code…";
    codeSave.disabled = true;
    try {
      const data = await api({ method: "POST", body: JSON.stringify({ action: "set_referral_code", referral_code: codeInput.value }) });
      codeInput.value = data.referral_code;
      codeInput.disabled = true;
      codeCheck.hidden = true;
      codeSave.hidden = true;
      codeHelp.textContent = "This is your permanent referral code.";
      codeStatus.textContent = "Your referral code is active and cannot be changed.";
      showShareLink(data.referral_code);
    } catch (error) {
      codeStatus.textContent = error.message;
      if (!/cannot be changed/i.test(error.message)) codeSave.disabled = false;
    }
  });
  document.getElementById("partner-copy-link")?.addEventListener("click", async () => {
    const input = document.getElementById("partner-share-url");
    const copyStatus = document.getElementById("partner-copy-status");
    try {
      await navigator.clipboard.writeText(input.value);
      copyStatus.textContent = "Referral link copied.";
    } catch {
      input.select();
      copyStatus.textContent = "Select Copy to copy the highlighted link.";
    }
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => { statusScreen.textContent = error.message || "Partner portal could not be opened."; });
