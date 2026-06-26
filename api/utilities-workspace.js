const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const SUPABASE_ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || SUPABASE_SERVICE_ROLE_KEY).trim();
const ORGANIZATION_ASSETS_BUCKET = "organization-assets";
const RESEND_FROM_EMAIL = String(process.env.UTILITIES_INVITE_FROM_EMAIL || process.env.RESEND_FROM_EMAIL || "noreply@n3xra.com").trim();

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanEmail(value) {
  return cleanString(value, 320).toLowerCase();
}

function cleanNumber(value, fallback = null) {
  const raw = String(value ?? "").replace(/[$,\s]/g, "").trim();
  if (!raw) return fallback;
  const number = Number(raw);
  return Number.isFinite(number) ? number : fallback;
}

function cleanPeriod(value) {
  const raw = cleanString(value, 20);
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  const date = new Date(raw);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  return "";
}

function cleanDate(value) {
  const raw = cleanString(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function encodeStoragePath(path) {
  return String(path || "").split("/").map(encodeURIComponent).join("/");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
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

async function upsertSupabase(table, onConflict, payload) {
  const rows = await fetchSupabase(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify(payload),
  });
  return first(rows);
}

async function insertAuditEvent(organizationId, userId, eventType, targetTable, targetId, metadata = {}) {
  try {
    await fetchSupabase("utility_audit_events", {
      method: "POST",
      body: JSON.stringify({
        organization_id: organizationId,
        actor_user_id: userId,
        actor_type: "utility_member",
        event_type: eventType,
        target_table: targetTable,
        target_id: targetId,
        metadata,
      }),
    });
  } catch {
    // Audit logging should not block the primary workspace action.
  }
}

function getRequestOrigin(req) {
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const host = req.headers?.host || "www.n3xra.com";
  return `${proto}://${host}`;
}

function toAbsoluteStorageUrl(raw) {
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith("/")) return `${SUPABASE_URL}/storage/v1${raw}`;
  return `${SUPABASE_URL}/storage/v1/${raw}`;
}

async function createSignedAssetUrl(storagePath) {
  if (!storagePath) return null;
  const response = await fetch(
    `${SUPABASE_URL}/storage/v1/object/sign/${encodeURIComponent(ORGANIZATION_ASSETS_BUCKET)}/${encodeStoragePath(storagePath)}`,
    {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ expiresIn: 60 * 60 * 24 * 7 }),
    }
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return null;
  return toAbsoluteStorageUrl(data?.signedURL || data?.signedUrl || data?.url || "") || null;
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

function normalizeRoleName(value) {
  return cleanString(value, 40).toLowerCase().replaceAll("-", "_");
}

function normalizeInviteCode(value) {
  return cleanString(value, 32).toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function createInviteCode() {
  return crypto.randomBytes(7).toString("hex").toUpperCase();
}

function inviteStatus(invite) {
  if (invite?.revoked_at) return "revoked";
  if (Number(invite?.redeemed_uses || 0) >= Number(invite?.max_uses || 1)) return "used";
  if (invite?.expires_at && new Date(invite.expires_at).getTime() < Date.now()) return "expired";
  return "active";
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
      description: "Customer search, account profiles, service addresses, meters, readings, and account history.",
      category: "customers",
      sort_order: 20,
      is_core: true,
      state: "enabled",
      metadata: {
        available: true,
        dashboard_card: true,
        dashboard_route: "/utilities/workspace/customers/",
      },
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

const readyModuleOverrides = {
  customers: {
    description: "Customer search, account profiles, service addresses, meters, readings, and account history.",
    dashboard_route: "/utilities/workspace/customers/",
  },
  meter_billing: {
    dashboard_route: "/utilities/workspace/meter-billing/",
  },
};

function applyReadyModuleOverride(module) {
  const override = readyModuleOverrides[module?.module_key];
  if (!override) return module;
  const inactiveStates = new Set(["coming_soon", "requestable", "requires_n3xra_setup"]);
  return {
    ...module,
    description: override.description || module.description,
    state: inactiveStates.has(module.state) ? "enabled" : module.state,
    metadata: {
      ...(module.metadata && typeof module.metadata === "object" ? module.metadata : {}),
      available: true,
      dashboard_card: true,
      dashboard_route: override.dashboard_route,
    },
  };
}

async function loadOrganizationModules(organizationId) {
  try {
    const [catalog, organizationModules] = await Promise.all([
      fetchSupabase("utility_module_catalog?select=*&order=sort_order.asc"),
      fetchSupabase(`utility_organization_modules?select=*&organization_id=eq.${encodeFilter(organizationId)}`),
    ]);
    if (!Array.isArray(catalog) || !catalog.length) return fallbackModules().map(applyReadyModuleOverride);
    const moduleByKey = new Map((organizationModules || []).map((module) => [module.module_key, module]));
    return catalog.map((module) => {
      const organizationModule = moduleByKey.get(module.module_key) || {};
      return applyReadyModuleOverride({
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
      });
    });
  } catch {
    return fallbackModules().map(applyReadyModuleOverride);
  }
}

async function loadMeterBilling(organizationId, selectedRunId = "") {
  try {
    const [templates, runs] = await Promise.all([
      fetchSupabase(`utility_import_templates?select=*&organization_id=eq.${encodeFilter(organizationId)}&import_type=eq.meter_readings&order=updated_at.desc&limit=12`),
      fetchSupabase(`utility_billing_runs?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=created_at.desc&limit=24`),
    ]);
    const requestedRun = cleanString(selectedRunId, 80)
      ? first(await fetchSupabase(`utility_billing_runs?select=*&id=eq.${encodeFilter(selectedRunId)}&organization_id=eq.${encodeFilter(organizationId)}&limit=1`))
      : null;
    const activeRun = requestedRun || first(runs);
    const [items, exports] = activeRun
      ? await Promise.all([
          fetchSupabase(`utility_billing_run_items?select=*&billing_run_id=eq.${encodeFilter(activeRun.id)}&order=overage_amount.desc&limit=500`),
          fetchSupabase(`utility_billing_exports?select=*&billing_run_id=eq.${encodeFilter(activeRun.id)}&order=created_at.desc&limit=5`),
        ])
      : [[], []];
    return {
      templates: templates || [],
      runs: runs || [],
      latest_run: activeRun || null,
      latest_items: items || [],
      latest_exports: exports || [],
      selected_run_id: activeRun?.id || "",
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { unavailable: true, templates: [], runs: [], latest_run: null, latest_items: [], latest_exports: [] };
    }
    throw error;
  }
}

function idInFilter(ids = []) {
  return ids.map((id) => encodeFilter(id)).join(",");
}

async function loadCustomerAccounts(organizationId, selectedCustomerId = "") {
  try {
    const [customers, accounts, meters] = await Promise.all([
      fetchSupabase(`utility_customers?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=display_name.asc&limit=300`),
      fetchSupabase(`utility_service_accounts?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=account_number.asc&limit=500`),
      fetchSupabase(`utility_meters?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=meter_number.asc&limit=500`),
    ]);
    const customerList = customers || [];
    const accountList = accounts || [];
    const meterList = meters || [];
    const selectedId = cleanString(selectedCustomerId, 80) || customerList[0]?.id || "";
    const selectedCustomer = customerList.find((customer) => customer.id === selectedId) || customerList[0] || null;
    const selectedAccounts = selectedCustomer
      ? accountList.filter((account) => account.customer_id === selectedCustomer.id)
      : [];
    const accountIds = selectedAccounts.map((account) => account.id).filter(Boolean);
    const selectedMeters = accountIds.length
      ? meterList.filter((meter) => accountIds.includes(meter.service_account_id))
      : [];
    const meterIds = selectedMeters.map((meter) => meter.id).filter(Boolean);

    const [readings, billingItems] = selectedCustomer
      ? await Promise.all([
          meterIds.length
            ? fetchSupabase(`utility_meter_readings?select=*&organization_id=eq.${encodeFilter(organizationId)}&meter_id=in.(${idInFilter(meterIds)})&order=billing_period.desc&limit=36`)
            : [],
          accountIds.length
            ? fetchSupabase(`utility_billing_run_items?select=*&organization_id=eq.${encodeFilter(organizationId)}&service_account_id=in.(${idInFilter(accountIds)})&order=created_at.desc&limit=36`)
            : [],
        ])
      : [[], []];

    return {
      customers: customerList.map((customer) => {
        const customerAccounts = accountList.filter((account) => account.customer_id === customer.id);
        const customerAccountIds = customerAccounts.map((account) => account.id);
        return {
          ...customer,
          account_count: customerAccounts.length,
          meter_count: meterList.filter((meter) => customerAccountIds.includes(meter.service_account_id)).length,
        };
      }),
      all_accounts: accountList,
      all_meters: meterList,
      accounts: selectedAccounts,
      meters: selectedMeters,
      readings: readings || [],
      billing_items: billingItems || [],
      selected_customer: selectedCustomer,
      selected_customer_id: selectedCustomer?.id || "",
    };
  } catch (error) {
    if (isMissingRelationError(error)) {
      return { unavailable: true, customers: [], accounts: [], meters: [], readings: [], billing_items: [], selected_customer: null, selected_customer_id: "" };
    }
    throw error;
  }
}

async function getMembershipAccess(user) {
  const memberships = await fetchSupabase(
    `utility_organization_members?select=organization_id,status&user_id=eq.${encodeFilter(user.id)}&status=eq.active`
  );
  return new Map((memberships || []).map((row) => [row.organization_id, "member"]));
}

async function ensurePrimaryContactMembership(organizationId, user) {
  const organization = first(await fetchSupabase(`utility_organizations?select=id,primary_contact_email&id=eq.${encodeFilter(organizationId)}&limit=1`));
  if (cleanEmail(organization?.primary_contact_email) !== cleanEmail(user?.email)) return;
  const existing = first(await fetchSupabase(
    `utility_organization_members?select=id,status&organization_id=eq.${encodeFilter(organizationId)}&user_id=eq.${encodeFilter(user.id)}&limit=1`
  ));
  if (existing?.id && existing.status !== "removed") return;
  const ownerRole = first(await fetchSupabase(`utility_roles?select=id&organization_id=eq.${encodeFilter(organizationId)}&name=eq.owner&limit=1`));
  if (!ownerRole?.id) return;
  if (existing?.id) {
    await fetchSupabase(`utility_organization_members?id=eq.${encodeFilter(existing.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        role_id: ownerRole.id,
        status: "active",
        joined_at: new Date().toISOString(),
      }),
    });
    return;
  }
  await fetchSupabase("utility_organization_members", {
    method: "POST",
    body: JSON.stringify({
      organization_id: organizationId,
      user_id: user.id,
      role_id: ownerRole.id,
      status: "active",
      joined_at: new Date().toISOString(),
    }),
  });
}

async function loadTeamData(organizationId, user) {
  await ensurePrimaryContactMembership(organizationId, user);
  const [members, roles, invites] = await Promise.all([
    fetchSupabase(`utility_organization_members?select=*&organization_id=eq.${encodeFilter(organizationId)}&status=neq.removed&order=created_at.asc`),
    fetchSupabase(`utility_roles?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=created_at.asc`),
    fetchSupabase(`utility_organization_invites?select=*&organization_id=eq.${encodeFilter(organizationId)}&revoked_at=is.null&order=created_at.desc`).catch(() => []),
  ]);
  const roleById = new Map((roles || []).map((role) => [role.id, role]));
  const userIds = [...new Set((members || []).map((member) => member.user_id).filter(Boolean))];
  const profiles = userIds.length
    ? await fetchSupabase(`profiles?select=id,email,full_name&id=in.(${userIds.map(encodeFilter).join(",")})`)
    : [];
  const profileById = new Map((profiles || []).map((profile) => [profile.id, profile]));
  const currentMember = (members || []).find((member) => member.user_id === user.id && member.status === "active") || null;
  const currentRole = currentMember ? roleById.get(currentMember.role_id) || null : null;
  return {
    can_manage: ["owner", "admin"].includes(currentRole?.name),
    current_role: currentRole ? { id: currentRole.id, name: currentRole.name, display_name: currentRole.display_name } : null,
    roles: (roles || []).map((role) => ({
      id: role.id,
      name: role.name,
      display_name: role.display_name,
      description: role.description,
      is_system: role.is_system,
    })),
    invites: (invites || []).map((invite) => {
      const role = roleById.get(invite.role_id) || null;
      return {
        id: invite.id,
        code: invite.code,
        recipient_email: invite.recipient_email,
        recipient_name: invite.recipient_name,
        custom_message: invite.custom_message,
        max_uses: invite.max_uses,
        redeemed_uses: invite.redeemed_uses,
        expires_at: invite.expires_at,
        created_at: invite.created_at,
        status: inviteStatus(invite),
        role: role ? { id: role.id, name: role.name, display_name: role.display_name } : null,
      };
    }),
    members: (members || []).map((member) => {
      const role = roleById.get(member.role_id) || null;
      const profile = profileById.get(member.user_id) || (member.user_id === user.id
        ? {
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.user_metadata?.name || null,
          }
        : null);
      return {
        id: member.id,
        user_id: member.user_id,
        status: member.status,
        invited_at: member.invited_at,
        joined_at: member.joined_at,
        created_at: member.created_at,
        role: role ? { id: role.id, name: role.name, display_name: role.display_name } : null,
        profile: profile ? { id: profile.id, email: profile.email, full_name: profile.full_name } : null,
      };
    }),
  };
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

async function loadWorkspace(user, requestedOrg, selectedBillingRunId = "", selectedCustomerId = "") {
  const organizations = await listAccessibleOrganizations(user);
  const summaryOrganization = requestedOrg
    ? organizations.find((org) => org.id === requestedOrg || org.slug === requestedOrg) || organizations[0]
    : organizations[0];

  if (!summaryOrganization) {
    return { organizations: [], organization: null };
  }

  const organizationId = summaryOrganization.id;
  const [organization, domains, branding, settings, steps, modules, team, meterBilling, customerAccounts] = await Promise.all([
    first(await fetchSupabase(`utility_organizations?select=*&id=eq.${encodeFilter(organizationId)}&limit=1`)),
    fetchSupabase(`utility_organization_domains?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=is_primary.desc,created_at.asc`),
    first(await fetchSupabase(`utility_organization_branding?select=*&organization_id=eq.${encodeFilter(organizationId)}&limit=1`)),
    first(await fetchSupabase(`utility_organization_settings?select=*&organization_id=eq.${encodeFilter(organizationId)}&limit=1`)),
    fetchSupabase(`utility_portal_launch_steps?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=sort_order.asc`),
    loadOrganizationModules(organizationId),
    loadTeamData(organizationId, user),
    loadMeterBilling(organizationId, selectedBillingRunId),
    loadCustomerAccounts(organizationId, selectedCustomerId),
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
    team,
    meter_billing: meterBilling,
    customer_accounts: customerAccounts,
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

async function requireManageOrganization(user, requested) {
  const org = await requireOrganizationAccess(user, requested);
  const member = first(await fetchSupabase(
    `utility_organization_members?select=*&organization_id=eq.${encodeFilter(org.id)}&user_id=eq.${encodeFilter(user.id)}&status=eq.active&limit=1`
  ));
  if (!member) {
    const error = new Error("Utility admin access is required.");
    error.status = 403;
    throw error;
  }
  const role = first(await fetchSupabase(`utility_roles?select=*&id=eq.${encodeFilter(member.role_id)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!["owner", "admin"].includes(role?.name)) {
    const error = new Error("Only utility owners and admins can manage team access.");
    error.status = 403;
    throw error;
  }
  return { org, member, role };
}

async function findUtilityRole(organizationId, roleName) {
  const safeRole = normalizeRoleName(roleName) || "staff";
  const role = first(await fetchSupabase(`utility_roles?select=*&organization_id=eq.${encodeFilter(organizationId)}&name=eq.${encodeFilter(safeRole)}&limit=1`));
  if (!role) {
    const error = new Error("Selected role is not available for this utility.");
    error.status = 400;
    throw error;
  }
  return role;
}

function inviteEmailText({ organizationName, recipientName, inviterName, roleName, inviteUrl, customMessage }) {
  return [
    `You have been invited to ${organizationName} on N3XRA Utilities.`,
    recipientName ? `Hi ${recipientName},` : "",
    `${inviterName} invited you to join ${organizationName} as ${roleName}.`,
    customMessage ? `Message: ${customMessage}` : "",
    `Accept invite: ${inviteUrl}`,
    "If you do not have a N3XRA account yet, this link lets you create one and join the utility workspace.",
  ].filter(Boolean).join("\n\n");
}

function inviteEmailHtml({ organizationName, recipientName, inviterName, roleName, inviteUrl, customMessage, logoUrl, primaryColor, secondaryColor }) {
  const safeOrganizationName = escapeHtml(organizationName);
  const safeRecipientName = escapeHtml(recipientName || "");
  const safeInviterName = escapeHtml(inviterName);
  const safeRoleName = escapeHtml(roleName);
  const safeInviteUrl = escapeHtml(inviteUrl);
  const safeCustomMessage = escapeHtml(customMessage || "");
  const safePrimaryColor = /^#[0-9a-f]{6}$/i.test(primaryColor || "") ? primaryColor : "#123a33";
  const safeSecondaryColor = /^#[0-9a-f]{6}$/i.test(secondaryColor || "") ? secondaryColor : "#f4f7fb";
  const logoBlock = logoUrl
    ? `<img src="${escapeHtml(logoUrl)}" alt="${safeOrganizationName}" style="display:block;max-width:180px;max-height:76px;width:auto;height:auto;margin:0 auto 22px;">`
    : `<div style="margin:0 auto 22px;width:72px;height:72px;border-radius:18px;background:${safePrimaryColor};"></div>`;
  const greeting = safeRecipientName ? `Hi ${safeRecipientName},` : "You have a new team invite.";
  const noteBlock = safeCustomMessage
    ? `<div style="margin:18px 0;padding:14px 16px;border-radius:14px;background:${safeSecondaryColor};color:#2f3d4d;font-size:15px;line-height:1.55;">${safeCustomMessage}</div>`
    : "";

  return `
    <div style="margin:0;padding:0;background:#edf2f7;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:620px;margin:0 auto;padding:28px 16px;">
        <div style="overflow:hidden;border-radius:24px;background:#ffffff;border:1px solid #d9e2ec;box-shadow:0 22px 48px rgba(15,22,32,0.12);">
          <div style="padding:30px 28px;text-align:center;background:linear-gradient(135deg,${safePrimaryColor},#0f1720);">
            ${logoBlock}
            <p style="margin:0;color:#d5fff0;font-size:13px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;">N3XRA Utilities</p>
            <h1 style="margin:10px 0 0;color:#ffffff;font-size:30px;line-height:1.12;">Join ${safeOrganizationName}</h1>
          </div>
          <div style="padding:28px;">
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2f3d4d;">${greeting}</p>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2f3d4d;">${safeInviterName} invited you to join <strong>${safeOrganizationName}</strong> as <strong>${safeRoleName}</strong>.</p>
            ${noteBlock}
            <a href="${safeInviteUrl}" style="display:inline-block;margin-top:4px;padding:13px 22px;border-radius:999px;background:${safePrimaryColor};color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Accept invite</a>
            <p style="margin:18px 0 0;font-size:13px;line-height:1.5;color:#667085;">If you do not have a N3XRA account yet, this link lets you create one and join the utility workspace.</p>
          </div>
        </div>
      </div>
    </div>
  `;
}

async function sendUtilityInviteEmail({ req, user, organization, branding, role, invite, inviteUrl }) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const recipientEmail = cleanEmail(invite?.recipient_email);
  if (!recipientEmail || !isValidEmail(recipientEmail)) {
    return { status: "skipped", reason: "missing_recipient_email" };
  }
  if (!resendApiKey) {
    return { status: "skipped", reason: "missing_resend_api_key" };
  }

  const organizationName = branding?.portal_display_name || organization?.name || "N3XRA Utilities";
  const replyTo = cleanEmail(branding?.email_reply_to || organization?.support_email || organization?.primary_contact_email);
  const inviterName = cleanString(user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email, 140) || "A utility workspace admin";
  const logoUrl = await createSignedAssetUrl(branding?.logo_storage_path);
  const emailPayload = {
    organizationName,
    recipientName: invite.recipient_name,
    inviterName,
    roleName: roleLabelForEmail(role),
    inviteUrl,
    customMessage: invite.custom_message,
    logoUrl,
    primaryColor: branding?.primary_color,
    secondaryColor: branding?.secondary_color,
  };
  const fromName = `${organizationName} via N3XRA`;
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName.replace(/[<>"]/g, "")} <${RESEND_FROM_EMAIL}>`,
      to: [recipientEmail],
      subject: `${inviterName} invited you to ${organizationName} on N3XRA Utilities`,
      html: inviteEmailHtml(emailPayload),
      text: inviteEmailText(emailPayload),
      reply_to: isValidEmail(replyTo) ? replyTo : undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(String(data?.message || data?.error || "Unable to send utility invite email."));
    error.status = 502;
    throw error;
  }
  return { status: "sent", id: data?.id || null };
}

function roleLabelForEmail(role) {
  return role?.display_name || cleanString(role?.name, 80).replaceAll("_", " ") || "staff";
}

async function createTeamInvite(user, body, req) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const role = await findUtilityRole(org.id, body.role_name || body.roleName || "staff");
  const recipientEmail = cleanEmail(body.recipient_email || body.recipientEmail || body.email) || null;
  const recipientName = cleanString(body.recipient_name || body.recipientName || body.name, 120) || null;
  const customMessage = cleanString(body.custom_message || body.customMessage, 500) || null;
  const now = new Date();
  const expiresAt = body.expires_at || body.expiresAt
    ? new Date(body.expires_at || body.expiresAt)
    : new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(expiresAt.getTime())) {
    const error = new Error("Invite expiration date is invalid.");
    error.status = 400;
    throw error;
  }

  let code = createInviteCode();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const existing = first(await fetchSupabase(`utility_organization_invites?select=id&code=eq.${encodeFilter(code)}&limit=1`));
    if (!existing) break;
    code = createInviteCode();
  }

  const rows = await fetchSupabase("utility_organization_invites", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: org.id,
      role_id: role.id,
      code,
      recipient_email: recipientEmail,
      recipient_name: recipientName,
      custom_message: customMessage,
      max_uses: 1,
      expires_at: expiresAt.toISOString(),
      created_by_user_id: user.id,
    }),
  });
  const invite = first(rows);
  const [organization, branding] = await Promise.all([
    first(await fetchSupabase(`utility_organizations?select=*&id=eq.${encodeFilter(org.id)}&limit=1`)),
    first(await fetchSupabase(`utility_organization_branding?select=*&organization_id=eq.${encodeFilter(org.id)}&limit=1`)),
  ]);
  const origin = getRequestOrigin(req);
  const inviteUrl = `${origin}/utilities/login?invite=${encodeURIComponent(invite.code)}${invite.recipient_email ? `&email=${encodeURIComponent(invite.recipient_email)}` : ""}`;
  const email = await sendUtilityInviteEmail({ req, user, organization: organization || org, branding: branding || {}, role, invite, inviteUrl });
  return {
    ...invite,
    status: inviteStatus(invite),
    role: { id: role.id, name: role.name, display_name: role.display_name },
    invite_url: inviteUrl,
    email,
  };
}

