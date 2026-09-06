const crypto = require("crypto");
const { promisify } = require("util");

const scrypt = promisify(crypto.scrypt);
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function normalizePhone(value) {
  const raw = String(value || "").trim();
  let digits = raw.replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  if (!/^[1-9][0-9]{7,14}$/.test(digits)) return "";
  return `+${digits}`;
}

function validPin(value) {
  return /^[0-9]{4}$/.test(String(value || ""));
}

async function hashPin(pin, salt = crypto.randomBytes(16).toString("hex")) {
  if (!validPin(pin)) throw new Error("Use a four-digit phone PIN.");
  const derived = await scrypt(String(pin), salt, 32);
  return { salt, hash: Buffer.from(derived).toString("hex") };
}

async function matchesPin(pin, salt, expectedHash) {
  if (!validPin(pin) || !salt || !expectedHash) return false;
  const { hash } = await hashPin(pin, salt);
  const actual = Buffer.from(hash, "hex");
  const expected = Buffer.from(String(expectedHash), "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function serviceHeaders(extra = {}) {
  if (!SERVICE_KEY) throw new Error("Supabase service access is not configured.");
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

async function supabaseJson(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: { ...serviceHeaders(), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Supabase request failed."));
  return data;
}

async function authenticatedUser(req) {
  if (!ANON_KEY) throw new Error("Supabase authentication is not configured.");
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  return response.json();
}

async function getCredentialByUser(userId, { includeSecret = false } = {}) {
  const fields = includeSecret
    ? "user_id,phone_e164,pin_salt,pin_hash,failed_attempts,locked_until,last_authenticated_at"
    : "user_id,phone_e164,last_authenticated_at,updated_at";
  const rows = await supabaseJson(`account_phone_credentials?select=${fields}&user_id=eq.${encodeURIComponent(userId)}&limit=1`);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getCallerAccount(phone) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) return null;
  const credentials = await supabaseJson(`account_phone_credentials?select=user_id,phone_e164,pin_salt,pin_hash,failed_attempts,locked_until,last_password_reset_sent_at&phone_e164=eq.${encodeURIComponent(phoneE164)}&limit=1`);
  const credential = Array.isArray(credentials) ? credentials[0] : null;
  if (!credential) return null;
  const profiles = await supabaseJson(`profiles?select=id,full_name,email,account_status&id=eq.${encodeURIComponent(credential.user_id)}&limit=1`);
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || !["active", "trialing"].includes(String(profile.account_status || "active"))) return null;
  return {
    ...credential,
    firstName: String(profile.full_name || "").trim().split(/\s+/)[0] || "",
  };
}

async function sendPasswordResetEmail(caller) {
  if (!caller?.user_id) throw new Error("Caller account is unavailable.");
  if (!ANON_KEY) throw new Error("Supabase authentication is not configured.");
  const lastSentAt = caller.last_password_reset_sent_at
    ? new Date(caller.last_password_reset_sent_at).getTime()
    : 0;
  if (lastSentAt > Date.now() - 10 * 60 * 1000) return { sent: false, reason: "cooldown" };

  const profiles = await supabaseJson(`profiles?select=email&id=eq.${encodeURIComponent(caller.user_id)}&limit=1`);
  const email = String(Array.isArray(profiles) ? profiles[0]?.email || "" : "").trim().toLowerCase();
  if (!email) throw new Error("No recovery email is available for this account.");

  const redirectTo = String(
    process.env.PASSWORD_RESET_REDIRECT_URL || "https://www.n3xra.com/account/?mode=recovery",
  ).trim();
  const response = await fetch(`${SUPABASE_URL}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`, {
    method: "POST",
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.msg || data?.message || data?.error_description || "Unable to send password reset email."));

  caller.last_password_reset_sent_at = new Date().toISOString();
  await supabaseJson(`account_phone_credentials?user_id=eq.${encodeURIComponent(caller.user_id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({ last_password_reset_sent_at: caller.last_password_reset_sent_at }),
  });
  return { sent: true };
}

async function saveCredential(userId, phone, pin) {
  const phoneE164 = normalizePhone(phone);
  if (!phoneE164) throw new Error("Enter a valid phone number including area code.");
  const { salt, hash } = await hashPin(pin);
  const response = await fetch(`${SUPABASE_URL}/rest/v1/account_phone_credentials?on_conflict=user_id`, {
    method: "POST",
    headers: serviceHeaders({
      "Content-Type": "application/json",
      Prefer: "resolution=merge-duplicates,return=representation",
    }),
    body: JSON.stringify({
      user_id: userId,
      phone_e164: phoneE164,
      pin_salt: salt,
      pin_hash: hash,
      failed_attempts: 0,
      locked_until: null,
    }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 409 || String(data?.code) === "23505") {
      throw new Error("That phone number is already connected to another N3XRA account.");
    }
    throw new Error(String(data?.message || data?.error || "Unable to save phone access."));
  }
  return Array.isArray(data) ? data[0] || null : data;
}

async function verifyCallerPin(caller, pin) {
  if (!caller?.user_id) return { ok: false, reason: "unrecognized" };
  // Compare-and-set prevents concurrent calls from overwriting each other's failed attempts.
  for (let retry = 0; retry < 3; retry += 1) {
    const credential = await getCredentialByUser(caller.user_id, { includeSecret: true });
    if (!credential || credential.phone_e164 !== caller.phone_e164) return { ok: false, reason: "unrecognized" };
    if (Date.parse(credential.locked_until || "") > Date.now()) return { ok: false, reason: "locked" };
    const ok = await matchesPin(pin, credential.pin_salt, credential.pin_hash);
    const attempts = Number(credential.failed_attempts || 0);
    const locked = !ok && attempts + 1 >= 5;
    const lockedUntil = locked ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
    const updates = { failed_attempts: ok ? 0 : attempts + 1, locked_until: lockedUntil,
      ...(ok ? { last_authenticated_at: new Date().toISOString() } : {}) };
    const lockFilter = credential.locked_until ? `eq.${encodeURIComponent(credential.locked_until)}` : "is.null";
    const rows = await supabaseJson(`account_phone_credentials?user_id=eq.${encodeURIComponent(caller.user_id)}&failed_attempts=eq.${attempts}&pin_salt=eq.${encodeURIComponent(credential.pin_salt)}&locked_until=${lockFilter}`, {
      method: "PATCH", headers: { "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(updates),
    });
    if (!Array.isArray(rows) || !rows.length) continue;
    Object.assign(caller, updates);
    return ok ? { ok: true } : { ok: false, reason: locked ? "locked" : "invalid" };
  }
  return { ok: false, reason: "locked" };
}

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function relatedRow(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function spokenLabel(value) {
  return String(value || "")
    .replace(/_/g, " ")
    .toLowerCase();
}

function spokenList(items) {
  if (items.length < 2) return items[0] || "";
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function spokenMoney(cents) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents || 0) / 100);
}

function spokenDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function productStatusNeedsAttention(status) {
  return ["past_due", "unpaid", "payment_failed", "suspended"].includes(String(status || "").toLowerCase());
}

function formatBillingOverview(snapshot) {
  const invoices = snapshot.websiteInvoices.filter((invoice) => String(invoice.status || "") === "open");
  const amountDue = invoices.reduce((total, invoice) => total + Math.max(0, Number(invoice.amount_due_cents || 0)), 0);
  const troubledSubscriptions = snapshot.websiteSubscriptions.filter((subscription) => productStatusNeedsAttention(subscription.status));
  const productProblems = [snapshot.music, snapshot.virals, ...snapshot.recordsOrganizations]
    .filter(Boolean)
    .filter((product) => productStatusNeedsAttention(product.account_status));
  const parts = [];
  if (invoices.length) {
    const nextDue = invoices.map((invoice) => invoice.due_at).filter(Boolean).sort()[0];
    parts.push(`You have ${invoices.length} open website invoice${invoices.length === 1 ? "" : "s"} with ${spokenMoney(amountDue)} currently due${nextDue ? `, and the next due date is ${spokenDate(nextDue)}` : ""}.`);
  } else {
    parts.push("I do not see an open website invoice on your account.");
  }
  if (troubledSubscriptions.length || productProblems.length) {
    parts.push("At least one subscription needs billing attention. Open your signed-in billing page to review the exact item and payment options.");
  } else if (snapshot.websiteSubscriptions.length) {
    const active = snapshot.websiteSubscriptions.filter((subscription) => ["active", "trialing"].includes(String(subscription.status || "")));
    if (active.length) parts.push(`Your ${active.length === 1 ? "website service subscription is" : `${active.length} website service subscriptions are`} active or trialing.`);
  }
  if (!invoices.length && !snapshot.websiteSubscriptions.length && !snapshot.music && !snapshot.virals && !snapshot.recordsOrganizations.length) {
    parts.push("I do not see a product subscription connected to this account yet.");
  }
  parts.push("For security, exact invoice documents and payment-method changes remain in your signed-in billing pages.");
  return parts.join(" ");
}

function formatUsageOverview(snapshot) {
  const parts = [];
  if (snapshot.music) {
    const used = Math.max(0, Number(snapshot.music.songs_used || 0));
    const limit = Math.max(0, Number(snapshot.music.monthly_song_limit || 0));
    parts.push(`AI Music has ${Math.max(0, limit - used)} of ${limit} songs remaining in the current period.`);
  }
  if (snapshot.virals) {
    const used = Math.max(0, Number(snapshot.virals.analyses_used || 0));
    const limit = Math.max(0, Number(snapshot.virals.monthly_analysis_limit || 0));
    parts.push(`NEXRA Virals has ${Math.max(0, limit - used)} of ${limit} analyses remaining in the current period.`);
  }
  if (snapshot.recordsOrganizations.length) {
    parts.push("Records plan and storage usage are available in the signed-in Records account page.");
  }
  return parts.length ? parts.join(" ") : "I do not see a usage-based NEXRA product connected to this account yet.";
}

function formatSubscriptionOverview(snapshot) {
  const parts = [];
  snapshot.recordsOrganizations.slice(0, 2).forEach((organization) => {
    const organizationName = snapshot.recordsOrganizations.length > 1 && organization.name ? ` for ${organization.name}` : "";
    parts.push(`Records${organizationName} is ${spokenLabel(organization.account_status || "active")} on the ${spokenLabel(organization.subscription_tier || "free")} plan.`);
  });
  if (snapshot.music) {
    const ending = snapshot.music.cancel_at_period_end ? " and is scheduled to end after the current period" : "";
    parts.push(`AI Music is ${spokenLabel(snapshot.music.account_status || "active")} on the ${spokenLabel(snapshot.music.plan || "free")} plan${ending}.`);
  }
  if (snapshot.virals) {
    const ending = snapshot.virals.cancel_at_period_end ? " and is scheduled to end after the current period" : "";
    parts.push(`NEXRA Virals is ${spokenLabel(snapshot.virals.account_status || "active")} on the ${spokenLabel(snapshot.virals.plan || "free")} plan${ending}.`);
  }
  snapshot.websiteSubscriptions.slice(0, 3).forEach((subscription) => {
    const renewal = spokenDate(subscription.current_period_end);
    const ending = subscription.cancel_at_period_end ? " and is scheduled to cancel at the end of the period" : "";
    parts.push(`Website service is ${spokenLabel(subscription.status)} on the ${spokenLabel(subscription.service_plan)} ${spokenLabel(subscription.billing_interval)} plan at ${spokenMoney(subscription.amount_cents)}${subscription.billing_interval === "yearly" ? " per year" : " per month"}${renewal ? `, with the current period ending ${renewal}` : ""}${ending}.`);
  });
  if (!parts.length) return "I do not see an active product subscription connected to this account yet.";
  return `${parts.join(" ")} Subscription changes remain in the appropriate signed-in product billing page.`;
}

function formatProjectOverview(snapshot) {
  const activeProjects = snapshot.websiteProjects.filter((project) => !["cancelled", "archived"].includes(String(project.status || "")));
  if (activeProjects.length) {
    const project = activeProjects[0];
    const nextStep = String(project.admin_next_step || "").trim();
    return `You have ${activeProjects.length} current website project${activeProjects.length === 1 ? "" : "s"}. ${project.name || "Your most recent project"} is ${spokenLabel(project.status || "active")}, in the ${spokenLabel(project.current_stage || "planning")} stage, at ${Math.max(0, Number(project.progress_percent || 0))} percent${nextStep ? `. The next step is: ${nextStep}` : "."}`;
  }
  const request = snapshot.websiteRequests[0];
  if (request) return `Your latest website request for ${request.business_name || "your project"} is ${spokenLabel(request.status || "submitted")}. No active project workspace is available yet.`;
  return "I do not see a website request or active website project connected to this account.";
}

function formatSupportOverview(snapshot) {
  const open = snapshot.supportRequests.filter((request) => !["resolved", "closed"].includes(String(request.status || "")));
  if (!open.length) return "I do not see an open NEXRA support request on this account. You can start one from the support page.";
  const request = open[0];
  return `You have ${open.length} open support request${open.length === 1 ? "" : "s"}. The most recent, ${request.subject || request.topic || "your support request"}, is ${spokenLabel(request.status || "new")}.`;
}

function formatGeneralOverview(snapshot) {
  const products = [];
  if (snapshot.recordsOrganizations.length) products.push("Records");
  if (snapshot.music) products.push("AI Music");
  if (snapshot.virals) products.push("NEXRA Virals");
  if (snapshot.websiteProjects.length || snapshot.websiteRequests.length || snapshot.websiteSubscriptions.length) products.push("website services");
  if (snapshot.utilityOrganizations.length) products.push("NEXRA Utilities");
  const parts = [`Your NEXRA login is ${spokenLabel(snapshot.profile?.account_status || "active")}.`];
  parts.push(products.length ? `It is connected to ${spokenList(products)}.` : "I do not see an activated product or service connected yet.");
  const openInvoices = snapshot.websiteInvoices.some((invoice) => invoice.status === "open" && Number(invoice.amount_due_cents || 0) > 0);
  const waitingProject = snapshot.websiteProjects.find((project) => project.status === "waiting_on_client");
  const attentionProduct = [snapshot.music, snapshot.virals, ...snapshot.recordsOrganizations, ...snapshot.websiteSubscriptions]
    .filter(Boolean)
    .some((product) => productStatusNeedsAttention(product.account_status || product.status));
  if (openInvoices || attentionProduct) parts.push("There is a billing item that needs your attention.");
  else if (waitingProject) parts.push(`Your website project ${waitingProject.name || "workspace"} is waiting on a client step.`);
  else parts.push("I do not see an immediate account alert.");
  parts.push("You can ask me specifically about billing, subscriptions, usage, website projects, or support requests.");
  return parts.join(" ");
}

function formatAccountOverview(snapshot, intent = "general") {
  const normalizedIntent = ["billing", "usage", "subscriptions", "projects", "support"].includes(intent) ? intent : "general";
  if (normalizedIntent === "billing") return formatBillingOverview(snapshot);
  if (normalizedIntent === "usage") return formatUsageOverview(snapshot);
  if (normalizedIntent === "subscriptions") return formatSubscriptionOverview(snapshot);
  if (normalizedIntent === "projects") return formatProjectOverview(snapshot);
  if (normalizedIntent === "support") return formatSupportOverview(snapshot);
  return formatGeneralOverview(snapshot);
}

async function safeRows(path) {
  return supabaseJson(path).catch(() => []);
}

async function loadAccountSnapshot(userId, intent = "general") {
  const needsBilling = ["general", "billing", "subscriptions"].includes(intent);
  const needsProjects = ["general", "projects"].includes(intent);
  const needsSupport = ["general", "support"].includes(intent);
  const [profiles, memberships, musicRows, viralsRows, websiteProjects, websiteRequests, websiteSubscriptions, websiteInvoices, utilityMemberships, supportRequests] = await Promise.all([
    supabaseJson(`profiles?select=account_status&id=eq.${encodeURIComponent(userId)}&limit=1`),
    supabaseJson(`organization_memberships?select=role,organization:organizations(name,subscription_tier,account_status)&user_id=eq.${encodeURIComponent(userId)}`),
    safeRows(`music_profiles?select=plan,account_status,songs_used,monthly_song_limit,cancel_at_period_end,subscription_current_period_end&user_id=eq.${encodeURIComponent(userId)}&limit=1`),
    safeRows(`virals_profiles?select=plan,account_status,analyses_used,monthly_analysis_limit,cancel_at_period_end,subscription_current_period_end&user_id=eq.${encodeURIComponent(userId)}&limit=1`),
    needsProjects ? safeRows(`website_projects?select=id,name,status,current_stage,progress_percent,admin_next_step,target_launch_date,updated_at&client_user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=5`) : [],
    needsProjects ? safeRows(`website_service_requests?select=id,business_name,status,created_at&user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=3`) : [],
    needsBilling ? safeRows(`website_subscriptions?select=project_id,service_plan,billing_interval,amount_cents,status,current_period_end,commitment_ends_at,cancel_at_period_end,updated_at&client_user_id=eq.${encodeURIComponent(userId)}&order=updated_at.desc&limit=5`) : [],
    needsBilling ? safeRows(`website_invoices?select=project_id,status,total_cents,amount_due_cents,amount_paid_cents,due_at,created_at&client_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=10`) : [],
    intent === "general" ? safeRows(`utility_organization_members?select=status,organization:utility_organizations(name,status,launch_status)&user_id=eq.${encodeURIComponent(userId)}&status=eq.active`) : [],
    needsSupport ? safeRows(`platform_support_requests?select=topic,subject,status,priority,created_at&requester_user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=5`) : [],
  ]);
  return {
    profile: firstRow(profiles),
    recordsOrganizations: memberships.map((membership) => relatedRow(membership.organization)).filter(Boolean),
    music: firstRow(musicRows),
    virals: firstRow(viralsRows),
    websiteProjects,
    websiteRequests,
    websiteSubscriptions,
    websiteInvoices,
    utilityOrganizations: utilityMemberships.map((membership) => relatedRow(membership.organization)).filter(Boolean),
    supportRequests,
  };
}

async function accountOverview(userId, intent = "general") {
  return formatAccountOverview(await loadAccountSnapshot(userId, intent), intent);
}

module.exports = {
  accountOverview,
  authenticatedUser,
  getCallerAccount,
  getCredentialByUser,
  formatAccountOverview,
  hashPin,
  matchesPin,
  normalizePhone,
  loadAccountSnapshot,
  saveCredential,
  sendPasswordResetEmail,
  validPin,
  verifyCallerPin,
};
