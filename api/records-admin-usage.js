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
  free: { planName: "Free", documentLimit: 25, userLimit: 1, storageLimitMb: 1024, aiMonthlyRequestLimit: 20 },
  starter: { planName: "Starter", documentLimit: 1000, userLimit: 1, storageLimitMb: 10240, aiMonthlyRequestLimit: 300 },
  organization: { planName: "Organization", documentLimit: 10000, userLimit: 15, storageLimitMb: 51200, aiMonthlyRequestLimit: 1500 },
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

async function fetchSupabaseJson(path, options = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, options);
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

async function requirePlatformAdmin(user) {
  const rows = await fetchSupabaseJson(
    `platform_admins?select=user_id&user_id=eq.${encodeFilter(user.id)}&limit=1`,
    { headers: serviceHeaders() }
  );
  if (!Array.isArray(rows) || !rows.length) {
    const error = new Error("Platform admin access required.");
    error.status = 403;
    throw error;
  }
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
  };
}

function buildMetric(used, limit) {
  const normalizedUsed = Math.max(0, Number(used || 0));
  const normalizedLimit = Math.max(0, Number(limit || 0));
  return {
    used: normalizedUsed,
    limit: normalizedLimit,
    remaining: Math.max(normalizedLimit - normalizedUsed, 0),
    over: normalizedLimit > 0 && normalizedUsed > normalizedLimit,
    near: normalizedLimit > 0 && normalizedUsed >= normalizedLimit * 0.8 && normalizedUsed <= normalizedLimit,
    percent: normalizedLimit > 0 ? Math.min(100, Math.round((normalizedUsed / normalizedLimit) * 100)) : 0,
  };
}

function maxIso(current, candidate) {
  if (!candidate) return current || "";
  if (!current) return candidate;
  return new Date(candidate).getTime() > new Date(current).getTime() ? candidate : current;
}

function ensureUsage(summaryMap, organizationId) {
  if (!summaryMap.has(organizationId)) {
    summaryMap.set(organizationId, {
      sourceDocuments: 0,
      appDocuments: 0,
      templates: 0,
      storageBytes: 0,
      users: 0,
      recordings: 0,
      aiRequests: 0,
      aiTokens: 0,
      lastActiveAt: "",
    });
  }
  return summaryMap.get(organizationId);
}

function getFlags(metrics) {
  return Object.entries(metrics).flatMap(([key, metric]) => {
    const labels = {
      aiRequests: "AI",
      users: "Seats",
      documents: "Documents",
      storage: "Storage",
    };
    const label = labels[key] || key.charAt(0).toUpperCase() + key.slice(1);
    if (metric.over) return [`${label} over`];
    if (metric.near) return [`${label} near`];
    return [];
  });
}

