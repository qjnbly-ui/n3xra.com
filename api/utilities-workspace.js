const crypto = require("crypto");

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

async function loadWorkspace(user, requestedOrg) {
  const organizations = await listAccessibleOrganizations(user);
  const summaryOrganization = requestedOrg
    ? organizations.find((org) => org.id === requestedOrg || org.slug === requestedOrg) || organizations[0]
    : organizations[0];

  if (!summaryOrganization) {
    return { organizations: [], organization: null };
  }

  const organizationId = summaryOrganization.id;
  const [organization, domains, branding, settings, steps, modules, team] = await Promise.all([
    first(await fetchSupabase(`utility_organizations?select=*&id=eq.${encodeFilter(organizationId)}&limit=1`)),
    fetchSupabase(`utility_organization_domains?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=is_primary.desc,created_at.asc`),
    first(await fetchSupabase(`utility_organization_branding?select=*&organization_id=eq.${encodeFilter(organizationId)}&limit=1`)),
    first(await fetchSupabase(`utility_organization_settings?select=*&organization_id=eq.${encodeFilter(organizationId)}&limit=1`)),
    fetchSupabase(`utility_portal_launch_steps?select=*&organization_id=eq.${encodeFilter(organizationId)}&order=sort_order.asc`),
    loadOrganizationModules(organizationId),
    loadTeamData(organizationId, user),
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

async function createTeamInvite(user, body) {
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
  return {
    ...invite,
    status: inviteStatus(invite),
    role: { id: role.id, name: role.name, display_name: role.display_name },
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
    if (action === "update-step") return res.status(200).json({ ok: true, step: await updateUtilityStep(user, body) });
    if (action === "request-module") return res.status(200).json({ ok: true, module: await requestModule(user, body) });
    if (action === "update-module-state") return res.status(200).json({ ok: true, module: await updateModuleState(user, body) });
    if (action === "create-team-invite") return res.status(200).json({ ok: true, invite: await createTeamInvite(user, body) });
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
