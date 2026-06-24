const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const UTILITIES_NOTIFY_TO = String(process.env.UTILITIES_ONBOARDING_NOTIFY_TO || "quentin@n3xra.com")
  .split(",")
  .map((email) => email.trim())
  .filter(Boolean);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanString(value, limit = 1000) {
  return String(value || "").trim().slice(0, limit);
}

function cleanEmail(value) {
  return cleanString(value, 320).toLowerCase();
}

function cleanPhone(value) {
  return cleanString(value, 80);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function parseBody(req) {
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return req.body || {};
}

function normalizeArray(value, limit = 20) {
  const items = Array.isArray(value) ? value : value ? [value] : [];
  return items.map((item) => cleanString(item, 120)).filter(Boolean).slice(0, limit);
}

function normalizeColor(value) {
  const raw = cleanString(value, 20);
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw.toLowerCase() : null;
}

function cleanBoolean(value) {
  if (value === true || value === false) return value;
  const raw = cleanString(value, 20).toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
}

function normalizeUrl(value) {
  const raw = cleanString(value, 600);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    url.hash = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function slugify(value) {
  return cleanString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 63);
}

function normalizeSlug(value, fallback) {
  const slug = slugify(value) || slugify(fallback) || "utility-provider";
  const trimmed = slug.replace(/^-+|-+$/g, "").slice(0, 63);
  if (/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(trimmed)) return trimmed;
  return `${trimmed.replace(/-+$/g, "") || "utility"}-portal`.slice(0, 63).replace(/-+$/g, "");
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
    error.data = data;
    throw error;
  }

  return data;
}

async function slugExists(slug) {
  const rows = await fetchSupabase(`utility_organizations?select=id&slug=eq.${encodeFilter(slug)}&limit=1`, {
    method: "GET",
  });
  return Array.isArray(rows) && rows.length > 0;
}

async function getAvailableSlug(baseSlug) {
  let candidate = baseSlug;
  let suffix = 1;
  while (await slugExists(candidate)) {
    suffix += 1;
    const suffixText = `-${suffix}`;
    candidate = `${baseSlug.slice(0, 63 - suffixText.length).replace(/-+$/g, "")}${suffixText}`;
  }
  return candidate;
}

async function insertRow(table, payload) {
  const rows = await fetchSupabase(table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payload),
  });
  return Array.isArray(rows) ? rows[0] || null : rows;
}

async function insertRows(table, payloads) {
  if (!payloads.length) return [];
  const rows = await fetchSupabase(table, {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(payloads),
  });
  return Array.isArray(rows) ? rows : [];
}

async function deleteOrganization(organizationId) {
  if (!organizationId) return;
  await fetchSupabase(`utility_organizations?id=eq.${encodeFilter(organizationId)}`, {
    method: "DELETE",
  });
}