async function buildAdminUsage() {
  const bounds = getMonthBounds();
  const [
    organizationRows,
    membershipRows,
    documentRows,
    appDocumentRows,
    recordingRows,
    aiRows,
    profileRows,
  ] = await Promise.all([
    fetchSupabaseJson(
      "organizations?select=id,name,owner_user_id,subscription_tier,account_status,document_limit,user_limit,storage_limit_mb,created_at&order=name.asc&limit=50000",
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson("organization_memberships?select=organization_id,user_id,created_at&limit=50000", { headers: serviceHeaders() }),
    fetchSupabaseJson("documents?select=id,organization_id,file_size,created_at&limit=50000", { headers: serviceHeaders() }),
    fetchSupabaseJson("app_documents?select=id,organization_id,document_kind,created_at,updated_at&limit=50000", { headers: serviceHeaders() }),
    fetchSupabaseJson("meeting_recordings?select=id,organization_id,file_size,created_at,notes_updated_at&limit=50000", { headers: serviceHeaders() }),
    fetchSupabaseJson(
      `records_ai_usage_events?select=id,organization_id,total_tokens,created_at&created_at=gte.${encodeFilter(bounds.periodStartIso)}&created_at=lt.${encodeFilter(bounds.periodEndIso)}&limit=50000`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson("profiles?select=id,email,full_name&limit=50000", { headers: serviceHeaders() }),
  ]);

  const usageMap = new Map();
  const profileMap = new Map((Array.isArray(profileRows) ? profileRows : []).map((profile) => [profile.id, profile]));

  (Array.isArray(organizationRows) ? organizationRows : []).forEach((organization) => {
    const usage = ensureUsage(usageMap, organization.id);
    usage.lastActiveAt = maxIso(usage.lastActiveAt, organization.created_at);
  });

  (Array.isArray(membershipRows) ? membershipRows : []).forEach((row) => {
    const usage = ensureUsage(usageMap, row.organization_id);
    usage.users += 1;
    usage.lastActiveAt = maxIso(usage.lastActiveAt, row.created_at);
  });

  (Array.isArray(documentRows) ? documentRows : []).forEach((row) => {
    const usage = ensureUsage(usageMap, row.organization_id);
    usage.sourceDocuments += 1;
    usage.storageBytes += Math.max(0, Number(row.file_size || 0));
    usage.lastActiveAt = maxIso(usage.lastActiveAt, row.created_at);
  });

  (Array.isArray(appDocumentRows) ? appDocumentRows : []).forEach((row) => {
    const usage = ensureUsage(usageMap, row.organization_id);
    if (row.document_kind === "template") usage.templates += 1;
    else usage.appDocuments += 1;
    usage.lastActiveAt = maxIso(usage.lastActiveAt, row.updated_at || row.created_at);
  });

  (Array.isArray(recordingRows) ? recordingRows : []).forEach((row) => {
    const usage = ensureUsage(usageMap, row.organization_id);
    usage.recordings += 1;
    usage.storageBytes += Math.max(0, Number(row.file_size || 0));
    usage.lastActiveAt = maxIso(usage.lastActiveAt, row.notes_updated_at || row.created_at);
  });

  (Array.isArray(aiRows) ? aiRows : []).forEach((row) => {
    const usage = ensureUsage(usageMap, row.organization_id);
    usage.aiRequests += 1;
    usage.aiTokens += Math.max(0, Number(row.total_tokens || 0));
    usage.lastActiveAt = maxIso(usage.lastActiveAt, row.created_at);
  });

  const accounts = (Array.isArray(organizationRows) ? organizationRows : []).map((organization) => {
    const limits = getPlanLimits(organization);
    const usage = ensureUsage(usageMap, organization.id);
    const metrics = {
      storage: buildMetric(usage.storageBytes, limits.storageLimitMb * 1024 * 1024),
      documents: buildMetric(usage.sourceDocuments, limits.documentLimit),
      aiRequests: buildMetric(usage.aiRequests, limits.aiMonthlyRequestLimit),
      users: buildMetric(usage.users, limits.userLimit),
    };
    const owner = profileMap.get(organization.owner_user_id) || null;

    return {
      id: organization.id,
      name: organization.name || "Records library",
      ownerEmail: owner?.email || "",
      planId: limits.planId,
      planName: limits.planName,
      accountStatus: organization.account_status || "active",
      usage: {
        ...usage,
      },
      limits: {
        storageBytes: limits.storageLimitMb * 1024 * 1024,
        documents: limits.documentLimit,
        aiRequests: limits.aiMonthlyRequestLimit,
        users: limits.userLimit,
      },
      metrics,
      flags: getFlags(metrics),
    };
  });

  accounts.sort((a, b) => {
    const aFlagged = a.flags.length ? 1 : 0;
    const bFlagged = b.flags.length ? 1 : 0;
    if (aFlagged !== bFlagged) return bFlagged - aFlagged;
    return new Date(b.usage.lastActiveAt || 0).getTime() - new Date(a.usage.lastActiveAt || 0).getTime();
  });

  return {
    periodStart: bounds.periodStartIso,
    periodEnd: bounds.periodEndIso,
    accounts,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Records admin usage is not configured yet." });
  }

  try {
    const user = await verifyUser(getBearerToken(req));
    await requirePlatformAdmin(user);
    return res.status(200).json({ usage: await buildAdminUsage() });
  } catch (error) {
    const status = Number(error?.status || 500);
    return res.status(status).json({ error: error instanceof Error ? error.message : "Unable to load admin usage overview." });
  }
};
