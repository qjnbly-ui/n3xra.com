const MAIN_SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const MAIN_SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const PARTNERS_NOTIFY_TO = String(process.env.PARTNERS_ONBOARDING_NOTIFY_TO || "quentin@n3xra.com")
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

function normalizeProducts(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanString(item, 120)).filter(Boolean).slice(0, 12);
}

function parseBody(req) {
  if (typeof req.body === "string") {
    return JSON.parse(req.body || "{}");
  }
  return req.body || {};
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""));
}

function buildTextEmail(payload) {
  return [
    "New N3XRA Partner application",
    "",
    `Name: ${payload.full_name}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone || "-"}`,
    `Organization: ${payload.organization || "-"}`,
    `Website / social: ${payload.website || "-"}`,
    `Referral source: ${payload.audience_source}`,
    `Products: ${payload.interested_products.join(", ") || "-"}`,
    `Payout country: ${payload.payout_country || "-"}`,
    "",
    "Referral plan:",
    payload.referral_plan || "-",
    "",
    `Application ID: ${payload.id || "-"}`,
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

function buildHtmlEmail(payload) {
  return `
    <div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.6;">
      <div style="max-width:680px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#07111d 0%,#0c1524 54%,#06100e 100%);border-radius:24px 24px 0 0;padding:28px 32px;color:#ffffff;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#9ff2d2;">N3XRA Partner Programs</p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:700;">New partner application</h1>
          <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.78);">
            A potential partner submitted the onboarding form.
          </p>
        </div>

        <div style="background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-top:0;border-radius:0 0 24px 24px;padding:28px 32px;box-shadow:0 24px 60px rgba(12,18,28,0.12);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${detailCard("Name", payload.full_name)}
            ${detailCard("Email", payload.email)}
            ${detailCard("Phone", payload.phone)}
            ${detailCard("Organization", payload.organization)}
            ${detailCard("Website / Social", payload.website)}
            ${detailCard("Referral source", payload.audience_source)}
            ${detailCard("Products", payload.interested_products.join(", "))}
            ${detailCard("Payout country", payload.payout_country)}
            ${detailCard("Referral plan", payload.referral_plan)}
            ${detailCard("Application ID", payload.id)}
          </table>
        </div>
      </div>
    </div>
  `;
}

async function insertPartnerApplication(payload) {
  if (!MAIN_SUPABASE_URL || !MAIN_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase service configuration.");
  }

  const response = await fetch(`${MAIN_SUPABASE_URL}/rest/v1/founding_partner_applications`, {
    method: "POST",
    headers: {
      apikey: MAIN_SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${MAIN_SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
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
    const message = String(data?.message || data?.error || data?.msg || `Supabase insert failed with status ${response.status}.`);
    throw new Error(message);
  }

  return Array.isArray(data) ? data[0] || null : data;
}

async function sendNotification(payload) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey || !PARTNERS_NOTIFY_TO.length) return null;

  const invalidNotify = PARTNERS_NOTIFY_TO.find((email) => !isValidEmail(email));
  if (invalidNotify) {
    throw new Error("Invalid partner notification email configuration.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "N3XRA Partners <noreply@n3xra.com>",
      to: PARTNERS_NOTIFY_TO,
      subject: `[N3XRA Partners] Application: ${payload.full_name}`,
      html: buildHtmlEmail(payload),
      text: buildTextEmail(payload),
      reply_to: payload.email,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || "Unable to send partner notification."));
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

  const payload = {
    full_name: cleanString(body.full_name || body.fullName, 180),
    email: cleanEmail(body.email),
    phone: cleanString(body.phone, 80),
    organization: cleanString(body.organization, 180),
    website: cleanString(body.website, 500),
    audience_source: cleanString(body.audience_source || body.audienceSource, 180),
    interested_products: normalizeProducts(body.interested_products || body.interestedProducts),
    referral_plan: cleanString(body.referral_plan || body.referralPlan, 3000),
    payout_country: cleanString(body.payout_country || body.payoutCountry, 120),
    consent: Boolean(body.consent),
    status: "submitted",
    metadata: {
      source: "partners_page",
      program: "n3xra_partner_programs",
      selected_programs: normalizeProducts(body.interested_products || body.interestedProducts),
      commission_amount_usd: 100,
      minimum_service_months: 12,
      submitted_at: new Date().toISOString(),
      user_agent: cleanString(req.headers?.["user-agent"], 500),
      referer: cleanString(req.headers?.referer || req.headers?.referrer, 500),
    },
  };

  const honeypot = cleanString(body.company, 200);
  if (honeypot) {
    return res.status(200).json({ ok: true });
  }

  if (!payload.full_name || !payload.email || !payload.audience_source || !payload.referral_plan) {
    return res.status(400).json({ error: "Name, email, referral source, and referral plan are required." });
  }

  if (!isValidEmail(payload.email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  if (!payload.interested_products.length) {
    return res.status(400).json({ error: "Select at least one product you expect to refer." });
  }

  if (!payload.consent) {
    return res.status(400).json({ error: "Program review consent is required." });
  }

  try {
    const inserted = await insertPartnerApplication(payload);
    const savedPayload = { ...payload, id: inserted?.id || null };
    let notificationId = null;
    try {
      notificationId = await sendNotification(savedPayload);
    } catch (notificationError) {
      console.error("Partner notification failed:", notificationError);
    }

    return res.status(200).json({
      ok: true,
      id: inserted?.id || null,
      notification_id: notificationId,
    });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to submit partner application.",
    });
  }
}