function buildPortalLaunchSteps(organizationId, payload, slug, domain) {
  return [
    {
      organization_id: organizationId,
      step_key: "company_profile",
      title: "Company profile",
      description: "Core provider details, legal name, utility types, website, and contacts.",
      sort_order: 10,
      status: "completed",
      required: true,
      locked: false,
      metadata: {
        provider_name: payload.providerName,
        legal_name: payload.legalName || null,
        utility_types: payload.utilityTypes,
      },
    },
    {
      organization_id: organizationId,
      step_key: "branding",
      title: "Branding",
      description: "Logo, portal display name, colors, and customer-facing identity.",
      sort_order: 20,
      status: payload.logoUrl ? "completed" : "in_progress",
      required: true,
      locked: false,
      metadata: {
        logo_url: payload.logoUrl || null,
        primary_color: payload.primaryColor,
        secondary_color: payload.secondaryColor,
      },
    },
    {
      organization_id: organizationId,
      step_key: "portal_url",
      title: "Portal URL",
      description: "Reserved N3XRA portal slug and primary portal URL.",
      sort_order: 30,
      status: "completed",
      required: true,
      locked: false,
      metadata: { slug, domain },
    },
    {
      organization_id: organizationId,
      step_key: "admin_account",
      title: "Admin account",
      description: "Primary utility admin account invitation and access setup.",
      sort_order: 40,
      status: "not_started",
      required: true,
      locked: false,
      metadata: {
        primary_admin_name: payload.primaryAdminName,
        primary_admin_email: payload.primaryAdminEmail,
      },
    },
    {
      organization_id: organizationId,
      step_key: "customer_settings",
      title: "Customer settings",
      description: "Customer portal modules, service types, request categories, and notification defaults.",
      sort_order: 50,
      status: "not_started",
      required: true,
      locked: false,
      metadata: {
        service_types: payload.utilityTypes,
      },
    },
    {
      organization_id: organizationId,
      step_key: "payment_setup",
      title: "Payment setup",
      description: "External payment link or Stripe Connect readiness.",
      sort_order: 60,
      status: payload.wantsStripeConnect || payload.existingPaymentUrl ? "in_progress" : "not_started",
      required: Boolean(payload.wantsStripeConnect || payload.existingPaymentUrl),
      locked: false,
      metadata: {
        existing_payment_url: payload.existingPaymentUrl || null,
        wants_stripe_connect: payload.wantsStripeConnect,
      },
    },
    {
      organization_id: organizationId,
      step_key: "dns_setup",
      title: "DNS setup",
      description: "Custom portal domain DNS records and verification.",
      sort_order: 70,
      status: payload.wantsCustomDomain ? "in_progress" : "not_started",
      required: payload.wantsCustomDomain,
      locked: false,
      metadata: {
        wants_custom_domain: payload.wantsCustomDomain,
      },
    },
    {
      organization_id: organizationId,
      step_key: "email_sender_setup",
      title: "Email sender setup",
      description: "Custom email sender DNS records and verification.",
      sort_order: 80,
      status: payload.wantsCustomEmail ? "in_progress" : "not_started",
      required: payload.wantsCustomEmail,
      locked: false,
      metadata: {
        wants_custom_email: payload.wantsCustomEmail,
      },
    },
    {
      organization_id: organizationId,
      step_key: "ready_to_launch",
      title: "Ready to launch",
      description: "Final N3XRA review before the customer portal is marked live.",
      sort_order: 90,
      status: "blocked",
      required: true,
      locked: true,
      metadata: {
        blocked_until: "required_steps_complete",
      },
    },
  ];
}

function buildPayload(body, req) {
  const providerName = cleanString(body.provider_name || body.providerName || body.district, 180);
  const legalName = cleanString(body.legal_name || body.legalName, 220);
  const desiredSlug = normalizeSlug(body.portal_slug || body.portalSlug, providerName);
  const primaryAdminName = cleanString(body.primary_admin_name || body.primaryAdminName || body.contact, 180);
  const primaryAdminEmail = cleanEmail(body.primary_admin_email || body.primaryAdminEmail || body.email);

  return {
    providerName,
    legalName,
    utilityTypes: normalizeArray(body.utility_types || body.utilityTypes),
    primaryAdminName,
    primaryAdminEmail,
    primaryAdminPhone: cleanPhone(body.primary_admin_phone || body.primaryAdminPhone || body.phone),
    supportName: cleanString(body.support_name || body.supportName, 180),
    supportEmail: cleanEmail(body.support_email || body.supportEmail),
    supportPhone: cleanPhone(body.support_phone || body.supportPhone),
    financeName: cleanString(body.finance_name || body.financeName, 180),
    financeEmail: cleanEmail(body.finance_email || body.financeEmail),
    financePhone: cleanPhone(body.finance_phone || body.financePhone),
    logoUrl: normalizeUrl(body.logo_url || body.logoUrl),
    primaryColor: normalizeColor(body.primary_color || body.primaryColor) || "#2de0a5",
    secondaryColor: normalizeColor(body.secondary_color || body.secondaryColor) || "#23b9ff",
    portalSlug: desiredSlug,
    website: normalizeUrl(body.website),
    existingPaymentUrl: normalizeUrl(body.existing_payment_url || body.existingPaymentUrl),
    wantsStripeConnect: cleanBoolean(body.wants_stripe_connect || body.wantsStripeConnect),
    wantsCustomDomain: cleanBoolean(body.wants_custom_domain || body.wantsCustomDomain),
    wantsCustomEmail: cleanBoolean(body.wants_custom_email || body.wantsCustomEmail),
    notes: cleanString(body.notes || body.manual_work || body.manualWork, 3000),
    company: cleanString(body.company, 200),
    metadata: {
      source: "utilities_onboarding",
      submitted_at: new Date().toISOString(),
      user_agent: cleanString(req.headers?.["user-agent"], 500),
      referer: cleanString(req.headers?.referer || req.headers?.referrer, 500),
    },
  };
}

