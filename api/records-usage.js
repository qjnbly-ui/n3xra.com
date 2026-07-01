const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SERVICE_ROLE_KEY ||
  ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

const PLAN_LIMITS = {
  free: {
    planName: "Free",
    documentLimit: 25,
    userLimit: 1,
    storageLimitMb: 1024,
    aiMonthlyRequestLimit: 20,
    aiMonthlyTokenLimit: 100000,
  },
  starter: {
    planName: "Starter",
    documentLimit: 1000,
    userLimit: 1,
    storageLimitMb: 10240,
    aiMonthlyRequestLimit: 300,
    aiMonthlyTokenLimit: 1500000,
  },
  organization: {
    planName: "Organization",
    documentLimit: 10000,
    userLimit: 15,
    storageLimitMb: 51200,
    aiMonthlyRequestLimit: 1500,
    aiMonthlyTokenLimit: 7500000,
  },
};

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchSupabaseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || `Supabase request failed with status ${response.status}.`));
  }
  return data;
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase auth config.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error("Invalid session.");
  return data;
}

function getOrganizationId(req) {
  const direct = req.query && typeof req.query.organizationId === "string" ? req.query.organizationId : "";
  if (direct) return direct.trim();
  const url = new URL(req.url || "/", `https://${req.headers.host || "n3xra.com"}`);
  return String(url.searchParams.get("organizationId") || "").trim();
}

function getMonthBounds(now = new Date()) {
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    periodStartIso: periodStart.toISOString(),
    periodEndIso: periodEnd.toISOString(),
  };
}

function getPlanLimits(organization) {
  const planId = String(organization?.subscription_tier || "free").trim().toLowerCase();
  const defaults = PLAN_LIMITS[planId] || PLAN_LIMITS.free;
  return {
    planId,
    planName: defaults.planName,
    documentLimit: Math.max(0, Number(organization?.document_limit || defaults.documentLimit)),
    userLimit: Math.max(0, Number(organization?.user_limit || defaults.userLimit)),
    storageLimitMb: Math.max(0, Number(organization?.storage_limit_mb || defaults.storageLimitMb)),
    aiMonthlyRequestLimit: defaults.aiMonthlyRequestLimit,
    aiMonthlyTokenLimit: defaults.aiMonthlyTokenLimit,
  };
}

function sumFileSize(rows) {
  return (Array.isArray(rows) ? rows : []).reduce((sum, row) => sum + Math.max(0, Number(row.file_size || 0)), 0);
}

function buildMetric(used, limit) {
  const normalizedUsed = Math.max(0, Number(used || 0));
  const normalizedLimit = Math.max(0, Number(limit || 0));
  return {
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining: Math.max(normalizedLimit - normalizedUsed, 0),
    over: normalizedLimit > 0 && normalizedUsed > normalizedLimit,
    percent: normalizedLimit > 0 ? Math.min(100, Math.round((normalizedUsed / normalizedLimit) * 100)) : 0,
  };
}

