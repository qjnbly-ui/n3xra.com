const { getBearerToken, verifySupabaseUser } = require("./_music-supabase");
const {
  CREATOR_PROGRAMS,
  CUSTOMER_PROMO_DISCOUNT_MONTHS,
  CUSTOMER_PROMO_DISCOUNT_PERCENT,
  getAccountStatus,
  getPlan,
  getPlanIdFromPriceId,
  getSubscriptionPeriodEnd,
  getSubscriptionPeriodStart,
  normalizePromoCode,
} = require("./_virals-billing");

const VIRALS_SUPABASE_URL = String(process.env.VIRALS_SUPABASE_URL || "").replace(/\/+$/, "");
const VIRALS_SUPABASE_SERVICE_ROLE_KEY = String(process.env.VIRALS_SUPABASE_SERVICE_ROLE_KEY || "").trim();
const MAIN_SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const MAIN_SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const VIRALS_SYSTEM_USER_ID = String(process.env.VIRALS_SYSTEM_USER_ID || "00000000-0000-4000-8000-000000000001").trim();
const MAIN_SUPABASE_TABLES = new Set([
  "virals_profiles",
  "virals_admins",
  "virals_creator_applications",
  "virals_referrals",
  "virals_commission_ledger",
]);

class ViralsSupabaseError extends Error {
  constructor(message, status = 500, data = null) {
    super(message);
    this.name = "ViralsSupabaseError";
    this.status = status;
    this.data = data;
  }
}

function hasViralsSupabaseConfig() {
  return Boolean(VIRALS_SUPABASE_URL && VIRALS_SUPABASE_SERVICE_ROLE_KEY);
}

function hasViralsBusinessConfig() {
  return Boolean(MAIN_SUPABASE_URL && MAIN_SUPABASE_SERVICE_ROLE_KEY);
}

function getTableConfig(table) {
  if (MAIN_SUPABASE_TABLES.has(table)) {
    return {
      url: MAIN_SUPABASE_URL,
      key: MAIN_SUPABASE_SERVICE_ROLE_KEY,
      label: "main Supabase",
    };
  }
  return {
    url: VIRALS_SUPABASE_URL,
    key: VIRALS_SUPABASE_SERVICE_ROLE_KEY,
    label: "Virals Supabase",
  };
}

function serviceHeaders(extra = {}) {
  return {
    apikey: VIRALS_SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${VIRALS_SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function serviceHeadersForUrl(url, existing = {}) {
  const headers = { "Content-Type": "application/json", ...existing };
  const target = String(url || "");
  if (MAIN_SUPABASE_URL && target.startsWith(`${MAIN_SUPABASE_URL}/`)) {
    headers.apikey = MAIN_SUPABASE_SERVICE_ROLE_KEY;
    headers.Authorization = `Bearer ${MAIN_SUPABASE_SERVICE_ROLE_KEY}`;
  } else if (VIRALS_SUPABASE_URL && target.startsWith(`${VIRALS_SUPABASE_URL}/`)) {
    headers.apikey = VIRALS_SUPABASE_SERVICE_ROLE_KEY;
    headers.Authorization = `Bearer ${VIRALS_SUPABASE_SERVICE_ROLE_KEY}`;
  }
  return headers;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: serviceHeadersForUrl(url, options.headers || {}),
  });
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = String(data?.message || data?.error || data?.msg || `Virals Supabase request failed with status ${response.status}.`);
    throw new ViralsSupabaseError(message, response.status, data);
  }

  return data;
}

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function firstRow(rows) {
  return Array.isArray(rows) ? rows[0] || null : null;
}

function normalizeUrl(value) {
  const raw = cleanString(value, 900);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/+$/, "");
  } catch {
    return raw.split("?")[0].replace(/\/+$/, "");
  }
}

function cleanTikTokHandle(handle) {
  return cleanString(handle, 180).replace(/^@+/, "");
}

function buildCanonicalTikTokUrl(handle, videoId, fallback = "") {
  const cleanHandle = cleanTikTokHandle(handle);
  const id = cleanString(videoId, 180);
  if (cleanHandle && id) return `https://www.tiktok.com/@${encodeURIComponent(cleanHandle)}/video/${encodeURIComponent(id)}`;
  const raw = cleanString(fallback, 900);
  if (!raw) return "";
  if (/^www\.tiktok\.com\//i.test(raw) || /^tiktok\.com\//i.test(raw)) return `https://${raw}`;
  return raw;
}

function cleanUuid(value) {
  const raw = cleanString(value, 80);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw) ? raw : null;
}

function tableUrl(table, query = "") {
  const config = getTableConfig(table);
  return `${config.url}/rest/v1/${table}${query}`;
}

function getAnonymousViralsUser() {
  return {
    id: VIRALS_SYSTEM_USER_ID,
    email: "anonymous@n3xra-virals.local",
    user_metadata: {
      name: "N3XRA Virals Anonymous",
    },
    isAnonymousViralsUser: true,
  };
}

async function insertRow(table, payload) {
  const rows = await fetchJson(tableUrl(table), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return firstRow(rows);
}

async function patchRows(table, query, payload) {
  const rows = await fetchJson(tableUrl(table, query), {
    method: "PATCH",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify(payload),
  });
  return rows;
}

async function ensureViralsProfile(user) {
  if (!user?.id) return null;
  const rows = await fetchJson(tableUrl("virals_profiles", "?on_conflict=user_id"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      user_id: user.id,
      display_name: cleanString(user.user_metadata?.full_name || user.user_metadata?.name || user.email || "", 160) || null,
    }),
  });
  return firstRow(rows);
}

