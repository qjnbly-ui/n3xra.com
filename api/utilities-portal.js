const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
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

async function fetchSupabase(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase service configuration.");
  }

  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(options.headers || {}),
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
    const message = String(data?.message || data?.error || data?.msg || `Supabase request failed with status ${response.status}.`);
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data;
}

function getRequestUrl(req) {
  const proto = req.headers?.["x-forwarded-proto"] || "https";
  const host = req.headers?.host || "n3xra.com";
  return new URL(req.url || "/api/utilities-portal", `${proto}://${host}`);
}

function getSlug(req) {
  const url = getRequestUrl(req);
  return cleanString(url.searchParams.get("slug"), 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
}

function first(rows) {
  return Array.isArray(rows) ? rows[0] || null : rows || null;
}

function safeOrganization(row) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    legal_name: row.legal_name,
    status: row.status,
    launch_status: row.launch_status,
    utility_types: Array.isArray(row.utility_types) ? row.utility_types : [],
    support_email: row.support_email,
    support_phone: row.support_phone,
    emergency_phone: row.emergency_phone,
    website: row.website,
  };
}

function safeBranding(row, organization) {
  const metadata = row?.metadata && typeof row.metadata === "object" ? row.metadata : {};
  return {
    portal_display_name: row?.portal_display_name || organization.name,
    logo_url: metadata.logo_url || null,
    primary_color: row?.primary_color || "#2de0a5",
    secondary_color: row?.secondary_color || "#23b9ff",
    accent_color: row?.accent_color || row?.secondary_color || "#23b9ff",
    email_from_name: row?.email_from_name || organization.name,
  };
}

function safeSettings(row) {
  const modules = row?.modules && typeof row.modules === "object" ? row.modules : {};
  const paymentPreferences = row?.payment_preferences && typeof row.payment_preferences === "object" ? row.payment_preferences : {};
  return {
    modules,
    service_types: Array.isArray(row?.service_types) ? row.service_types : [],
    payment: {
      mode: paymentPreferences.payment_mode || "not_configured",
      existing_payment_url: paymentPreferences.existing_payment_url || null,
      wants_stripe_connect: Boolean(paymentPreferences.wants_stripe_connect),
    },
  };
}

function safeDomain(row) {
  if (!row) return null;
  return {
    domain: row.domain,
    domain_type: row.domain_type,
    verification_status: row.verification_status,
    is_primary: Boolean(row.is_primary),
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const slug = getSlug(req);
  if (!slug) return res.status(400).json({ error: "Missing portal slug." });

  try {
    const organization = first(await fetchSupabase(
      `utility_organizations?select=id,name,slug,legal_name,status,launch_status,utility_types,support_email,support_phone,emergency_phone,website&slug=eq.${encodeFilter(slug)}&status=neq.archived&limit=1`
    ));
    if (!organization) return res.status(404).json({ error: "Utility portal not found." });

    const [branding, settings, domains, launchSteps] = await Promise.all([
      fetchSupabase(`utility_organization_branding?select=portal_display_name,logo_storage_path,primary_color,secondary_color,accent_color,email_from_name,metadata&organization_id=eq.${encodeFilter(organization.id)}&limit=1`),
      fetchSupabase(`utility_organization_settings?select=modules,service_types,payment_preferences,notification_settings,launch_checklist&organization_id=eq.${encodeFilter(organization.id)}&limit=1`),
      fetchSupabase(`utility_organization_domains?select=domain,domain_type,verification_status,is_primary&organization_id=eq.${encodeFilter(organization.id)}&order=is_primary.desc,created_at.asc&limit=3`),
      fetchSupabase(`utility_portal_launch_steps?select=step_key,title,status,required,sort_order&organization_id=eq.${encodeFilter(organization.id)}&order=sort_order.asc`),
    ]);

    return res.status(200).json({
      ok: true,
      organization: safeOrganization(organization),
      branding: safeBranding(first(branding), organization),
      settings: safeSettings(first(settings)),
      primary_domain: safeDomain(first(domains)),
      launch_steps: Array.isArray(launchSteps) ? launchSteps : [],
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "Unable to load utility portal.",
    });
  }
}
