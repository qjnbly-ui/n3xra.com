const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY).trim();

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanEmail(value) {
  return cleanString(value, 320).toLowerCase();
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
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
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service configuration.");
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

function getContactEmails(organization) {
  const metadata = organization?.metadata && typeof organization.metadata === "object" ? organization.metadata : {};
  return new Set([
    cleanEmail(organization?.primary_contact_email),
    cleanEmail(organization?.support_email),
    cleanEmail(metadata.finance_contact_email),
    cleanEmail(metadata.billing_contact_email),
  ].filter(Boolean));
}

function portalUrl(organization) {
  return organization?.slug ? `/utilities/portal/${encodeURIComponent(organization.slug)}` : "";
}

function workspaceUrl(organization) {
  return organization?.slug ? `/utilities/workspace?org=${encodeURIComponent(organization.slug)}` : "/utilities/workspace";
}

function first(rows) {
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function normalizeArray(value) {
  if (Array.isArray(value)) return value.map((item) => cleanString(item, 80)).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => cleanString(item, 80))
    .filter(Boolean);
}

function cleanHex(value) {
  const raw = cleanString(value, 7);
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
}

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
}

function stepOwner(step) {
  if (step?.locked) return "n3xra";
  if (["payment_setup", "dns_setup", "ready_to_launch", "portal_url"].includes(step?.step_key)) return "n3xra";
  return "utility";
}

function fallbackModules() {
  return [
    {
      module_key: "finish_onboarding",
      name: "Finish onboarding",
      description: "Complete setup tasks, review N3XRA launch items, and get the portal ready.",
      category: "setup",
      sort_order: 10,
      is_core: true,
      state: "enabled",
      metadata: { temporary: true },
      configuration: {},
    },
    {
      module_key: "customers",
      name: "Customer accounts",
      description: "Customer accounts, service addresses, contacts, account history, and portal access.",
      category: "customers",
      sort_order: 20,
      is_core: true,
      state: "coming_soon",
      metadata: { dashboard_card: true },
      configuration: {},
    },
    {
      module_key: "billing",
      name: "Billing & payments",
      description: "Invoices, balances, Stripe Connect payments, payouts, refunds, and billing settings.",
      category: "finance",
      sort_order: 30,
      is_core: false,
      state: "coming_soon",
      metadata: {},
      configuration: {},
    },
    {
      module_key: "service_requests",
      name: "Work orders",
      description: "Support tickets, work orders, outages, meter issues, move-ins, and move-outs.",
      category: "operations",
      sort_order: 40,
      is_core: true,
      state: "coming_soon",
      metadata: { dashboard_card: true },
      configuration: {},
    },
    {
      module_key: "documents",
      name: "Documents",
      description: "Customer files, forms, service agreements, notices, uploads, and records.",
      category: "compliance",
      sort_order: 50,
      is_core: true,
      state: "coming_soon",
      metadata: { dashboard_card: true },
      configuration: {},
    },
    {
      module_key: "communications",
      name: "Communications",
      description: "Email notices, announcements, alerts, reminders, and customer messaging.",
      category: "communications",
      sort_order: 60,
      is_core: true,
      state: "coming_soon",
      metadata: { dashboard_card: true },
      configuration: {},
    },
    {
      module_key: "n3xra_records",
      name: "N3XRA Records",
      description: "Documents, meeting records, board packets, and utility records.",
      category: "compliance",
      sort_order: 70,
      is_core: false,
      state: "enabled",
      metadata: {
        available: true,
        dashboard_card: true,
        dashboard_route: "/n3xra-records/library",
      },
      configuration: {},
    },
  ];
}