function normalizeViralsProfile(profile) {
  const plan = getPlan(profile?.plan || "free");
  return {
    user_id: profile?.user_id || "",
    display_name: profile?.display_name || "",
    plan: profile?.plan || "free",
    plan_name: plan.name,
    account_status: profile?.account_status || "active",
    monthly_analysis_limit: Number(profile?.monthly_analysis_limit ?? plan.monthlyAnalysisLimit),
    analyses_used: Number(profile?.analyses_used || 0),
    current_period_start: profile?.current_period_start || null,
    current_period_end: profile?.current_period_end || null,
    cancel_at_period_end: Boolean(profile?.cancel_at_period_end),
    subscription_current_period_end: profile?.subscription_current_period_end || null,
    billing_portal_available: Boolean(profile?.stripe_customer_id),
  };
}

function isPeriodExpired(profile) {
  const end = profile?.current_period_end ? new Date(profile.current_period_end) : null;
  return !end || Number.isNaN(end.getTime()) || end <= new Date();
}

function addOneMonth(date) {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

async function resetViralsPeriod(userId) {
  const now = new Date();
  const next = addOneMonth(now);
  const rows = await patchRows("virals_profiles", `?user_id=eq.${encodeFilter(userId)}`, {
    analyses_used: 0,
    current_period_start: now.toISOString(),
    current_period_end: next.toISOString(),
  });
  return firstRow(rows);
}

async function loadViralsProfile(userId) {
  const rows = await fetchJson(tableUrl("virals_profiles", `?select=*&user_id=eq.${encodeFilter(userId)}&limit=1`), {
    headers: serviceHeaders(),
  });
  return firstRow(rows);
}

async function ensureViralsProfileAndPeriod(user) {
  await ensureViralsProfile(user);
  let profile = await loadViralsProfile(user.id);
  if (profile && isPeriodExpired(profile)) profile = await resetViralsPeriod(user.id);
  return profile;
}

async function isViralsAdmin(user) {
  if (!user?.id) return false;
  const email = cleanString(user.email, 240).toLowerCase();
  if (email === "quentin@n3xra.com") {
    await fetchJson(tableUrl("virals_admins", "?on_conflict=user_id"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates" }),
      body: JSON.stringify({ user_id: user.id, email, role: "owner" }),
    }).catch(() => null);
    return true;
  }
  const rows = await fetchJson(tableUrl("virals_admins", `?select=user_id&user_id=eq.${encodeFilter(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  }).catch(() => []);
  return Boolean(firstRow(rows));
}

async function requireViralsAdmin(user) {
  if (!(await isViralsAdmin(user))) {
    throw new ViralsSupabaseError("Virals admin access required.", 403);
  }
}

async function assertViralsCreditsAvailable(user, inputCount = 1) {
  if (!hasViralsBusinessConfig() || !user?.id || user.isAnonymousViralsUser) return null;
  const profile = await ensureViralsProfileAndPeriod(user);
  const normalized = normalizeViralsProfile(profile);
  if (!["active", "trialing"].includes(normalized.account_status)) {
    throw new ViralsSupabaseError("Your Virals subscription is not active.", 402, normalized);
  }
  const needed = Math.max(1, Number(inputCount || 1) || 1);
  if (normalized.analyses_used + needed > normalized.monthly_analysis_limit) {
    throw new ViralsSupabaseError("You have reached your monthly Virals analysis limit.", 402, normalized);
  }
  return normalized;
}

async function consumeViralsCredits(user, inputCount = 1) {
  if (!hasViralsBusinessConfig() || !user?.id || user.isAnonymousViralsUser) return null;
  const profile = await ensureViralsProfileAndPeriod(user);
  const normalized = normalizeViralsProfile(profile);
  const needed = Math.max(1, Number(inputCount || 1) || 1);
  const rows = await patchRows("virals_profiles", `?user_id=eq.${encodeFilter(user.id)}`, {
    analyses_used: normalized.analyses_used + needed,
  });
  return normalizeViralsProfile(firstRow(rows) || profile);
}

function normalizeCreatorApplication(row = {}, stats = {}) {
  if (!row?.id) return null;
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email || "",
    displayName: row.display_name || "",
    tiktokUsername: row.tiktok_username || "",
    requestedCode: row.requested_code || "",
    normalizedCode: row.normalized_code || "",
    requestedProgram: row.requested_program || "standard",
    approvedProgram: row.approved_program || "",
    status: row.status || "pending",
    commissionRate: Number(row.commission_rate || 0),
    customerDiscountPercent: Number(row.customer_discount_percent || 0),
    customerDiscountMonths: Number(row.customer_discount_months || 0),
    aiEvaluation: row.ai_evaluation || {},
    notes: row.notes || "",
    adminNotes: row.admin_notes || "",
    stripeCouponId: row.stripe_coupon_id || "",
    stripePromotionCodeId: row.stripe_promotion_code_id || "",
    stripeConnectAccountId: row.stripe_connect_account_id || "",
    stripeConnectOnboardingCompleted: Boolean(row.stripe_connect_onboarding_completed),
    approvedAt: row.approved_at || null,
    rejectedAt: row.rejected_at || null,
    createdAt: row.created_at || null,
    stats,
  };
}

async function getPromoCodeStatus(code) {
  const normalized = normalizePromoCode(code);
  if (!normalized) return { code: "", available: false, reason: "invalid" };
  const rows = await fetchJson(tableUrl("virals_creator_applications", `?select=id,status,user_id&normalized_code=eq.${encodeFilter(normalized)}&status=neq.rejected&limit=1`), {
    headers: serviceHeaders(),
  }).catch(() => []);
  const existing = firstRow(rows);
  return {
    code: normalized,
    available: !existing,
    reason: existing ? "taken" : "available",
  };
}

async function getLatestCreatorApplication(userId) {
  const rows = await fetchJson(tableUrl("virals_creator_applications", `?select=*&user_id=eq.${encodeFilter(userId)}&order=created_at.desc&limit=1`), {
    headers: serviceHeaders(),
  }).catch(() => []);
  const app = firstRow(rows);
  if (!app) return null;
  const stats = await getCreatorStats(app.id).catch(() => ({}));
  return normalizeCreatorApplication(app, stats);
}

async function getCreatorStats(applicationId) {
  if (!applicationId) return {};
  const [referrals, commissions] = await Promise.all([
    fetchJson(tableUrl("virals_referrals", `?select=id,status&creator_application_id=eq.${encodeFilter(applicationId)}`), { headers: serviceHeaders() }).catch(() => []),
    fetchJson(tableUrl("virals_commission_ledger", `?select=commission_amount,status&creator_application_id=eq.${encodeFilter(applicationId)}`), { headers: serviceHeaders() }).catch(() => []),
  ]);
  return {
    referrals: referrals.length,
    activeReferrals: referrals.filter((row) => row.status === "active").length,
    pendingCommission: commissions.filter((row) => ["pending", "eligible"].includes(row.status)).reduce((sum, row) => sum + Number(row.commission_amount || 0), 0),
    paidCommission: commissions.filter((row) => row.status === "paid").reduce((sum, row) => sum + Number(row.commission_amount || 0), 0),
  };
}

async function submitCreatorApplication(user, payload = {}, aiEvaluation = {}) {
  const normalizedCode = normalizePromoCode(payload.requestedCode);
  if (!normalizedCode) throw new ViralsSupabaseError("Choose a promo code using letters, numbers, dashes, or underscores.", 400);
  const availability = await getPromoCodeStatus(normalizedCode);
  if (!availability.available) throw new ViralsSupabaseError("That promo code is already taken.", 409);
  const requestedProgram = String(payload.requestedProgram || "standard").trim().toLowerCase() === "founding" ? "founding" : "standard";
  const program = CREATOR_PROGRAMS[requestedProgram] || CREATOR_PROGRAMS.standard;
  const displayName = cleanString(payload.displayName || user.user_metadata?.full_name || user.user_metadata?.name || "", 180);
  const rows = await fetchJson(tableUrl("virals_creator_applications"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=representation" }),
    body: JSON.stringify({
      user_id: user.id,
      email: cleanString(user.email, 240) || null,
      display_name: displayName || null,
      tiktok_username: cleanTikTokHandle(payload.tiktokUsername),
      requested_code: normalizedCode,
      normalized_code: normalizedCode,
      requested_program: requestedProgram,
      commission_rate: program.commissionRate,
      customer_discount_percent: CUSTOMER_PROMO_DISCOUNT_PERCENT,
      customer_discount_months: CUSTOMER_PROMO_DISCOUNT_MONTHS,
      ai_evaluation: aiEvaluation || {},
      notes: cleanString(payload.notes, 4000) || null,
    }),
  });
  return normalizeCreatorApplication(firstRow(rows));
}

async function listCreatorApplications(user, status = "") {
  await requireViralsAdmin(user);
  const statusFilter = status ? `&status=eq.${encodeFilter(status)}` : "";
  const rows = await fetchJson(tableUrl("virals_creator_applications", `?select=*&order=created_at.desc${statusFilter}&limit=100`), {
    headers: serviceHeaders(),
  });
  return Promise.all(rows.map(async (row) => normalizeCreatorApplication(row, await getCreatorStats(row.id).catch(() => ({})))));
}

async function countApprovedFoundingCreators() {
  const rows = await fetchJson(tableUrl("virals_creator_applications", "?select=id&status=eq.approved&approved_program=eq.founding"), {
    headers: serviceHeaders(),
  }).catch(() => []);
  return rows.length;
}

async function loadCreatorApplicationById(id) {
  const rows = await fetchJson(tableUrl("virals_creator_applications", `?select=*&id=eq.${encodeFilter(id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  return firstRow(rows);
}

async function updateCreatorApplication(id, updates = {}) {
  const rows = await patchRows("virals_creator_applications", `?id=eq.${encodeFilter(id)}`, updates);
  return normalizeCreatorApplication(firstRow(rows));
}

async function updateCreatorConnectAccount(applicationId, accountId, completed = false) {
  return updateCreatorApplication(applicationId, {
    stripe_connect_account_id: accountId || null,
    stripe_connect_onboarding_completed: Boolean(completed),
  });
}

async function updateViralsProfileFromSubscription(userId, subscription = {}) {
  const priceId = subscription.items?.data?.[0]?.price?.id || null;
  const planId = getPlanIdFromPriceId(priceId);
  const plan = getPlan(planId);
  const startSeconds = getSubscriptionPeriodStart(subscription);
  const endSeconds = getSubscriptionPeriodEnd(subscription);
  const now = new Date();
  const start = startSeconds ? new Date(startSeconds * 1000) : now;
  const end = endSeconds ? new Date(endSeconds * 1000) : addOneMonth(start);
  const rows = await patchRows("virals_profiles", `?user_id=eq.${encodeFilter(userId)}`, {
    plan: plan.id,
    account_status: getAccountStatus(subscription.status),
    monthly_analysis_limit: plan.monthlyAnalysisLimit,
    analyses_used: 0,
    current_period_start: start.toISOString(),
    current_period_end: end.toISOString(),
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null,
    stripe_subscription_id: subscription.id || null,
    stripe_price_id: priceId,
    cancel_at_period_end: Boolean(subscription.cancel_at_period_end || subscription.cancel_at),
    subscription_current_period_end: end.toISOString(),
  });
  return normalizeViralsProfile(firstRow(rows));
}

async function attachViralsStripeCustomer(userId, customerId) {
  const rows = await patchRows("virals_profiles", `?user_id=eq.${encodeFilter(userId)}`, {
    stripe_customer_id: customerId || null,
  });
  return firstRow(rows);
}

async function createReferralIfMissing({ creatorApplicationId, referredUserId, subscription, promotionCodeId, normalizedCode, invoiceId }) {
  if (!creatorApplicationId || !referredUserId) return null;
  const existing = firstRow(await fetchJson(tableUrl("virals_referrals", `?select=*&referred_user_id=eq.${encodeFilter(referredUserId)}&limit=1`), {
    headers: serviceHeaders(),
  }).catch(() => []));
  if (existing) return existing;
  return insertRow("virals_referrals", {
    creator_application_id: creatorApplicationId,
    referred_user_id: referredUserId,
    stripe_customer_id: typeof subscription.customer === "string" ? subscription.customer : subscription.customer?.id || null,
    stripe_subscription_id: subscription.id || null,
    stripe_promotion_code_id: promotionCodeId || null,
    normalized_code: normalizedCode,
    first_invoice_id: invoiceId || null,
  });
}

async function findApplicationByPromotionCode(promotionCodeId) {
  if (!promotionCodeId) return null;
  const rows = await fetchJson(tableUrl("virals_creator_applications", `?select=*&stripe_promotion_code_id=eq.${encodeFilter(promotionCodeId)}&status=eq.approved&limit=1`), {
    headers: serviceHeaders(),
  }).catch(() => []);
  return firstRow(rows);
}

async function findReferralBySubscription(subscriptionId) {
  if (!subscriptionId) return null;
  const rows = await fetchJson(tableUrl("virals_referrals", `?select=*&stripe_subscription_id=eq.${encodeFilter(subscriptionId)}&limit=1`), {
    headers: serviceHeaders(),
  }).catch(() => []);
  return firstRow(rows);
}

async function updateReferralStatus(subscriptionId, status) {
  if (!subscriptionId) return null;
  const rows = await patchRows("virals_referrals", `?stripe_subscription_id=eq.${encodeFilter(subscriptionId)}`, {
    status,
  });
  return firstRow(rows);
}

async function createCommissionLedger({ application, referral, invoice }) {
  if (!application?.id || !invoice?.id || Number(invoice.amount_paid || 0) <= 0) return null;
  const amountPaid = Number(invoice.amount_paid || 0);
  const rate = Number(application.commission_rate || 0);
  const commissionAmount = Math.floor(amountPaid * rate);
  const eligible = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  return insertRow("virals_commission_ledger", {
    creator_application_id: application.id,
    referral_id: referral?.id || null,
    stripe_invoice_id: invoice.id,
    stripe_subscription_id: typeof invoice.subscription === "string" ? invoice.subscription : invoice.subscription?.id || null,
    stripe_customer_id: typeof invoice.customer === "string" ? invoice.customer : invoice.customer?.id || null,
    amount_paid: amountPaid,
    currency: cleanString(invoice.currency || "usd", 12).toLowerCase(),
    commission_rate: rate,
    commission_amount: commissionAmount,
    status: "pending",
    eligible_at: eligible.toISOString(),
  }).catch((error) => {
    if (error?.status === 409) return null;
    throw error;
  });
}

async function listEligibleCommissions(applicationId) {
  if (!applicationId) return [];
  const now = new Date().toISOString();
  return fetchJson(tableUrl(
    "virals_commission_ledger",
    `?select=*&creator_application_id=eq.${encodeFilter(applicationId)}&status=in.(pending,eligible)&eligible_at=lte.${encodeFilter(now)}&order=created_at.asc`
  ), { headers: serviceHeaders() }).catch(() => []);
}

async function markCommissionsPaid(ids = [], transferId = "") {
  const cleanIds = ids.map((id) => cleanUuid(id)).filter(Boolean);
  if (!cleanIds.length) return [];
  return patchRows("virals_commission_ledger", `?id=in.(${cleanIds.join(",")})`, {
    status: "paid",
    paid_at: new Date().toISOString(),
    stripe_transfer_id: transferId || null,
  });
}

async function getViralsAccount(user) {
  const profile = normalizeViralsProfile(await ensureViralsProfileAndPeriod(user));
  const creator = await getLatestCreatorApplication(user.id);
  return {
    profile,
    creator,
    isAdmin: await isViralsAdmin(user),
  };
}

async function saveCreator(video) {
  const handle = cleanString(video?.author?.uniqueId, 160);
  if (!handle) return null;
  const rows = await fetchJson(tableUrl("virals_creators", "?on_conflict=platform,handle"), {
    method: "POST",
    headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
    body: JSON.stringify({
      platform: "tiktok",
      handle,
      display_name: cleanString(video?.author?.nickname, 220) || null,
      follower_count: Number(video?.author?.followerCount || 0) || null,
      profile_url: handle ? `https://www.tiktok.com/@${handle}` : null,
      raw_metadata: video?.author || {},
    }),
  });
  return firstRow(rows);
}

async function saveVideo(user, video, input = {}) {
  const payload = {
    master_user_id: user.id,
    source_url: cleanString(video?.url || input.url, 700),
    platform: "tiktok",
    external_video_id: cleanString(video?.videoId, 160) || null,
    title: cleanString(video?.caption || "Untitled TikTok", 300),
    description: cleanString(video?.caption, 1200) || null,
    creator_name: cleanString(video?.author?.nickname, 220) || null,
    creator_handle: cleanString(video?.author?.uniqueId, 160) || null,
    thumbnail_url: cleanString(video?.coverUrl || video?.dynamicCoverUrl, 1000) || null,
    duration_seconds: Number(video?.durationSeconds || 0) || null,
    metrics: video?.stats || {},
    latest_metrics_captured_at: Object.keys(video?.stats || {}).length ? new Date().toISOString() : null,
    metrics_source: Object.keys(video?.stats || {}).length ? "tiktok_page_metadata_snapshot" : null,
    raw_metadata: video || {},
  };
  return insertRow("virals_videos", payload);
}

async function saveTranscript(videoRow, video) {
  if (!videoRow?.id || !video?.transcript) return null;
  return insertRow("virals_transcripts", {
    video_id: videoRow.id,
    transcript_text: cleanString(video.transcript, 50000),
    transcript_segments: [],
    language: "en",
    source: cleanString(video.transcriptSource || video.transcriptFormat || "tiktok_subtitles", 120),
  });
}

async function saveProduct(product = {}) {
  const name = cleanString(product.name || "Detected product", 180);
  if (!name) return null;
  return insertRow("virals_products", {
    name,
    platform: "tiktok",
    shop_product_id: cleanString(product.shopProductId, 160) || null,
    product_url: cleanString(product.productUrl, 1000) || null,
    category: cleanString(product.category, 120) || null,
    niche: cleanString(product.category, 120) || null,
    offer: cleanString(product.offer, 320) || null,
    confidence: cleanString(product.confidence, 60) || null,
    data_source: cleanString(product.source, 120) || null,
    claims: Array.isArray(product.claims) ? product.claims : [],
    objections: Array.isArray(product.objections) ? product.objections : [],
    proof_points: Array.isArray(product.proofPoints) ? product.proofPoints : [],
    cta_path: cleanString(product.ctaPath, 1000) || null,
    api_readiness: cleanString(product.apiReadiness, 1000) || null,
    raw_metadata: product,
  });
}

async function linkVideoProduct(videoRow, productRow, product = {}) {
  if (!videoRow?.id || !productRow?.id) return null;
  return insertRow("virals_video_products", {
    video_id: videoRow.id,
    product_id: productRow.id,
    relationship_source: cleanString(product.source || "resolver", 120),
    confidence: cleanString(product.confidence, 60) || null,
  });
}

async function saveAnalysis(user, videoRow, analysis = {}, model = "") {
  if (!videoRow?.id) return null;
  return insertRow("virals_ai_analyses", {
    video_id: videoRow.id,
    master_user_id: user.id,
    status: "completed",
    summary: cleanString(analysis.formula, 1200) || null,
    hook: cleanString(analysis.hookType, 300) || null,
    hook_breakdown: {
      hookType: analysis.hookType,
      formula: analysis.formula,
      hooks: analysis.hooks || [],
      transcriptHook: analysis.transcriptBreakdown?.hook || "",
    },
    structure_breakdown: {
      body: analysis.body,
      transcriptBodyStructure: analysis.transcriptBreakdown?.bodyStructure || "",
      keep: analysis.keep,
      change: analysis.change,
    },
    emotional_triggers: analysis.triggers || [],
    engagement_drivers: analysis.productIntelligence?.proofPoints || [],
    audience_targeting: {
      niche: analysis.niche,
      goal: analysis.goal,
      product: analysis.product,
    },
    strengths: analysis.productIntelligence?.claims || [],
    weaknesses: analysis.productIntelligence?.objections || [],
    why_it_works: cleanString(analysis.conversionPattern, 1200) || null,
    improvement_notes: cleanString(analysis.change, 1000) || null,
    model: cleanString(model, 120) || null,
  });
}

async function saveGeneratedOutputs(user, analysisRow, analysis = {}) {
  if (!analysisRow?.id) return;
  const hooks = Array.isArray(analysis.hooks) ? analysis.hooks : [];
  const scripts = Array.isArray(analysis.scripts) ? analysis.scripts : [];
  const captions = Array.isArray(analysis.captions) ? analysis.captions : [];

  await Promise.all([
    ...hooks.slice(0, 12).map((hook) =>
      insertRow("virals_generated_hooks", {
        analysis_id: analysisRow.id,
        hook_type: cleanString(analysis.hookType || "Generated", 120),
        hook_text: cleanString(hook, 1200),
      }).catch(() => null)
    ),
    ...scripts.slice(0, 5).map((script) =>
      insertRow("virals_generated_scripts", {
        analysis_id: analysisRow.id,
        master_user_id: user.id,
        script_type: cleanString(script.title || "Generated Script", 120),
        title: cleanString(script.title || "Generated Script", 160),
        script_text: cleanString(script.text, 5000),
        platform: "tiktok",
        status: "saved",
      }).catch(() => null)
    ),
    ...captions.slice(0, 6).map((caption) =>
      insertRow("virals_generated_captions", {
        analysis_id: analysisRow.id,
        caption_text: cleanString(caption, 1200),
        platform: "tiktok",
      }).catch(() => null)
    ),
  ]);
}

async function saveUsageEvent(user, event = {}) {
  if (!user?.id) return null;
  return insertRow("virals_usage_events", {
    user_id: user.id,
    event_type: event.event_type || "single_analysis",
    analysis_id: event.analysis_id || null,
    video_id: event.video_id || null,
    input_count: Number(event.input_count || 1) || 1,
    model: cleanString(event.model, 120) || null,
    prompt_tokens: Number(event.prompt_tokens || 0) || 0,
    completion_tokens: Number(event.completion_tokens || 0) || 0,
    total_tokens: Number(event.total_tokens || 0) || 0,
  });
}

function normalizeSavedVideo(row = {}) {
  if (!row?.id) return null;
  const raw = row.raw_metadata && typeof row.raw_metadata === "object" ? row.raw_metadata : {};
  const videoId = row.external_video_id || raw.videoId || "";
  const creatorHandle = row.creator_handle || raw.author?.uniqueId || "";
  return {
    id: row.id,
    url: buildCanonicalTikTokUrl(creatorHandle, videoId, row.source_url || raw.url || ""),
    videoId,
    caption: row.description || row.title || raw.caption || "",
    coverUrl: row.thumbnail_url || raw.coverUrl || raw.dynamicCoverUrl || "",
    dynamicCoverUrl: raw.dynamicCoverUrl || row.thumbnail_url || "",
    playUrl: raw.playUrl || raw.videoUrl || raw.playAddr || "",
    embedUrl: raw.embedUrl || (videoId ? `https://www.tiktok.com/player/v1/${encodeURIComponent(videoId)}?controls=1&progress_bar=1&play_button=1&volume_control=1&fullscreen_button=1&timestamp=0&loop=1&autoplay=1&muted=0&music_info=0&description=0&rel=0` : ""),
    durationSeconds: row.duration_seconds || raw.durationSeconds || 0,
    stats: row.metrics || raw.stats || {},
    stickers: Array.isArray(raw.stickers) ? raw.stickers : [],
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
    transcript: raw.transcript || "",
    transcriptSource: raw.transcriptSource || "",
    author: {
      uniqueId: cleanTikTokHandle(creatorHandle),
      nickname: row.creator_name || raw.author?.nickname || "",
      followerCount: raw.author?.followerCount || null,
    },
  };
}

function normalizeSavedAnalysis(row = {}, generatedScripts = [], generatedCaptions = [], videoRow = null) {
  const hookBreakdown = row.hook_breakdown || {};
  const structureBreakdown = row.structure_breakdown || {};
  const audience = row.audience_targeting || {};
  const video = normalizeSavedVideo(videoRow);
  return {
    id: row.id,
    createdAt: row.created_at,
    url: video?.url || "",
    video,
    product: audience.product || "Saved framework",
    niche: audience.niche || "TikTok Shop",
    goal: audience.goal || "TikTok Shop affiliate sale",
    hookType: hookBreakdown.hookType || row.hook || "Framework Hook",
    formula: hookBreakdown.formula || row.summary || "",
    body: structureBreakdown.body || "",
    triggers: Array.isArray(row.emotional_triggers) ? row.emotional_triggers : [],
    conversionPattern: row.why_it_works || "",
    keep: structureBreakdown.keep || "",
    change: structureBreakdown.change || row.improvement_notes || "",
    hooks: Array.isArray(hookBreakdown.hooks) ? hookBreakdown.hooks : [],
    scripts: generatedScripts.map((script) => ({
      title: script.title || script.script_type || "Generated Script",
      text: script.script_text || "",
    })),
    captions: generatedCaptions.map((caption) => caption.caption_text).filter(Boolean),
    shotList: [],
    transcriptBreakdown: {
      cleanedTranscript: "",
      hook: hookBreakdown.transcriptHook || "",
      bodyStructure: structureBreakdown.transcriptBodyStructure || "",
      cta: "",
      sellingBeats: [],
    },
    productIntelligence: {
      name: audience.product || "Saved product",
      category: audience.niche || "TikTok Shop",
      offer: audience.goal || "",
      confidence: "Saved",
      claims: Array.isArray(row.strengths) ? row.strengths : [],
      objections: Array.isArray(row.weaknesses) ? row.weaknesses : [],
      proofPoints: Array.isArray(row.engagement_drivers) ? row.engagement_drivers : [],
    },
  };
}

async function listSavedFrameworks(user, limit = 30) {
  if (!hasViralsSupabaseConfig() || !user?.id) return [];
  const rows = await fetchJson(tableUrl(
    "virals_ai_analyses",
    `?select=*&master_user_id=eq.${encodeFilter(user.id)}&status=eq.completed&order=created_at.desc&limit=${Math.min(Math.max(Number(limit) || 30, 1), 60)}`
  ), { headers: serviceHeaders() });

  const ids = rows.map((row) => row.id).filter(Boolean);
  const videoIds = rows.map((row) => row.video_id).filter(Boolean);
  if (!ids.length) return [];
  const idList = ids.join(",");
  const videoIdList = videoIds.join(",");
  const [scripts, captions, videos] = await Promise.all([
    fetchJson(tableUrl("virals_generated_scripts", `?select=analysis_id,title,script_type,script_text&analysis_id=in.(${idList})`), { headers: serviceHeaders() }).catch(() => []),
    fetchJson(tableUrl("virals_generated_captions", `?select=analysis_id,caption_text&analysis_id=in.(${idList})`), { headers: serviceHeaders() }).catch(() => []),
    videoIds.length
      ? fetchJson(tableUrl("virals_videos", `?select=*&id=in.(${videoIdList})`), { headers: serviceHeaders() }).catch(() => [])
      : [],
  ]);

  return rows.map((row) => normalizeSavedAnalysis(
    row,
    scripts.filter((script) => script.analysis_id === row.id),
    captions.filter((caption) => caption.analysis_id === row.id),
    videos.find((video) => video.id === row.video_id) || null
  ));
}

async function deleteSavedFramework(user, analysisId) {
  if (!hasViralsSupabaseConfig() || !user?.id || !analysisId) return null;
  await fetchJson(tableUrl(
    "virals_ai_analyses",
    `?id=eq.${encodeFilter(analysisId)}&master_user_id=eq.${encodeFilter(user.id)}`
  ), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  return { status: "deleted" };
}

function normalizeSavedScript(row = {}) {
  const context = row.context || {};
  return {
    id: row.id,
    createdAt: row.created_at,
    title: row.title || "Saved Script",
    scriptText: row.script_text || "",
    notes: row.notes || "",
    sourceUrl: row.source_url || "",
    product: row.product || "",
    niche: row.niche || "",
    goal: row.goal || "",
    hookType: row.hook_type || "",
    hookFormula: context.hookFormula || "",
    bodyFramework: context.bodyFramework || "",
    conversionLogic: context.conversionLogic || "",
    keep: context.keep || "",
    change: context.change || "",
    captions: Array.isArray(context.captions) ? context.captions : [],
    shotList: Array.isArray(context.shotList) ? context.shotList : [],
    productIntelligence: context.productIntelligence || null,
  };
}

async function listSavedScripts(user, limit = 80) {
  if (!hasViralsSupabaseConfig() || !user?.id) return [];
  const rows = await fetchJson(tableUrl(
    "virals_saved_scripts",
    `?select=*&master_user_id=eq.${encodeFilter(user.id)}&order=created_at.desc&limit=${Math.min(Math.max(Number(limit) || 80, 1), 120)}`
  ), { headers: serviceHeaders() });
  return rows.map(normalizeSavedScript);
}

async function saveScriptToLibrary(user, payload = {}) {
  if (!hasViralsSupabaseConfig() || !user?.id) return null;
  const row = await insertRow("virals_saved_scripts", {
    master_user_id: user.id,
    source_analysis_id: cleanUuid(payload.sourceAnalysisId),
    title: cleanString(payload.title || "Saved Script", 180),
    script_text: cleanString(payload.scriptText, 12000),
    notes: cleanString(payload.notes, 4000) || null,
    source_url: cleanString(payload.sourceUrl, 1000) || null,
    product: cleanString(payload.product, 220) || null,
    niche: cleanString(payload.niche, 160) || null,
    goal: cleanString(payload.goal, 180) || null,
    hook_type: cleanString(payload.hookType, 180) || null,
    context: {
      hookFormula: cleanString(payload.hookFormula, 1600),
      bodyFramework: cleanString(payload.bodyFramework, 1600),
      conversionLogic: cleanString(payload.conversionLogic, 1600),
      keep: cleanString(payload.keep, 1400),
      change: cleanString(payload.change, 1400),
      captions: Array.isArray(payload.captions) ? payload.captions.slice(0, 10) : [],
      shotList: Array.isArray(payload.shotList) ? payload.shotList.slice(0, 12) : [],
      productIntelligence: payload.productIntelligence || null,
    },
    tags: Array.isArray(payload.tags) ? payload.tags.slice(0, 20) : [],
  });
  await saveUsageEvent(user, { event_type: "script_save", input_count: 1 }).catch(() => null);
  return normalizeSavedScript(row);
}

async function deleteSavedScript(user, scriptId) {
  if (!hasViralsSupabaseConfig() || !user?.id || !scriptId) return null;
  await fetchJson(tableUrl(
    "virals_saved_scripts",
    `?id=eq.${encodeFilter(scriptId)}&master_user_id=eq.${encodeFilter(user.id)}`
  ), {
    method: "DELETE",
    headers: serviceHeaders(),
  });
  return { status: "deleted" };
}

async function saveVideoSearchStats(videoRow, video, analysisRow, analysis = {}, input = {}) {
  const normalizedUrl = normalizeUrl(video?.url || input.url);
  if (!normalizedUrl) return null;

  const existing = firstRow(await fetchJson(tableUrl("virals_video_search_stats", `?normalized_url=eq.${encodeFilter(normalizedUrl)}&limit=1`), {
    headers: serviceHeaders(),
  }));
  const thumbnailUrl = cleanString(
    video?.coverUrl ||
      video?.dynamicCoverUrl ||
      videoRow?.thumbnail_url ||
      existing?.thumbnail_url,
    1000
  ) || null;
  const title = cleanString(
    video?.caption ||
      videoRow?.title ||
      existing?.title ||
      "Untitled TikTok",
    300
  );
  const creatorHandle = cleanString(
    video?.author?.uniqueId ||
      videoRow?.creator_handle ||
      existing?.creator_handle,
    160
  ) || null;

  const payload = {
    normalized_url: normalizedUrl,
    platform: "tiktok",
    external_video_id: cleanString(video?.videoId || videoRow?.external_video_id || existing?.external_video_id, 160) || null,
    title,
    creator_handle: creatorHandle,
    thumbnail_url: thumbnailUrl,
    search_count: Number(existing?.search_count || 0) + 1,
    analysis_count: Number(existing?.analysis_count || 0) + 1,
    last_seen_at: new Date().toISOString(),
    latest_video_id: videoRow?.id || null,
    latest_analysis_id: analysisRow?.id || null,
    latest_metrics: video?.stats || videoRow?.metrics || {},
    latest_framework: {
      hookType: analysis.hookType || null,
      formula: analysis.formula || null,
      body: analysis.body || null,
      product: analysis.productIntelligence?.name || analysis.product || null,
      niche: analysis.niche || null,
    },
  };

  if (existing?.id) {
    return firstRow(await fetchJson(tableUrl("virals_video_search_stats", `?id=eq.${encodeFilter(existing.id)}`), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(payload),
    }));
  }

  return insertRow("virals_video_search_stats", payload);
}

async function saveViralsVideoReference({ user, input, video, analysis }) {
  const owner = user?.id ? user : getAnonymousViralsUser();
  if (!hasViralsSupabaseConfig() || !owner?.id || !video) return null;

  await ensureViralsProfile(owner);
  await saveCreator(video).catch(() => null);
  const videoRow = await saveVideo(owner, video, input);
  await saveTranscript(videoRow, video).catch(() => null);
  await saveVideoSearchStats(videoRow, video, null, analysis, input).catch(() => null);
  return {
    status: "saved",
    owner: owner.isAnonymousViralsUser ? "anonymous" : "account",
    video_id: videoRow?.id || null,
  };
}

async function saveViralsAnalysis({ user, input, video, analysis, model, usage }) {
  const owner = user?.id ? user : getAnonymousViralsUser();
  if (!hasViralsSupabaseConfig() || !owner?.id || !analysis) return null;

  await ensureViralsProfile(owner);
  const sourceVideo = video || {
    url: input?.url || analysis.url || "",
    caption: input?.notes || "",
    stats: {},
    raw_metadata: { source: "user_input" },
  };

  await saveCreator(sourceVideo).catch(() => null);
  const videoRow = await saveVideo(owner, sourceVideo, input);
  await saveTranscript(videoRow, sourceVideo).catch(() => null);
  const productRow = await saveProduct(analysis.productIntelligence).catch(() => null);
  await linkVideoProduct(videoRow, productRow, analysis.productIntelligence).catch(() => null);
  const analysisRow = await saveAnalysis(owner, videoRow, analysis, model);
  await saveGeneratedOutputs(owner, analysisRow, analysis).catch(() => null);
  await saveVideoSearchStats(videoRow, sourceVideo, analysisRow, analysis, input).catch(() => null);
  await saveUsageEvent(owner, {
    event_type: "single_analysis",
    analysis_id: analysisRow?.id || null,
    video_id: videoRow?.id || null,
    input_count: 1,
    model,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens,
  }).catch(() => null);

  return {
    status: "saved",
    owner: owner.isAnonymousViralsUser ? "anonymous" : "account",
    video_id: videoRow?.id || null,
    analysis_id: analysisRow?.id || null,
    product_id: productRow?.id || null,
  };
}

module.exports = {
  ViralsSupabaseError,
  assertViralsCreditsAvailable,
  attachViralsStripeCustomer,
  consumeViralsCredits,
  countApprovedFoundingCreators,
  createCommissionLedger,
  createReferralIfMissing,
  deleteSavedFramework,
  deleteSavedScript,
  findApplicationByPromotionCode,
  findReferralBySubscription,
  getBearerToken,
  getAnonymousViralsUser,
  getPromoCodeStatus,
  getViralsAccount,
  hasViralsBusinessConfig,
  hasViralsSupabaseConfig,
  ensureViralsProfileAndPeriod,
  isViralsAdmin,
  listSavedFrameworks,
  listSavedScripts,
  listCreatorApplications,
  listEligibleCommissions,
  loadCreatorApplicationById,
  loadViralsProfile,
  saveScriptToLibrary,
  saveUsageEvent,
  saveViralsAnalysis,
  saveViralsVideoReference,
  submitCreatorApplication,
  markCommissionsPaid,
  updateCreatorApplication,
  updateCreatorConnectAccount,
  updateReferralStatus,
  updateViralsProfileFromSubscription,
  verifySupabaseUser,
};
