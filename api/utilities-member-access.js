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

function buildPortalUrl(organization) {
  const slug = cleanString(organization?.slug, 120);
  return slug ? `/utilities/portal/${encodeURIComponent(slug)}` : "/utilities/login";
}

function buildWorkspaceUrl(organization) {
  const slug = cleanString(organization?.slug, 120);
  return slug ? `/utilities/workspace?org=${encodeURIComponent(slug)}` : "/utilities/workspace";
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

function sortOrganizationsForAccess(a, b) {
  const liveScore = (org) => (org.launch_status === "live" ? 0 : 1);
  const activeScore = (org) => (org.status === "active" ? 0 : 1);
  return liveScore(a) - liveScore(b) || activeScore(a) - activeScore(b) || String(a.name || "").localeCompare(String(b.name || ""));
}

async function listMemberOrganizations(user) {
  const memberships = await fetchSupabase(
    `utility_organization_members?select=organization_id,status&user_id=eq.${encodeFilter(user.id)}&status=eq.active`
  );
  const organizationIds = [...new Set((memberships || []).map((row) => row.organization_id).filter(Boolean))];
  if (!organizationIds.length) return [];

  const idList = organizationIds.map(encodeFilter).join(",");
  return fetchSupabase(
    `utility_organizations?select=id,name,slug,status,launch_status,primary_contact_email,support_email,metadata&id=in.(${idList})&status=neq.archived`
  );
}

async function listContactOrganizations(user) {
  const email = cleanEmail(user.email);
  if (!email) return [];

  const organizations = await fetchSupabase(
    "utility_organizations?select=id,name,slug,status,launch_status,primary_contact_email,support_email,metadata&status=neq.archived"
  );
  return (organizations || []).filter((organization) => getContactEmails(organization).has(email));
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  try {
    const user = await verifyUser(getBearerToken(req));
    const [memberOrganizations, contactOrganizations] = await Promise.all([
      listMemberOrganizations(user),
      listContactOrganizations(user),
    ]);

    const byId = new Map();
    [...memberOrganizations, ...contactOrganizations].forEach((organization) => {
      if (organization?.id) byId.set(organization.id, organization);
    });

    const organizations = [...byId.values()].sort(sortOrganizationsForAccess);
    const activeOrganization = organizations[0] || null;
    return res.status(200).json({
      hasAccess: Boolean(activeOrganization),
      organization: activeOrganization,
      organizations,
      portalUrl: activeOrganization ? buildPortalUrl(activeOrganization) : "",
      workspaceUrl: activeOrganization ? buildWorkspaceUrl(activeOrganization) : "",
    });
  } catch (error) {
    const status = Number(error?.status) || 500;
    return res.status(status).json({
      error: error instanceof Error ? error.message : "Unable to load utility access.",
    });
  }
};