async function createUtilityOrganization(payload) {
  const slug = await getAvailableSlug(payload.portalSlug);
  const domain = `${slug}.utilities.n3xra.com`;
  let organization = null;

  try {
    organization = await insertRow("utility_organizations", {
      name: payload.providerName,
      slug,
      legal_name: payload.legalName || null,
      status: "onboarding",
      launch_status: "draft",
      utility_types: payload.utilityTypes,
      primary_contact_name: payload.primaryAdminName,
      primary_contact_email: payload.primaryAdminEmail,
      primary_contact_phone: payload.primaryAdminPhone || null,
      support_email: payload.supportEmail || payload.primaryAdminEmail,
      support_phone: payload.supportPhone || null,
      website: payload.website || null,
      stripe_connect_status: payload.wantsStripeConnect ? "not_started" : "disabled",
      metadata: {
        ...payload.metadata,
        support_contact_name: payload.supportName || null,
        finance_contact_name: payload.financeName || null,
        finance_contact_email: payload.financeEmail || null,
        finance_contact_phone: payload.financePhone || null,
        wants_custom_domain: payload.wantsCustomDomain,
        wants_custom_email: payload.wantsCustomEmail,
        notes: payload.notes || null,
      },
    });

    const roles = await insertRows("utility_roles", [
      { organization_id: organization.id, name: "owner", display_name: "Owner", is_system: true, permissions: { manage_all: true } },
      { organization_id: organization.id, name: "admin", display_name: "Admin", is_system: true, permissions: { manage_settings: true, manage_members: true } },
      { organization_id: organization.id, name: "staff", display_name: "Staff", is_system: true, permissions: { read_foundation: true } },
      { organization_id: organization.id, name: "finance", display_name: "Finance", is_system: true, permissions: { read_foundation: true, manage_payments: true } },
      { organization_id: organization.id, name: "support", display_name: "Support", is_system: true, permissions: { read_foundation: true, manage_support: true } },
      { organization_id: organization.id, name: "viewer", display_name: "Viewer", is_system: true, permissions: { read_foundation: true } },
    ]);

    await insertRow("utility_organization_branding", {
      organization_id: organization.id,
      portal_display_name: payload.providerName,
      logo_storage_path: null,
      primary_color: payload.primaryColor,
      secondary_color: payload.secondaryColor,
      accent_color: payload.secondaryColor,
      email_from_name: payload.providerName,
      email_reply_to: payload.supportEmail || payload.primaryAdminEmail,
      metadata: {
        logo_url: payload.logoUrl || null,
      },
    });

    await insertRow("utility_organization_settings", {
      organization_id: organization.id,
      modules: {
        customer_portal: true,
        support_requests: true,
        document_uploads: true,
        announcements: true,
        payments: payload.wantsStripeConnect,
        stripe_connect: payload.wantsStripeConnect,
        custom_domain: payload.wantsCustomDomain,
        custom_email: payload.wantsCustomEmail,
      },
      service_types: payload.utilityTypes,
      payment_preferences: {
        existing_payment_url: payload.existingPaymentUrl || null,
        wants_stripe_connect: payload.wantsStripeConnect,
        payment_mode: payload.wantsStripeConnect ? "stripe_connect" : payload.existingPaymentUrl ? "external_link" : "not_configured",
      },
      notification_settings: {
        support_email: payload.supportEmail || payload.primaryAdminEmail,
        custom_sender_requested: payload.wantsCustomEmail,
      },
      launch_checklist: {
        company_profile: "completed",
        branding: payload.logoUrl ? "completed" : "in_progress",
        portal_url: "completed",
        admin_account: "not_started",
        customer_settings: "not_started",
        payment_setup: payload.wantsStripeConnect || payload.existingPaymentUrl ? "in_progress" : "not_started",
        dns_setup: payload.wantsCustomDomain ? "in_progress" : "not_started",
        email_sender_setup: payload.wantsCustomEmail ? "in_progress" : "not_started",
        ready_to_launch: "blocked",
      },
    });

    await insertRows("utility_portal_launch_steps", buildPortalLaunchSteps(organization.id, payload, slug, domain));

    await insertRow("utility_organization_domains", {
      organization_id: organization.id,
      domain,
      domain_type: "n3xra_subdomain",
      verification_status: "not_configured",
      is_primary: true,
      dns_target: "utilities.n3xra.com",
      metadata: {
        requested_custom_domain: payload.wantsCustomDomain,
      },
    });

    const onboardingSession = await insertRow("utility_onboarding_sessions", {
      organization_id: organization.id,
      status: "submitted",
      contact_name: payload.primaryAdminName,
      contact_email: payload.primaryAdminEmail,
      current_step: "n3xra_review",
      metadata: {
        finance_contact_email: payload.financeEmail || null,
        support_contact_email: payload.supportEmail || null,
      },
    });

    await insertRows("utility_onboarding_steps", [
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "company_profile", status: "completed", data: { provider_name: payload.providerName, legal_name: payload.legalName || null } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "branding", status: "completed", data: { logo_url: payload.logoUrl || null, primary_color: payload.primaryColor, secondary_color: payload.secondaryColor } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "portal_url", status: "completed", data: { slug, domain } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "staff_contacts", status: "completed", data: { primary_admin_email: payload.primaryAdminEmail, support_email: payload.supportEmail || null, finance_email: payload.financeEmail || null } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "payments", status: payload.wantsStripeConnect || payload.existingPaymentUrl ? "in_progress" : "not_started", data: { existing_payment_url: payload.existingPaymentUrl || null, wants_stripe_connect: payload.wantsStripeConnect } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "dns", status: payload.wantsCustomDomain ? "in_progress" : "not_started", data: { wants_custom_domain: payload.wantsCustomDomain } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "email_sender", status: payload.wantsCustomEmail ? "in_progress" : "not_started", data: { wants_custom_email: payload.wantsCustomEmail } },
      { organization_id: organization.id, onboarding_session_id: onboardingSession.id, step_key: "n3xra_review", status: "in_progress", data: {} },
    ]);

    await insertRow("utility_audit_events", {
      organization_id: organization.id,
      actor_type: "system",
      event_type: "utility_onboarding_submitted",
      target_table: "utility_onboarding_sessions",
      target_id: onboardingSession.id,
      metadata: {
        source: "utilities_onboarding",
        slug,
        role_count: roles.length,
      },
    });

    return { organization, onboardingSession, slug, domain };
  } catch (error) {
    await deleteOrganization(organization?.id).catch((rollbackError) => {
      console.error("Utilities onboarding rollback failed:", rollbackError);
    });
    throw error;
  }
}

