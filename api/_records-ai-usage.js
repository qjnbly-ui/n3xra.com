const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const { contextAllows, getRecordsAccessContext } = require("./_records-support-access");

const RECORDS_AI_PLAN_LIMITS = {
  free: {
    planName: "Free",
    monthlyRequests: 20,
    monthlyTokens: 100000,
  },
  starter: {
    planName: "Starter",
    monthlyRequests: 300,
    monthlyTokens: 1500000,
  },
  organization: {
    planName: "Organization",
    monthlyRequests: 1500,
    monthlyTokens: 7500000,
  },
};

class RecordsAiUsageError extends Error {
  constructor(message, statusCode = 500, code = "records_ai_usage_error", details = {}) {
    super(message);
    this.name = "RecordsAiUsageError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

function getRecordsAiPlanLimits(planId) {
  return RECORDS_AI_PLAN_LIMITS[planId] || RECORDS_AI_PLAN_LIMITS.free;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString();
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function requireUsageConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new RecordsAiUsageError(
      "Records AI usage tracking is not configured yet.",
      500,
      "records_ai_usage_config_missing"
    );
  }
}

async function fetchSupabaseJson(url, options = {}) {
  const response = await fetch(url, options);
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
    const message = String(data?.message || data?.error || data?.msg || `Supabase request failed with status ${response.status}.`);
    const code = String(data?.code || "");
    throw new RecordsAiUsageError(message, response.status, "records_ai_usage_supabase_error", { code, data });
  }

  return data;
}

function wrapUsageStorageError(error) {
  const message = String(error?.message || "");
  const code = String(error?.details?.code || error?.code || "");
  if (code === "42P01" || message.toLowerCase().includes("records_ai_usage_events")) {
    return new RecordsAiUsageError(
      "Records AI usage tracking is not configured yet.",
      500,
      "records_ai_usage_table_missing"
    );
  }
  return error;
}

