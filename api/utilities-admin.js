const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY).trim();
const PLATFORM_ADMIN_EMAILS = new Set(["quentin@n3xra.com", "quentin@quentinnichols.com"]);

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function sendJson(res, status, payload) {
  return res.status(status).json(payload);
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function fetchJson(url, options = {}) {
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
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }

  return data;
}

async function fetchSupabase(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase service configuration.");
  }

  return fetchJson(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(options.headers || {}),
  });
}

async function verifyUser(token) {
  if (!token) {
    const error = new Error("Authentication required.");
    error.status = 401;
    throw error;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("Missing Supabase auth configuration.");
  }

  const user = await fetchJson(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });

  if (!user?.id) {
    const error = new Error("Invalid Supabase session.");
    error.status = 401;
    throw error;
  }
  return user;
}

async function requirePlatformAdmin(req) {
  const user = await verifyUser(getBearerToken(req));
  const email = cleanString(user.email, 320).toLowerCase();
  if (PLATFORM_ADMIN_EMAILS.has(email)) return user;

  const rows = await fetchSupabase(`platform_admins?select=user_id&user_id=eq.${encodeFilter(user.id)}&limit=1`);
  if (Array.isArray(rows) && rows.length) return user;

  const error = new Error("N3XRA platform admin access required.");
  error.status = 403;
  throw error;
}

function groupByOrganization(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    const organizationId = row.organization_id;
    if (!organizationId) return;
    if (!map.has(organizationId)) map.set(organizationId, []);
    map.get(organizationId).push(row);
  });
  return map;
}

function firstByOrganization(rows = []) {
  const map = new Map();
  rows.forEach((row) => {
    if (row.organization_id && !map.has(row.organization_id)) map.set(row.organization_id, row);
  });
  return map;
}

async function listOrganizations() {
  const [organizations, domains, branding, settings, launchSteps, onboardingSessions] = await Promise.all([
    fetchSupabase("utility_organizations?select=*&order=created_at.desc"),
    fetchSupabase("utility_organization_domains?select=*&order=is_primary.desc,created_at.asc"),
    fetchSupabase("utility_organization_branding?select=*"),
    fetchSupabase("utility_organization_settings?select=*"),
    fetchSupabase("utility_portal_launch_steps?select=*&order=sort_order.asc"),
    fetchSupabase("utility_onboarding_sessions?select=*&order=created_at.desc"),
  ]);

  const domainsByOrg = groupByOrganization(domains);
  const stepsByOrg = groupByOrganization(launchSteps);
  const brandingByOrg = firstByOrganization(branding);
  const settingsByOrg = firstByOrganization(settings);
  const onboardingByOrg = firstByOrganization(onboardingSessions);

  return (organizations || []).map((organization) => {
    const steps = stepsByOrg.get(organization.id) || [];
    const requiredSteps = steps.filter((step) => step.required);
    const completedRequired = requiredSteps.filter((step) => step.status === "completed");
    return {
      ...organization,
      domains: domainsByOrg.get(organization.id) || [],
      branding: brandingByOrg.get(organization.id) || null,
      settings: settingsByOrg.get(organization.id) || null,
      launch_steps: steps,
      onboarding_session: onboardingByOrg.get(organization.id) || null,
      launch_progress: {
        required_total: requiredSteps.length,
        required_completed: completedRequired.length,
        all_total: steps.length,
        all_completed: steps.filter((step) => step.status === "completed").length,
      },
    };
  });
}

function assertOneOf(value, allowed, label) {
  const cleanValue = cleanString(value, 80);
  if (!allowed.includes(cleanValue)) {
    const error = new Error(`Invalid ${label}.`);
    error.status = 400;
    throw error;
  }
  return cleanValue;
}

async function updateOrganization(body) {
  const organizationId = cleanString(body.organization_id || body.organizationId, 80);
  if (!organizationId) {
    const error = new Error("Missing organization_id.");
    error.status = 400;
    throw error;
  }

  const updates = {};
  if (body.status !== undefined) {
    updates.status = assertOneOf(body.status, ["onboarding", "implementation", "active", "paused", "archived"], "organization status");
  }
  if (body.launch_status !== undefined || body.launchStatus !== undefined) {
    updates.launch_status = assertOneOf(body.launch_status || body.launchStatus, ["draft", "setup", "review", "ready", "live", "disabled"], "launch status");
  }
  if (!Object.keys(updates).length) {
    const error = new Error("No organization updates provided.");
    error.status = 400;
    throw error;
  }

  const rows = await fetchSupabase(`utility_organizations?id=eq.${encodeFilter(organizationId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function updateLaunchStep(body, user) {
  const stepId = cleanString(body.step_id || body.stepId, 80);
  const status = assertOneOf(body.status, ["not_started", "in_progress", "completed", "skipped", "blocked"], "step status");
  if (!stepId) {
    const error = new Error("Missing step_id.");
    error.status = 400;
    throw error;
  }

  const updates = {
    status,
    completed_at: status === "completed" ? new Date().toISOString() : null,
    completed_by_user_id: status === "completed" ? user.id : null,
  };

  const rows = await fetchSupabase(`utility_portal_launch_steps?id=eq.${encodeFilter(stepId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

export default async function handler(req, res) {
  try {
    const user = await requirePlatformAdmin(req);

    if (req.method === "GET") {
      return sendJson(res, 200, { ok: true, organizations: await listOrganizations() });
    }

    if (req.method !== "PATCH") {
      res.setHeader("Allow", "GET, PATCH");
      return sendJson(res, 405, { error: "Method not allowed." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const action = cleanString(body.action, 80);
    if (action === "update-organization") {
      return sendJson(res, 200, { ok: true, organization: await updateOrganization(body) });
    }
    if (action === "update-launch-step") {
      return sendJson(res, 200, { ok: true, step: await updateLaunchStep(body, user) });
    }

    return sendJson(res, 400, { error: "Unknown utilities admin action." });
  } catch (error) {
    return sendJson(res, error?.status || 500, {
      error: error instanceof Error ? error.message : "Utilities admin request failed.",
    });
  }
}