function buildTextEmail(payload, created) {
  return [
    "New N3XRA Utilities tenant onboarding",
    "",
    `Provider: ${payload.providerName}`,
    `Legal name: ${payload.legalName || "-"}`,
    `Portal slug: ${created.slug}`,
    `Portal domain: ${created.domain}`,
    `Utility types: ${payload.utilityTypes.join(", ") || "-"}`,
    `Primary admin: ${payload.primaryAdminName}`,
    `Primary admin email: ${payload.primaryAdminEmail}`,
    `Support email: ${payload.supportEmail || "-"}`,
    `Finance email: ${payload.financeEmail || "-"}`,
    `Website: ${payload.website || "-"}`,
    `Existing payment URL: ${payload.existingPaymentUrl || "-"}`,
    `Stripe Connect requested: ${payload.wantsStripeConnect ? "Yes" : "No"}`,
    `Custom domain requested: ${payload.wantsCustomDomain ? "Yes" : "No"}`,
    `Custom email requested: ${payload.wantsCustomEmail ? "Yes" : "No"}`,
    "",
    "Notes:",
    payload.notes || "-",
    "",
    `Organization ID: ${created.organization.id}`,
    `Onboarding session ID: ${created.onboardingSession.id}`,
  ].join("\n");
}

function detailCard(label, value) {
  return `
    <tr>
      <td style="padding:0 0 12px;">
        <div style="padding:15px 17px;border:1px solid #e2e8f0;border-radius:16px;background:#ffffff;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">${escapeHtml(label)}</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;white-space:pre-wrap;">${escapeHtml(value || "-")}</p>
        </div>
      </td>
    </tr>
  `;
}