async function loadOrganization(organizationId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/organizations?select=id,name,owner_user_id,subscription_tier,account_status,document_limit,storage_limit_mb,user_limit&id=eq.${encodeFilter(organizationId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function userCanAccessOrganization(organization, user) {
  if (!organization?.id || !user?.id) return false;
  if (organization.owner_user_id === user.id) return true;

  const [membershipRows, adminRows] = await Promise.all([
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/organization_memberships?select=id&organization_id=eq.${encodeFilter(organization.id)}&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/platform_admins?select=user_id&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    ),
  ]);

  return Boolean(
    (Array.isArray(membershipRows) && membershipRows.length > 0) ||
    (Array.isArray(adminRows) && adminRows.length > 0)
  );
}

async function loadRecordsUsage(organization) {
  const bounds = getMonthBounds();
  const encodedOrgId = encodeFilter(organization.id);
  const [
    documentRows,
    appDocumentRows,
    recordingRows,
    memberRows,
    aiRows,
  ] = await Promise.all([
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/documents?select=id,file_size&organization_id=eq.${encodedOrgId}&limit=50000`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/app_documents?select=id,document_kind&organization_id=eq.${encodedOrgId}&limit=50000`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/meeting_recordings?select=id,file_size,storage_path&organization_id=eq.${encodedOrgId}&limit=50000`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/organization_memberships?select=id&organization_id=eq.${encodedOrgId}&limit=50000`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/records_ai_usage_events?select=id,total_tokens&organization_id=eq.${encodedOrgId}&created_at=gte.${encodeFilter(bounds.periodStartIso)}&created_at=lt.${encodeFilter(bounds.periodEndIso)}&limit=50000`,
      { headers: serviceHeaders() }
    ),
  ]);

  const limits = getPlanLimits(organization);
  const sourceDocumentCount = Array.isArray(documentRows) ? documentRows.length : 0;
  const appDocumentCount = Array.isArray(appDocumentRows) ? appDocumentRows.filter((row) => row.document_kind !== "template").length : 0;
  const templateCount = Array.isArray(appDocumentRows) ? appDocumentRows.filter((row) => row.document_kind === "template").length : 0;
  const recordingCount = Array.isArray(recordingRows) ? recordingRows.length : 0;
  const memberCount = Array.isArray(memberRows) ? memberRows.length : 0;
  const aiRequestCount = Array.isArray(aiRows) ? aiRows.length : 0;
  const aiTokenCount = (Array.isArray(aiRows) ? aiRows : []).reduce((sum, row) => sum + Math.max(0, Number(row.total_tokens || 0)), 0);
  const documentStorageBytes = sumFileSize(documentRows);
  const recordingStorageBytes = sumFileSize(recordingRows);
  const storageLimitBytes = limits.storageLimitMb * 1024 * 1024;

  return {
    organizationId: organization.id,
    planId: limits.planId,
    planName: limits.planName,
    accountStatus: organization.account_status || "active",
    periodStart: bounds.periodStartIso,
    periodEnd: bounds.periodEndIso,
    limits: {
      documents: limits.documentLimit,
      users: limits.userLimit,
      storageMb: limits.storageLimitMb,
      storageBytes: storageLimitBytes,
      aiRequests: limits.aiMonthlyRequestLimit,
      aiTokens: limits.aiMonthlyTokenLimit,
    },
    used: {
      sourceDocuments: sourceDocumentCount,
      appDocuments: appDocumentCount,
      templates: templateCount,
      recordings: recordingCount,
      users: memberCount,
      storageBytes: documentStorageBytes + recordingStorageBytes,
      documentStorageBytes,
      recordingStorageBytes,
      aiRequests: aiRequestCount,
      aiTokens: aiTokenCount,
    },
    metrics: {
      documents: buildMetric(sourceDocumentCount, limits.documentLimit),
      users: buildMetric(memberCount, limits.userLimit),
      storage: buildMetric(documentStorageBytes + recordingStorageBytes, storageLimitBytes),
      aiRequests: buildMetric(aiRequestCount, limits.aiMonthlyRequestLimit),
      aiTokens: buildMetric(aiTokenCount, limits.aiMonthlyTokenLimit),
    },
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Records usage tracking is not configured yet." });
  }

  let user = null;
  try {
    user = await verifyUser(getBearerToken(req));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication required." });
  }

  try {
    const organizationId = getOrganizationId(req);
    if (!organizationId) return res.status(400).json({ error: "Choose an active library first." });

    const organization = await loadOrganization(organizationId);
    if (!organization) return res.status(404).json({ error: "Active library was not found." });
    if (!(await userCanAccessOrganization(organization, user))) {
      return res.status(403).json({ error: "You do not have access to this library." });
    }

    const usage = await loadRecordsUsage(organization);
    return res.status(200).json({ usage });
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Unable to load Records usage." });
  }
};