async function loadOrganizationModules(organizationId) {
  try {
    const [catalog, organizationModules] = await Promise.all([
      fetchSupabase("utility_module_catalog?select=*&order=sort_order.asc"),
      fetchSupabase(`utility_organization_modules?select=*&organization_id=eq.${encodeFilter(organizationId)}`),
    ]);
    if (!Array.isArray(catalog) || !catalog.length) return fallbackModules();
    const moduleByKey = new Map((organizationModules || []).map((module) => [module.module_key, module]));
    return catalog.map((module) => {
      const organizationModule = moduleByKey.get(module.module_key) || {};
      return {
        module_key: module.module_key,
        name: module.name,
        description: module.description,
        category: module.category,
        sort_order: module.sort_order,
        is_core: module.is_core,
        state: organizationModule.state || module.default_state || "requestable",
        requested_at: organizationModule.requested_at || null,
        enabled_at: organizationModule.enabled_at || null,
        configuration: organizationModule.configuration || {},
        metadata: {
          ...(module.metadata && typeof module.metadata === "object" ? module.metadata : {}),
          ...(organizationModule.metadata && typeof organizationModule.metadata === "object" ? organizationModule.metadata : {}),
        },
      };
    });
  } catch {
    return fallbackModules();
  }
}

async function getMembershipAccess(user) {
  const memberships = await fetchSupabase(
    `utility_organization_members?select=organization_id,status&user_id=eq.${encodeFilter(user.id)}&status=eq.active`
  );
  return new Map((memberships || []).map((row) => [row.organization_id, "member"]));
}

async function listAccessibleOrganizations(user) {
  const memberAccess = await getMembershipAccess(user);
  const memberIds = [...memberAccess.keys()];
  const memberOrganizations = memberIds.length
    ? await fetchSupabase(
        `utility_organizations?select=id,name,slug,status,launch_status,primary_contact_email,support_email,metadata&id=in.(${memberIds.map(encodeFilter).join(",")})&status=neq.archived`
      )
    : [];
  const allOrganizations = await fetchSupabase(
    "utility_organizations?select=id,name,slug,status,launch_status,primary_contact_email,support_email,metadata&status=neq.archived"
  );
  const email = cleanEmail(user.email);
  const contactOrganizations = (allOrganizations || []).filter((organization) => getContactEmails(organization).has(email));
  const byId = new Map();
  [...memberOrganizations, ...contactOrganizations].forEach((organization) => {
    if (!organization?.id) return;
    byId.set(organization.id, {
      ...organization,
      access_role: memberAccess.get(organization.id) || "contact",
    });
  });
  return [...byId.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
}

async function requireOrganizationAccess(user, requested) {
  const organizations = await listAccessibleOrganizations(user);
  if (!organizations.length) {
    const error = new Error("This account is not linked to a utility organization.");
    error.status = 403;
    throw error;
  }
  const requestValue = cleanString(requested, 120);
  return organizations.find((org) => org.id === requestValue || org.slug === requestValue) || organizations[0];
}

async function loadWorkspace(user, requestedOrg) {
  const organizations = await listAccessibleOrganizations(user);
  const summaryOrganization = requestedOrg
    ? organizations.find((org) => org.id === requestedOrg || org.slug === requestedOrg) || organizations[0]
    : organizations[0];

  if (!summaryOrganization) {
    return { organizations: [], organization: null };
  }

  const organizationId = summaryOrganization.id;
  const [organization, domains, branding, settings, steps, modules] = await Promise.all([
    first(await fetchSupabase(`utility_organizations?select=*&id=eq.${encodeFilter(organizationId)}&limit=1`)),
    fetchSupabase(`utility_organization_domains?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=is_primary.desc,created_at.asc`),
    first(await fetchSupabase(`utility_organization_branding?select=*&organization_id=eq.${encodeFilter(organizationId)}&limit=1`)),
    first(await fetchSupabase(`utility_organization_settings?select=*&organization_id=eq.${encodeFilter(organizationId)}&limit=1`)),
    fetchSupabase(`utility_portal_launch_steps?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=sort_order.asc`),
    loadOrganizationModules(organizationId),
  ]);

  const launchSteps = (steps || []).map((step) => ({ ...step, owner: stepOwner(step) }));
  const required = launchSteps.filter((step) => step.required);
  const utilitySteps = launchSteps.filter((step) => step.owner === "utility");
  const n3xraSteps = launchSteps.filter((step) => step.owner === "n3xra");
  return {
    user: { id: user.id, email: user.email },
    organizations: organizations.map((org) => ({ id: org.id, name: org.name, slug: org.slug, access_role: org.access_role })),
    organization: { ...organization, domains: domains || [], access_role: summaryOrganization.access_role },
    branding,
    settings,
    modules,
    launch_steps: launchSteps,
    progress: {
      required_total: required.length,
      required_completed: required.filter((step) => step.status === "completed").length,
      utility_total: utilitySteps.length,
      utility_completed: utilitySteps.filter((step) => step.status === "completed").length,
      n3xra_total: n3xraSteps.length,
      n3xra_completed: n3xraSteps.filter((step) => step.status === "completed").length,
    },
    portal_url: portalUrl(organization),
    workspace_url: workspaceUrl(organization),
  };
}

async function requestModule(user, body) {
  const org = await requireOrganizationAccess(user, body.organization_id || body.organizationId || body.slug);
  const moduleKey = cleanString(body.module_key || body.moduleKey, 80);
  if (!moduleKey) {
    const error = new Error("Module key is required.");
    error.status = 400;
    throw error;
  }
  const module = first(await fetchSupabase(`utility_organization_modules?select=*&organization_id=eq.${encodeFilter(org.id)}&module_key=eq.${encodeFilter(moduleKey)}&limit=1`));
  if (!module) {
    const error = new Error("Module is not available for this organization yet.");
    error.status = 404;
    throw error;
  }
  if (module.state !== "requestable") {
    const error = new Error("This module cannot be requested from its current state.");
    error.status = 400;
    throw error;
  }
  const rows = await fetchSupabase(`utility_organization_modules?id=eq.${encodeFilter(module.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      state: "requires_n3xra_setup",
      requested_by_user_id: user.id,
      requested_at: new Date().toISOString(),
    }),
  });
  return first(rows);
}

async function updateModuleState(user, body) {
  const org = await requireOrganizationAccess(user, body.organization_id || body.organizationId || body.slug);
  const moduleKey = cleanString(body.module_key || body.moduleKey, 80);
  const enabled = Boolean(body.enabled);
  if (!moduleKey) {
    const error = new Error("Module key is required.");
    error.status = 400;
    throw error;
  }
  const module = first(await fetchSupabase(`utility_organization_modules?select=*&organization_id=eq.${encodeFilter(org.id)}&module_key=eq.${encodeFilter(moduleKey)}&limit=1`));
  if (!module) {
    const error = new Error("Module is not available for this organization yet.");
    error.status = 404;
    throw error;
  }
  if (!["enabled", "disabled"].includes(module.state)) {
    const error = new Error("This module is not ready for direct activation yet.");
    error.status = 400;
    throw error;
  }
  const rows = await fetchSupabase(`utility_organization_modules?id=eq.${encodeFilter(module.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      state: enabled ? "enabled" : "disabled",
      enabled_at: enabled ? new Date().toISOString() : null,
    }),
  });
  return first(rows);
}