async function revokeTeamInvite(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const inviteId = cleanString(body.invite_id || body.inviteId, 80);
  if (!inviteId) {
    const error = new Error("Invite id is required.");
    error.status = 400;
    throw error;
  }
  const invite = first(await fetchSupabase(`utility_organization_invites?select=*&id=eq.${encodeFilter(inviteId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!invite) {
    const error = new Error("Invite was not found.");
    error.status = 404;
    throw error;
  }
  const rows = await fetchSupabase(`utility_organization_invites?id=eq.${encodeFilter(invite.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  return first(rows);
}

async function redeemTeamInvite(user, body) {
  const code = normalizeInviteCode(body.invite_code || body.inviteCode || body.code);
  if (!code) {
    const error = new Error("Invite code is required.");
    error.status = 400;
    throw error;
  }
  const invite = first(await fetchSupabase(`utility_organization_invites?select=*&code=eq.${encodeFilter(code)}&limit=1`));
  if (!invite) {
    const error = new Error("This utility invite code was not found.");
    error.status = 404;
    throw error;
  }
  const status = inviteStatus(invite);
  if (status !== "active") {
    const error = new Error(`This utility invite is ${status}.`);
    error.status = 400;
    throw error;
  }
  if (invite.recipient_email && cleanEmail(invite.recipient_email) !== cleanEmail(user.email)) {
    const error = new Error("This invite was created for a different email address.");
    error.status = 403;
    throw error;
  }

  const existing = first(await fetchSupabase(
    `utility_organization_members?select=*&organization_id=eq.${encodeFilter(invite.organization_id)}&user_id=eq.${encodeFilter(user.id)}&limit=1`
  ));
  const now = new Date().toISOString();
  let member = null;
  if (existing?.id) {
    member = first(await fetchSupabase(`utility_organization_members?id=eq.${encodeFilter(existing.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        role_id: invite.role_id,
        status: "active",
        joined_at: existing.joined_at || now,
      }),
    }));
  } else {
    member = first(await fetchSupabase("utility_organization_members", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        organization_id: invite.organization_id,
        user_id: user.id,
        role_id: invite.role_id,
        status: "active",
        invited_by_user_id: invite.created_by_user_id,
        invited_at: invite.created_at || now,
        joined_at: now,
      }),
    }));
  }

  await fetchSupabase(`utility_organization_invites?id=eq.${encodeFilter(invite.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      redeemed_uses: Number(invite.redeemed_uses || 0) + 1,
      last_redeemed_at: now,
    }),
  });

  const organization = first(await fetchSupabase(`utility_organizations?select=id,name,slug,status,launch_status&id=eq.${encodeFilter(invite.organization_id)}&limit=1`));
  return {
    member,
    organization,
    workspace_url: workspaceUrl(organization),
  };
}

async function addTeamMember(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const email = cleanEmail(body.email);
  if (!email) {
    const error = new Error("Team member email is required.");
    error.status = 400;
    throw error;
  }
  const profile = first(await fetchSupabase(`profiles?select=id,email,full_name&email=eq.${encodeFilter(email)}&limit=1`));
  if (!profile?.id) {
    const error = new Error("That email does not have a N3XRA account yet. Have them create an account first, then add them here.");
    error.status = 404;
    throw error;
  }
  const role = await findUtilityRole(org.id, body.role_name || body.roleName || "staff");
  const existing = first(await fetchSupabase(`utility_organization_members?select=*&organization_id=eq.${encodeFilter(org.id)}&user_id=eq.${encodeFilter(profile.id)}&limit=1`));
  if (existing?.id) {
    const rows = await fetchSupabase(`utility_organization_members?id=eq.${encodeFilter(existing.id)}`, {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({
        role_id: role.id,
        status: "active",
        joined_at: existing.joined_at || new Date().toISOString(),
      }),
    });
    return first(rows);
  }
  const rows = await fetchSupabase("utility_organization_members", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: org.id,
      user_id: profile.id,
      role_id: role.id,
      status: "active",
      invited_by_user_id: user.id,
      invited_at: new Date().toISOString(),
      joined_at: new Date().toISOString(),
    }),
  });
  return first(rows);
}

async function updateTeamMember(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const memberId = cleanString(body.member_id || body.memberId, 80);
  const roleName = normalizeRoleName(body.role_name || body.roleName);
  const status = cleanString(body.status, 40);
  if (!memberId) {
    const error = new Error("Member id is required.");
    error.status = 400;
    throw error;
  }
  const member = first(await fetchSupabase(`utility_organization_members?select=*&id=eq.${encodeFilter(memberId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!member) {
    const error = new Error("Team member was not found.");
    error.status = 404;
    throw error;
  }
  const updates = {};
  if (roleName) updates.role_id = (await findUtilityRole(org.id, roleName)).id;
  if (status) {
    if (!["invited", "active", "suspended"].includes(status)) {
      const error = new Error("Invalid member status.");
      error.status = 400;
      throw error;
    }
    updates.status = status;
  }
  if (!Object.keys(updates).length) return member;
  const rows = await fetchSupabase(`utility_organization_members?id=eq.${encodeFilter(member.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(updates),
  });
  return first(rows);
}

async function removeTeamMember(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const memberId = cleanString(body.member_id || body.memberId, 80);
  if (!memberId) {
    const error = new Error("Member id is required.");
    error.status = 400;
    throw error;
  }
  const member = first(await fetchSupabase(`utility_organization_members?select=*&id=eq.${encodeFilter(memberId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!member) {
    const error = new Error("Team member was not found.");
    error.status = 404;
    throw error;
  }
  if (member.user_id === user.id) {
    const error = new Error("You cannot remove your own workspace access.");
    error.status = 400;
    throw error;
  }
  const rows = await fetchSupabase(`utility_organization_members?id=eq.${encodeFilter(member.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "removed" }),
  });
  return first(rows);
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

async function updateUtilityCustomer(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const customerId = cleanString(body.customer_id || body.customerId, 80);
  if (!customerId) {
    const error = new Error("Missing customer_id.");
    error.status = 400;
    throw error;
  }
  const existing = first(await fetchSupabase(`utility_customers?select=*&id=eq.${encodeFilter(customerId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!existing) {
    const error = new Error("Customer not found.");
    error.status = 404;
    throw error;
  }
  const rows = await fetchSupabase(`utility_customers?id=eq.${encodeFilter(customerId)}&organization_id=eq.${encodeFilter(org.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      display_name: cleanString(body.display_name || body.displayName, 220) || existing.display_name,
      email: cleanEmail(body.email) || null,
      phone: cleanString(body.phone, 80) || null,
    }),
  });
  return first(rows);
}

async function updateUtilityServiceAccount(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const accountId = cleanString(body.account_id || body.accountId, 80);
  const status = cleanString(body.status, 40) || "active";
  if (!accountId || !["active", "inactive", "closed"].includes(status)) {
    const error = new Error("Choose a valid account and status.");
    error.status = 400;
    throw error;
  }
  const rows = await fetchSupabase(`utility_service_accounts?id=eq.${encodeFilter(accountId)}&organization_id=eq.${encodeFilter(org.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      service_address: cleanString(body.service_address || body.serviceAddress, 300) || null,
      status,
    }),
  });
  return first(rows);
}

async function updateUtilityMeter(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const meterId = cleanString(body.meter_id || body.meterId, 80);
  const status = cleanString(body.status, 40) || "active";
  if (!meterId || !["active", "inactive", "removed"].includes(status)) {
    const error = new Error("Choose a valid meter and status.");
    error.status = 400;
    throw error;
  }
  const rows = await fetchSupabase(`utility_meters?id=eq.${encodeFilter(meterId)}&organization_id=eq.${encodeFilter(org.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status }),
  });
  return first(rows);
}

async function deleteUtilityCustomer(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const customerId = cleanString(body.customer_id || body.customerId, 80);
  const customer = first(await fetchSupabase(`utility_customers?select=*&id=eq.${encodeFilter(customerId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!customer) {
    const error = new Error("Customer not found.");
    error.status = 404;
    throw error;
  }
  const accounts = await fetchSupabase(`utility_service_accounts?select=id&customer_id=eq.${encodeFilter(customer.id)}&organization_id=eq.${encodeFilter(org.id)}`);
  const accountIds = (accounts || []).map((account) => account.id).filter(Boolean);
  if (accountIds.length) {
    await fetchSupabase(`utility_meters?service_account_id=in.(${idInFilter(accountIds)})&organization_id=eq.${encodeFilter(org.id)}`, { method: "DELETE" });
    await fetchSupabase(`utility_service_accounts?customer_id=eq.${encodeFilter(customer.id)}&organization_id=eq.${encodeFilter(org.id)}`, { method: "DELETE" });
  }
  await fetchSupabase(`utility_customers?id=eq.${encodeFilter(customer.id)}&organization_id=eq.${encodeFilter(org.id)}`, { method: "DELETE" });
  await insertAuditEvent(org.id, user.id, "utility_customer_deleted", "utility_customers", customer.id, {
    external_customer_id: customer.external_customer_id,
  });
  return { deleted_customer_id: customer.id };
}

function mappedValue(row, mapping, key) {
  const column = cleanString(mapping?.[key], 160);
  if (!column || !row || typeof row !== "object") return "";
  return row[column];
}

function requireBillingRows(rows) {
  if (!Array.isArray(rows) || !rows.length) {
    const error = new Error("Upload a CSV with at least one data row.");
    error.status = 400;
    throw error;
  }
  if (rows.length > 1000) {
    const error = new Error("Import up to 1,000 rows at a time for this first version.");
    error.status = 400;
    throw error;
  }
}

function requireMapping(mapping) {
  const required = ["account_number", "meter_number", "current_reading"];
  const missing = required.filter((key) => !cleanString(mapping?.[key], 160));
  if (missing.length) {
    const error = new Error(`Map required columns: ${missing.map((key) => key.replaceAll("_", " ")).join(", ")}.`);
    error.status = 400;
    throw error;
  }
}

async function findPreviousReading(organizationId, meterId, billingPeriod) {
  if (!meterId || !billingPeriod) return null;
  return first(await fetchSupabase(
    `utility_meter_readings?select=current_reading,usage_gallons,billing_period&organization_id=eq.${encodeFilter(organizationId)}&meter_id=eq.${encodeFilter(meterId)}&billing_period=lt.${encodeFilter(billingPeriod)}&order=billing_period.desc&limit=1`
  ));
}

async function createMeterBillingRun(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const mapping = body.column_mapping || body.columnMapping || {};
  const rows = Array.isArray(body.rows) ? body.rows : [];
  const headers = Array.isArray(body.headers) ? body.headers.map((header) => cleanString(header, 160)).filter(Boolean) : [];
  const billingPeriod = cleanPeriod(body.billing_period || body.billingPeriod);
  const includedGallons = cleanNumber(body.included_gallons || body.includedGallons, 10000);
  const overageRate = cleanNumber(body.overage_rate || body.overageRate, 0);
  const fileName = cleanString(body.file_name || body.fileName, 240);
  const templateName = cleanString(body.template_name || body.templateName || "Meter readings CSV", 120);

  if (!billingPeriod) {
    const error = new Error("Billing period must use YYYY-MM.");
    error.status = 400;
    throw error;
  }
  if (includedGallons < 0 || overageRate < 0) {
    const error = new Error("Included gallons and overage rate must be zero or greater.");
    error.status = 400;
    throw error;
  }
  requireBillingRows(rows);
  requireMapping(mapping);

  const template = await upsertSupabase("utility_import_templates", "organization_id,import_type,name", {
    organization_id: org.id,
    import_type: "meter_readings",
    name: templateName,
    column_mapping: mapping,
    metadata: { headers },
    created_by_user_id: user.id,
  });

  const importRecord = first(await fetchSupabase("utility_meter_reading_imports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: org.id,
      template_id: template?.id || null,
      file_name: fileName || null,
      billing_period: billingPeriod,
      status: "processed",
      headers,
      row_count: rows.length,
      imported_count: 0,
      error_count: 0,
      raw_preview: rows.slice(0, 5),
      metadata: { mapping },
      created_by_user_id: user.id,
    }),
  }));

  const billingRun = first(await fetchSupabase("utility_billing_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: org.id,
      import_id: importRecord.id,
      billing_period: billingPeriod,
      status: "draft",
      included_gallons: includedGallons,
      overage_rate: overageRate,
      created_by_user_id: user.id,
    }),
  }));

  const items = [];
  const errors = [];
  let importedCount = 0;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index] && typeof rows[index] === "object" ? rows[index] : {};
    const sourceRowNumber = index + 2;
    const accountNumber = cleanString(mappedValue(row, mapping, "account_number"), 120);
    const meterNumber = cleanString(mappedValue(row, mapping, "meter_number"), 120);
    const customerName = cleanString(mappedValue(row, mapping, "customer_name"), 220);
    const serviceAddress = cleanString(mappedValue(row, mapping, "service_address"), 300);
    const readingDate = cleanDate(mappedValue(row, mapping, "reading_date"));
    const currentReading = cleanNumber(mappedValue(row, mapping, "current_reading"));
    const previousFromCsv = cleanNumber(mappedValue(row, mapping, "previous_reading"));
    const usageFromCsv = cleanNumber(mappedValue(row, mapping, "usage_gallons"));

    if (!accountNumber || !meterNumber || currentReading === null) {
      errors.push({ row: sourceRowNumber, error: "Missing account number, meter number, or current reading." });
      continue;
    }

    const customer = await upsertSupabase("utility_customers", "organization_id,external_customer_id", {
      organization_id: org.id,
      external_customer_id: accountNumber,
      display_name: customerName || accountNumber,
      metadata: { source: "meter_billing_csv" },
    });
    const serviceAccount = await upsertSupabase("utility_service_accounts", "organization_id,account_number", {
      organization_id: org.id,
      customer_id: customer?.id || null,
      account_number: accountNumber,
      service_address: serviceAddress || null,
      metadata: { source: "meter_billing_csv" },
    });
    const meter = await upsertSupabase("utility_meters", "organization_id,meter_number", {
      organization_id: org.id,
      service_account_id: serviceAccount?.id || null,
      meter_number: meterNumber,
      meter_type: "water",
      metadata: { source: "meter_billing_csv" },
    });
    const previousReadingRow = previousFromCsv === null ? await findPreviousReading(org.id, meter?.id, billingPeriod) : null;
    const previousReading = previousFromCsv !== null ? previousFromCsv : cleanNumber(previousReadingRow?.current_reading);
    const usageGallons = usageFromCsv !== null
      ? usageFromCsv
      : previousReading !== null
        ? Math.max(0, currentReading - previousReading)
        : 0;
    const overageGallons = Math.max(0, usageGallons - includedGallons);
    const overageAmount = Number((overageGallons * overageRate).toFixed(2));
    const note = previousReading === null && usageFromCsv === null ? "No previous reading or usage column was available; treated as baseline." : "";

    const reading = await upsertSupabase("utility_meter_readings", "organization_id,meter_id,billing_period", {
      organization_id: org.id,
      import_id: importRecord.id,
      customer_id: customer?.id || null,
      service_account_id: serviceAccount?.id || null,
      meter_id: meter?.id || null,
      billing_period: billingPeriod,
      reading_date: readingDate,
      current_reading: currentReading,
      previous_reading: previousReading,
      usage_gallons: usageGallons,
      source_row_number: sourceRowNumber,
      raw_row: row,
    });

    items.push({
      organization_id: org.id,
      billing_run_id: billingRun.id,
      reading_id: reading?.id || null,
      customer_id: customer?.id || null,
      service_account_id: serviceAccount?.id || null,
      meter_id: meter?.id || null,
      account_number: accountNumber,
      customer_name: customerName || null,
      service_address: serviceAddress || null,
      meter_number: meterNumber,
      current_reading: currentReading,
      previous_reading: previousReading,
      usage_gallons: usageGallons,
      included_gallons: includedGallons,
      overage_gallons: overageGallons,
      overage_rate: overageRate,
      overage_amount: overageAmount,
      status: overageGallons > 0 ? "pending" : "skipped",
      notes: note || null,
      metadata: { source_row_number: sourceRowNumber, billing_period: billingPeriod },
    });
    importedCount += 1;
  }

  const insertedItems = items.length
    ? await fetchSupabase("utility_billing_run_items", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(items),
      })
    : [];
  const billableItems = items.filter((item) => item.overage_gallons > 0);
  const totals = {
    item_count: items.length,
    billable_count: billableItems.length,
    total_overage_gallons: billableItems.reduce((sum, item) => sum + Number(item.overage_gallons || 0), 0),
    total_overage_amount: Number(billableItems.reduce((sum, item) => sum + Number(item.overage_amount || 0), 0).toFixed(2)),
  };

  const finalRun = first(await fetchSupabase(`utility_billing_runs?id=eq.${encodeFilter(billingRun.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(totals),
  }));
  await fetchSupabase(`utility_meter_reading_imports?id=eq.${encodeFilter(importRecord.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      status: errors.length && importedCount ? "partial" : errors.length ? "failed" : "processed",
      imported_count: importedCount,
      error_count: errors.length,
      metadata: { mapping, errors: errors.slice(0, 50) },
    }),
  });

  await insertAuditEvent(org.id, user.id, "meter_billing_run_created", "utility_billing_runs", finalRun.id, {
    billing_period: billingPeriod,
    imported_count: importedCount,
    error_count: errors.length,
  });

  return { run: finalRun, items: insertedItems || [], errors };
}

async function updateBillingItem(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const itemId = cleanString(body.item_id || body.itemId, 80);
  const status = cleanString(body.status, 40);
  if (!itemId || !["pending", "approved", "flagged", "skipped"].includes(status)) {
    const error = new Error("Choose a valid billing item status.");
    error.status = 400;
    throw error;
  }
  const item = first(await fetchSupabase(`utility_billing_run_items?select=*&id=eq.${encodeFilter(itemId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!item) {
    const error = new Error("Billing item not found.");
    error.status = 404;
    throw error;
  }
  const rows = await fetchSupabase(`utility_billing_run_items?id=eq.${encodeFilter(itemId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status }),
  });
  return first(rows);
}

async function approveBillingRunItems(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const runId = cleanString(body.billing_run_id || body.billingRunId, 80);
  const run = first(await fetchSupabase(`utility_billing_runs?select=*&id=eq.${encodeFilter(runId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!run) {
    const error = new Error("Billing run not found.");
    error.status = 404;
    throw error;
  }
  const rows = await fetchSupabase(
    `utility_billing_run_items?billing_run_id=eq.${encodeFilter(run.id)}&organization_id=eq.${encodeFilter(org.id)}&status=eq.pending&overage_gallons=gt.0`,
    {
      method: "PATCH",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify({ status: "approved" }),
    }
  );
  return { run, items: rows || [] };
}

async function deleteMeterBillingRun(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const runId = cleanString(body.billing_run_id || body.billingRunId, 80);
  const run = first(await fetchSupabase(`utility_billing_runs?select=*&id=eq.${encodeFilter(runId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!run) {
    const error = new Error("Billing run not found.");
    error.status = 404;
    throw error;
  }

  await fetchSupabase(`utility_billing_runs?id=eq.${encodeFilter(run.id)}&organization_id=eq.${encodeFilter(org.id)}`, { method: "DELETE" });
  if (run.import_id) {
    await fetchSupabase(`utility_meter_readings?import_id=eq.${encodeFilter(run.import_id)}&organization_id=eq.${encodeFilter(org.id)}`, { method: "DELETE" });
    await fetchSupabase(`utility_meter_reading_imports?id=eq.${encodeFilter(run.import_id)}&organization_id=eq.${encodeFilter(org.id)}`, { method: "DELETE" });
  }

  await insertAuditEvent(org.id, user.id, "meter_billing_run_deleted", "utility_billing_runs", run.id, {
    billing_period: run.billing_period,
    import_id: run.import_id || null,
  });

  return { deleted_run_id: run.id, deleted_import_id: run.import_id || null };
}

async function createBillingExport(user, body) {
  const { org } = await requireManageOrganization(user, body.organization_id || body.organizationId || body.slug);
  const runId = cleanString(body.billing_run_id || body.billingRunId, 80);
  const run = first(await fetchSupabase(`utility_billing_runs?select=*&id=eq.${encodeFilter(runId)}&organization_id=eq.${encodeFilter(org.id)}&limit=1`));
  if (!run) {
    const error = new Error("Billing run not found.");
    error.status = 404;
    throw error;
  }
  const items = await fetchSupabase(`utility_billing_run_items?select=*&billing_run_id=eq.${encodeFilter(run.id)}&status=eq.approved&order=account_number.asc`);
  if (!Array.isArray(items) || !items.length) {
    const error = new Error("Approve at least one billing row before exporting.");
    error.status = 400;
    throw error;
  }
  const exportRow = first(await fetchSupabase("utility_billing_exports", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      organization_id: org.id,
      billing_run_id: run.id,
      export_type: "quickbooks_csv",
      file_name: `quickbooks-overages-${run.billing_period}.csv`,
      row_count: Array.isArray(items) ? items.length : 0,
      created_by_user_id: user.id,
    }),
  }));
  await fetchSupabase(`utility_billing_runs?id=eq.${encodeFilter(run.id)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ status: "exported" }),
  });
  return { export: exportRow, items: items || [] };
}

module.exports = async function handler(req, res) {
  try {
    const user = await verifyUser(getBearerToken(req));
    if (req.method === "GET") {
      const org = cleanString(req.query?.org, 120);
      const billingRunId = cleanString(req.query?.billing_run_id || req.query?.billingRunId, 80);
      const customerId = cleanString(req.query?.customer_id || req.query?.customerId, 80);
      return res.status(200).json({ ok: true, workspace: await loadWorkspace(user, org, billingRunId, customerId) });
    }
    if (req.method !== "PATCH") {
      res.setHeader("Allow", "GET, PATCH");
      return res.status(405).json({ error: "Method not allowed." });
    }

    const body = parseBody(req);
    const action = cleanString(body.action, 80);
    if (action === "update-profile") return res.status(200).json({ ok: true, organization: await updateProfile(user, body) });
    if (action === "update-branding") return res.status(200).json({ ok: true, branding: await updateBranding(user, body) });
    if (action === "update-step") return res.status(200).json({ ok: true, step: await updateUtilityStep(user, body) });
    if (action === "request-module") return res.status(200).json({ ok: true, module: await requestModule(user, body) });
    if (action === "update-module-state") return res.status(200).json({ ok: true, module: await updateModuleState(user, body) });
    if (action === "update-utility-customer") return res.status(200).json({ ok: true, customer: await updateUtilityCustomer(user, body) });
    if (action === "update-utility-service-account") return res.status(200).json({ ok: true, account: await updateUtilityServiceAccount(user, body) });
    if (action === "update-utility-meter") return res.status(200).json({ ok: true, meter: await updateUtilityMeter(user, body) });
    if (action === "delete-utility-customer") return res.status(200).json({ ok: true, deletion: await deleteUtilityCustomer(user, body) });
    if (action === "create-meter-billing-run") return res.status(200).json({ ok: true, billing: await createMeterBillingRun(user, body) });
    if (action === "update-billing-item") return res.status(200).json({ ok: true, item: await updateBillingItem(user, body) });
    if (action === "approve-billing-run-items") return res.status(200).json({ ok: true, approval: await approveBillingRunItems(user, body) });
    if (action === "delete-meter-billing-run") return res.status(200).json({ ok: true, deletion: await deleteMeterBillingRun(user, body) });
    if (action === "create-billing-export") return res.status(200).json({ ok: true, billing_export: await createBillingExport(user, body) });
    if (action === "create-team-invite") return res.status(200).json({ ok: true, invite: await createTeamInvite(user, body, req) });
    if (action === "revoke-team-invite") return res.status(200).json({ ok: true, invite: await revokeTeamInvite(user, body) });
    if (action === "redeem-team-invite") return res.status(200).json({ ok: true, redeem: await redeemTeamInvite(user, body) });
    if (action === "add-team-member") return res.status(200).json({ ok: true, member: await addTeamMember(user, body) });
    if (action === "update-team-member") return res.status(200).json({ ok: true, member: await updateTeamMember(user, body) });
    if (action === "remove-team-member") return res.status(200).json({ ok: true, member: await removeTeamMember(user, body) });
    return res.status(400).json({ error: "Unknown workspace action." });
  } catch (error) {
    return res.status(Number(error?.status) || 500).json({
      error: error instanceof Error ? error.message : "Utilities workspace request failed.",
    });
  }
};
