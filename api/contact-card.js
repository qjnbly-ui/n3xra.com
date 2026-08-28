const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim().replace(/\/$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

const PUBLIC_COLUMNS = [
  "slug",
  "display_name",
  "headline",
  "company_name",
  "bio",
  "email",
  "email_label",
  "additional_emails",
  "additional_email_labels",
  "phone_e164",
  "phone_label",
  "additional_phones",
  "additional_phone_labels",
  "website_url",
  "location_text",
  "links",
  "profile_image_path",
  "company_logo_path",
  "background_image_path",
  "section_order",
  "accent_color",
  "show_n3xra_branding",
  "exchange_enabled",
].join(",");
const INTERNAL_COLUMNS = `${PUBLIC_COLUMNS},owner_user_id`;

function send(res, status, body) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  return res.status(status).json(body);
}

function serviceHeaders(extra = {}) {
  const credentials = SERVICE_KEY.startsWith("sb_secret_")
    ? { apikey: SERVICE_KEY }
    : { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
  return { ...credentials, ...extra };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return send(res, 405, { error: "Method not allowed." });
  }
  const slug = String(req.query?.slug || "").trim().toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return send(res, 400, { error: "This card address is not valid." });
  if (!SUPABASE_URL || !SERVICE_KEY) return send(res, 503, { error: "Digital cards are temporarily unavailable." });

  try {
    const params = new URLSearchParams({ select: INTERNAL_COLUMNS, slug: `eq.${slug}`, status: "eq.published", limit: "1" });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/contact_card_profiles?${params}`, {
      headers: serviceHeaders({ Accept: "application/json" }),
    });
    if (!response.ok) return send(res, 503, { error: "Digital cards are temporarily unavailable." });
    const rows = await response.json();
    const card = Array.isArray(rows) ? rows[0] : null;
    if (!card) return send(res, 404, { error: "This digital card is not published right now." });
    const entitlementParams = new URLSearchParams({ select: "premium_active,branding_removal,premium_trial_ends_at", owner_user_id: `eq.${card.owner_user_id}`, limit: "1" });
    const entitlementResponse = await fetch(`${SUPABASE_URL}/rest/v1/contact_card_entitlements?${entitlementParams}`, {
      headers: serviceHeaders({ Accept: "application/json" }),
    });
    const entitlements = entitlementResponse.ok ? await entitlementResponse.json() : [];
    const entitlement = Array.isArray(entitlements) ? entitlements[0] : null;
    const hasPaidPremium = entitlement?.premium_active === true;
    const hasTrialAccess = Boolean(entitlement?.premium_trial_ends_at && new Date(entitlement.premium_trial_ends_at).getTime() > Date.now());
    const hasPremiumTools = hasPaidPremium || hasTrialAccess;
    const canHideBranding = hasPaidPremium || entitlement?.branding_removal === true;
    const { owner_user_id, profile_image_path, company_logo_path, background_image_path, ...publicCard } = card;
    return send(res, 200, {
      card: {
        ...publicCard,
        exchange_enabled: hasPremiumTools && publicCard.exchange_enabled !== false,
        show_n3xra_branding: canHideBranding ? publicCard.show_n3xra_branding !== false : true,
        media: {
          profile: Boolean(profile_image_path),
          logo: Boolean(company_logo_path),
          background: Boolean(background_image_path),
        },
      },
    });
  } catch {
    return send(res, 503, { error: "Digital cards are temporarily unavailable." });
  }
}