async function updateProfile(user, body) {
  const org = await requireOrganizationAccess(user, body.organization_id || body.organizationId || body.slug);
  const existing = first(await fetchSupabase(`utility_organizations?select=metadata&id=eq.${encodeFilter(org.id)}&limit=1`)) || {};
  const metadata = existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {};
  const updates = {
    name: cleanString(body.name, 180) || org.name,
    legal_name: cleanString(body.legal_name || body.legalName, 220) || null,
    primary_contact_name: cleanString(body.primary_contact_name || body.primaryContactName, 180) || null,
    primary_contact_email: cleanEmail(body.primary_contact_email || body.primaryContactEmail) || null,
    primary_contact_phone: cleanString(body.primary_contact_phone || body.primaryContactPhone, 80) || null,
    support_email: cleanEmail(body.support_email || body.supportEmail) || null,
    support_phone: cleanString(body.support_phone || body.supportPhone, 80) || null,
    website: cleanString(body.website, 240) || null,
    metadata: {
      ...metadata,
      finance_contact_name: cleanString(body.finance_contact_name || body.financeContactName, 180) || null,
      finance_contact_email: cleanEmail(body.finance_contact_email || body.financeContactEmail) || null,
      finance_contact_phone: cleanString(body.finance_contact_phone || body.financeContactPhone, 80) || null,
    },
  };
  const rows = await fetchSupabase(`utility_organizations?id=eq.${encodeFilter(org.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return first(rows);
}

async function updateBranding(user, body) {
  const org = await requireOrganizationAccess(user, body.organization_id || body.organizationId || body.slug);
  const updates = {
    portal_display_name: cleanString(body.portal_display_name || body.portalDisplayName, 180) || null,
    primary_color: cleanHex(body.primary_color || body.primaryColor),
    secondary_color: cleanHex(body.secondary_color || body.secondaryColor),
    accent_color: cleanHex(body.accent_color || body.accentColor),
    email_reply_to: cleanEmail(body.email_reply_to || body.emailReplyTo) || null,
  };
  const rows = await fetchSupabase(`utility_organization_branding?organization_id=eq.${encodeFilter(org.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return first(rows);
}

async function updateSettings(user, body) {
  const org = await requireOrganizationAccess(user, body.organization_id || body.organizationId || body.slug);
  const existing = first(await fetchSupabase(`utility_organization_settings?select=modules,payment_preferences,notification_settings,launch_checklist,metadata&organization_id=eq.${encodeFilter(org.id)}&limit=1`)) || {};
  const modules = existing.modules && typeof existing.modules === "object" ? existing.modules : {};
  const updates = {
    service_types: normalizeArray(body.service_types || body.serviceTypes),
    modules: {
      ...modules,
      customer_portal: body.customer_portal !== false,
      support_requests: body.support_requests !== false,
      document_uploads: body.document_uploads !== false,
      announcements: body.announcements !== false,
    },
  };
  const rows = await fetchSupabase(`utility_organization_settings?organization_id=eq.${encodeFilter(org.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return first(rows);
}

async function updateUtilityStep(user, body) {
  const org = await requireOrganizationAccess(user, body.organization_id || body.organizationId || body.slug);
  const stepId = cleanString(body.step_id || body.stepId, 80);
  const status = cleanString(body.status, 40);
  if (!["not_started", "in_progress", "completed", "skipped", "blocked"].includes(status)) {
    const error = new Error("Invalid step status.");
    error.status = 400;
    throw error;
  }
  const step = first(await fetchSupabase(`utility_portal_launch_steps?select=*&id=eq.${encodeFilter(stepId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!step || stepOwner(step) !== "utility") {
    const error = new Error("This setup step is managed by N3XRA.");
    error.status = 403;
    throw error;
  }
  const rows = await fetchSupabase(`utility_portal_launch_steps?id=eq.${encodeFilter(stepId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status,
      completed_at: status === "completed" ? new Date().toISOString() : null,
      completed_by_user_id: status === "completed" ? user.id : null,
    }),
  });
  return first(rows);
}

module.exports = async function handler(req, res) {
  try {
    const user = await verifyUser(getBearerToken(req));
    if (req.method === "GET") {
      const org = cleanString(req.query?.org, 120);
      return res.status(200).json({ ok: true, workspace: await loadWorkspace(user, org) });
    }
    if (req.method !== "PATCH") {
      res.setHeader("Allow", "GET, PATCH");
      return res.status(405).json({ error: "Method not allowed." });
    }

    const body = parseBody(req);
    const action = cleanString(body.action, 80);
    if (action === "update-profile") return res.status(200).json({ ok: true, organization: await updateProfile(user, body) });
    if (action === "update-branding") return res.status(200).json({ ok: true, branding: await updateBranding(user, body) });
    if (action === "update-settings") return res.status(200).json({ ok: true, settings: await updateSettings(user, body) });
    if (action === "update-step") return res.status(200).json({ ok: true, step: await updateUtilityStep(user, body) });
    if (action === "request-module") return res.status(200).json({ ok: true, module: await requestModule(user, body) });
    if (action === "update-module-state") return res.status(200).json({ ok: true, module: await updateModuleState(user, body) });
    return res.status(400).json({ error: "Unknown workspace action." });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      error: error instanceof Error ? error.message : "Utilities workspace request failed.",
    });
  }
};