async function loadOrganization(organizationId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/organizations?select=id,name,owner_user_id,subscription_tier&id=eq.${encodeFilter(organizationId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function userCanAccessOrganization(organization, user, { allowPlatformAdmin = false } = {}) {
  if (!organization?.id || !user?.id) return false;
  const access = await getRecordsAccessContext(organization, user);
  return access.isMember || (allowPlatformAdmin && access.isPlatformAdmin) || contextAllows(access, "can_view_documents");
}

function getMonthBounds(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStart,
    periodEnd,
    periodStartIso: periodStart.toISOString(),
    periodEndIso: periodEnd.toISOString(),
  };
}

async function loadUsageSummary(organizationId, planId) {
  const limits = getRecordsAiPlanLimits(planId);
  const bounds = getMonthBounds();
  let rows = [];

  try {
    rows = await fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/records_ai_usage_events?select=total_tokens&organization_id=eq.${encodeFilter(organizationId)}&created_at=gte.${encodeFilter(bounds.periodStartIso)}&created_at=lt.${encodeFilter(bounds.periodEndIso)}&limit=5000`,
      { headers: serviceHeaders() }
    );
  } catch (error) {
    throw wrapUsageStorageError(error);
  }

  const events = Array.isArray(rows) ? rows : [];
  const tokensUsed = events.reduce((total, row) => total + Math.max(0, Number(row.total_tokens || 0)), 0);

  return {
    organizationId,
    planId,
    planName: limits.planName,
    periodStart: bounds.periodStartIso,
    periodEnd: bounds.periodEndIso,
    requestCount: events.length,
    tokenCount: tokensUsed,
    requestLimit: limits.monthlyRequests,
    tokenLimit: limits.monthlyTokens,
    requestsRemaining: Math.max(limits.monthlyRequests - events.length, 0),
    tokensRemaining: Math.max(limits.monthlyTokens - tokensUsed, 0),
  };
}

function assertUsageWithinLimits(summary) {
  if (summary.requestCount >= summary.requestLimit) {
    throw new RecordsAiUsageError(
      `This library has reached its ${formatNumber(summary.requestLimit)} Records AI requests for the ${summary.planName} plan this month.`,
      429,
      "records_ai_request_limit_reached",
      { usage: summary }
    );
  }

  if (summary.tokenCount >= summary.tokenLimit) {
    throw new RecordsAiUsageError(
      `This library has reached its Records AI monthly usage limit for the ${summary.planName} plan.`,
      429,
      "records_ai_token_limit_reached",
      { usage: summary }
    );
  }
}

async function prepareRecordsAiUsage({ organizationId, user, enforceLimit = true, allowPlatformAdmin = false }) {
  requireUsageConfig();
  const normalizedOrganizationId = String(organizationId || "").trim();
  if (!normalizedOrganizationId) {
    throw new RecordsAiUsageError("Choose an active library first.", 400, "records_ai_missing_organization");
  }

  const organization = await loadOrganization(normalizedOrganizationId);
  if (!organization) {
    throw new RecordsAiUsageError("Active library was not found.", 404, "records_ai_organization_not_found");
  }

  if (!(await userCanAccessOrganization(organization, user, { allowPlatformAdmin }))) {
    throw new RecordsAiUsageError("You do not have access to this library.", 403, "records_ai_organization_forbidden");
  }

  const summary = await loadUsageSummary(organization.id, organization.subscription_tier || "free");
  if (enforceLimit) assertUsageWithinLimits(summary);

  return {
    organization,
    usage: summary,
  };
}

function estimateTokensFromText(text) {
  const value = String(text || "");
  return Math.max(1, Math.ceil(value.length / 4));
}

function normalizeGroqUsage(data, fallbackPromptText = "", fallbackCompletionText = "") {
  const raw = data?.usage && typeof data.usage === "object" ? data.usage : {};
  const promptTokens = Math.max(0, Number(raw.prompt_tokens || raw.promptTokens || 0));
  const completionTokens = Math.max(0, Number(raw.completion_tokens || raw.completionTokens || 0));
  const totalTokens = Math.max(0, Number(raw.total_tokens || raw.totalTokens || 0));

  if (promptTokens || completionTokens || totalTokens) {
    return {
      promptTokens,
      completionTokens,
      totalTokens: totalTokens || promptTokens + completionTokens,
    };
  }

  const estimatedPromptTokens = estimateTokensFromText(fallbackPromptText);
  const estimatedCompletionTokens = estimateTokensFromText(fallbackCompletionText);
  return {
    promptTokens: estimatedPromptTokens,
    completionTokens: estimatedCompletionTokens,
    totalTokens: estimatedPromptTokens + estimatedCompletionTokens,
  };
}

async function recordRecordsAiUsage({ usageContext, user, feature, model, usage }) {
  if (!usageContext?.organization?.id) return null;
  const normalizedFeature = ["help", "search", "recording_notes"].includes(feature) ? feature : "help";
  const normalizedUsage = {
    prompt_tokens: Math.max(0, Number(usage?.promptTokens || 0)),
    completion_tokens: Math.max(0, Number(usage?.completionTokens || 0)),
    total_tokens: Math.max(0, Number(usage?.totalTokens || 0)),
  };

  try {
    const rows = await fetchSupabaseJson(`${SUPABASE_URL}/rest/v1/records_ai_usage_events`, {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify({
        organization_id: usageContext.organization.id,
        user_id: user?.id || null,
        feature: normalizedFeature,
        model: String(model || "").trim() || null,
        ...normalizedUsage,
      }),
    });

    const nextUsage = {
      ...usageContext.usage,
      requestCount: usageContext.usage.requestCount + 1,
      tokenCount: usageContext.usage.tokenCount + normalizedUsage.total_tokens,
    };
    nextUsage.requestsRemaining = Math.max(nextUsage.requestLimit - nextUsage.requestCount, 0);
    nextUsage.tokensRemaining = Math.max(nextUsage.tokenLimit - nextUsage.tokenCount, 0);

    return {
      event: Array.isArray(rows) ? rows[0] || null : null,
      usage: nextUsage,
    };
  } catch (error) {
    throw wrapUsageStorageError(error);
  }
}

function getClientUsageSummary(summary) {
  if (!summary) return null;
  return {
    organizationId: summary.organizationId,
    planId: summary.planId,
    planName: summary.planName,
    periodStart: summary.periodStart,
    periodEnd: summary.periodEnd,
    requestCount: summary.requestCount,
    requestLimit: summary.requestLimit,
    requestsRemaining: summary.requestsRemaining,
    tokenCount: summary.tokenCount,
    tokenLimit: summary.tokenLimit,
    tokensRemaining: summary.tokensRemaining,
  };
}

function sendRecordsAiUsageError(res, error, fallback = "Records AI usage check failed.") {
  if (!(error instanceof RecordsAiUsageError)) return false;
  return res.status(error.statusCode || 500).json({
    error: error.message || fallback,
    code: error.code || "records_ai_usage_error",
    usage: getClientUsageSummary(error.details?.usage),
  });
}

module.exports = {
  RECORDS_AI_PLAN_LIMITS,
  RecordsAiUsageError,
  getRecordsAiPlanLimits,
  getClientUsageSummary,
  loadUsageSummary,
  normalizeGroqUsage,
  prepareRecordsAiUsage,
  recordRecordsAiUsage,
  sendRecordsAiUsageError,
};