function buildHtmlEmail(payload, created) {
  return `
    <div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.6;">
      <div style="max-width:720px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#07120f 0%,#0d221d 58%,#06100d 100%);border-radius:24px 24px 0 0;padding:28px 32px;color:#ffffff;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#9ff2d2;">N3XRA Utilities</p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:700;">New tenant created</h1>
          <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.78);">A utility provider completed the setup intake and now has foundation records in Supabase.</p>
        </div>
        <div style="background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-top:0;border-radius:0 0 24px 24px;padding:28px 32px;box-shadow:0 24px 60px rgba(12,18,28,0.12);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${detailCard("Provider", payload.providerName)}
            ${detailCard("Legal name", payload.legalName)}
            ${detailCard("Portal", `${created.slug} / ${created.domain}`)}
            ${detailCard("Utility types", payload.utilityTypes.join(", "))}
            ${detailCard("Primary admin", `${payload.primaryAdminName} <${payload.primaryAdminEmail}>`)}
            ${detailCard("Support contact", `${payload.supportName || "-"} ${payload.supportEmail ? `<${payload.supportEmail}>` : ""}`)}
            ${detailCard("Finance contact", `${payload.financeName || "-"} ${payload.financeEmail ? `<${payload.financeEmail}>` : ""}`)}
            ${detailCard("Payments", payload.wantsStripeConnect ? "Stripe Connect requested" : payload.existingPaymentUrl || "Not configured")}
            ${detailCard("Custom domain/email", `Domain: ${payload.wantsCustomDomain ? "Yes" : "No"} | Email: ${payload.wantsCustomEmail ? "Yes" : "No"}`)}
            ${detailCard("Organization ID", created.organization.id)}
          </table>
        </div>
      </div>
    </div>
  `;
}

async function sendNotification(payload, created) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey || !UTILITIES_NOTIFY_TO.length) return null;

  const invalidNotify = UTILITIES_NOTIFY_TO.find((email) => !isValidEmail(email));
  if (invalidNotify) throw new Error("Invalid utilities notification email configuration.");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "N3XRA Utilities <noreply@n3xra.com>",
      to: UTILITIES_NOTIFY_TO,
      subject: `[N3XRA Utilities] Tenant created: ${payload.providerName}`,
      html: buildHtmlEmail(payload, created),
      text: buildTextEmail(payload, created),
      reply_to: payload.primaryAdminEmail,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || "Unable to send onboarding notification."));
  }
  return data?.id || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  let body = {};
  try {
    body = parseBody(req);
  } catch {
    return res.status(400).json({ error: "Invalid JSON body." });
  }

  const payload = buildPayload(body, req);
  if (payload.company) return res.status(200).json({ ok: true });

  if (!payload.providerName || !payload.primaryAdminName || !payload.primaryAdminEmail) {
    return res.status(400).json({ error: "Provider name, primary admin, and primary admin email are required." });
  }

  if (!isValidEmail(payload.primaryAdminEmail)) {
    return res.status(400).json({ error: "Enter a valid primary admin email." });
  }

  if (payload.supportEmail && !isValidEmail(payload.supportEmail)) {
    return res.status(400).json({ error: "Enter a valid support email." });
  }

  if (payload.financeEmail && !isValidEmail(payload.financeEmail)) {
    return res.status(400).json({ error: "Enter a valid billing/finance email." });
  }

  if (!payload.utilityTypes.length) {
    return res.status(400).json({ error: "Select at least one utility type." });
  }

  try {
    const created = await createUtilityOrganization(payload);
    let notificationId = null;
    try {
      notificationId = await sendNotification(payload, created);
    } catch (notificationError) {
      console.error("Utilities onboarding notification failed:", notificationError);
    }

    return res.status(200).json({
      ok: true,
      organization_id: created.organization.id,
      onboarding_session_id: created.onboardingSession.id,
      slug: created.slug,
      domain: created.domain,
      notification_id: notificationId,
    });
  } catch (error) {
    return res.status(error?.status || 500).json({
      error: error instanceof Error ? error.message : "Unable to create utility onboarding records.",
    });
  }
}
