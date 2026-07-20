import { createBrowserSupabase, hasConfig } from "/shared/lib/supabase-client.js";

const statusScreen = document.getElementById("portal-status");
const codeForm = document.getElementById("partner-code-form");
const codeInput = document.getElementById("partner-code");
const codeStatus = document.getElementById("partner-code-status");
let session;

function escapeHtml(value = "") {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function money(cents, currency = "USD") {
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(Number(cents || 0) / 100);
}

function date(value) {
  return value ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value)) : "";
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
    <div class="partner-history-row"><div><strong>${escapeHtml(item.referred_name)}</strong><small>${escapeHtml(item.program)} · ${date(item.created_at)}</small></div><span>${escapeHtml(item.status.replaceAll("_", " "))}</span></div>
  ` : `
    <div class="partner-history-row"><div><strong>${escapeHtml(item.description)}</strong><small>${date(item.earned_at || item.created_at)} · ${escapeHtml(item.status)}</small></div><span>${money(item.amount_cents, item.currency)}</span></div>
  `).join("") : `<div class="partner-history-empty">No ${type === "referral" ? "referrals" : "commission activity"} recorded yet.</div>`;
}

function render(data) {
  document.getElementById("partner-welcome").textContent = `Welcome, ${data.partner.full_name}`;
  codeInput.value = data.partner.referral_code || "";
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
  codeForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    codeStatus.textContent = "Saving…";
    try {
      const data = await api({ method: "POST", body: JSON.stringify({ action: "set_referral_code", referral_code: codeInput.value }) });
      codeInput.value = data.referral_code;
      codeStatus.textContent = "Referral code saved.";
    } catch (error) {
      codeStatus.textContent = error.message;
    }
  });
  document.body.classList.remove("portal-loading");
  statusScreen.hidden = true;
}

init().catch((error) => { statusScreen.textContent = error.message || "Partner portal could not be opened."; });
