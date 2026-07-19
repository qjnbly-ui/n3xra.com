const RATE_LIMIT_WINDOW_MS = 30 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 1;
const RECENT_REQUESTS = globalThis.__n3xraSupportRequests || new Map();
globalThis.__n3xraSupportRequests = RECENT_REQUESTS;

const ALLOWED_TOPICS = new Set([
  "billing",
  "account-access",
  "library-sharing",
  "file-issues",
  "technical-support",
  "other",
]);

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(ip) {
  const now = Date.now();
  const current = RECENT_REQUESTS.get(ip) || [];
  const recent = current.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    RECENT_REQUESTS.set(ip, recent);
    return true;
  }
  recent.push(now);
  RECENT_REQUESTS.set(ip, recent);

  for (const [storedIp, timestamps] of RECENT_REQUESTS.entries()) {
    const active = timestamps.filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS);
    if (active.length) RECENT_REQUESTS.set(storedIp, active);
    else RECENT_REQUESTS.delete(storedIp);
  }

  return false;
}

function hasSuspiciousRandomText(payload) {
  const fields = [payload.name, payload.organization, payload.subject];
  return fields.some((value) => {
    const compact = String(value || "").replace(/[^a-zA-Z]/g, "");
    if (compact.length < 18) return false;
    const vowelCount = (compact.match(/[aeiou]/gi) || []).length;
    const vowelRatio = vowelCount / compact.length;
    const hasNormalSpacing = String(value || "").trim().includes(" ");
    return !hasNormalSpacing && (vowelRatio < 0.2 || vowelRatio > 0.65);
  });
}

function validatePayload(payload) {
  if (!payload.name || !payload.email || !payload.topic || !payload.subject || !payload.message) {
    return "All required fields must be filled out.";
  }

  const limits = {
    name: 90,
    email: 160,
    organization: 120,
    topic: 40,
    subject: 140,
    message: 2000,
  };

  for (const [field, limit] of Object.entries(limits)) {
    if (String(payload[field] || "").length > limit) {
      return `${field[0].toUpperCase()}${field.slice(1)} is too long.`;
    }
  }

  if (!ALLOWED_TOPICS.has(payload.topic)) {
    return "Select a valid support topic.";
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(payload.email)) {
    return "Enter a valid email address.";
  }

  if (hasSuspiciousRandomText(payload)) {
    return "This request could not be verified. Please use your real name and a clear subject.";
  }

  return null;
}

async function verifyTurnstile(token, req) {
  const secretKey = process.env.TURNSTILE_SECRET_KEY || process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;
  if (!secretKey) {
    return { ok: false, error: "Missing TURNSTILE_SECRET_KEY." };
  }

  if (!token) {
    return { ok: false, error: "Please complete the security check." };
  }

  const formData = new URLSearchParams();
  formData.append("secret", secretKey);
  formData.append("response", token);
  formData.append("remoteip", getClientIp(req));

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: formData,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.success) {
    return { ok: false, error: "Security check failed. Please try again." };
  }

  return { ok: true };
}

function buildTextEmail(payload) {
  return [
    "New support request from n3xra.com",
    "",
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Organization: ${payload.organization || "-"}`,
    `Topic: ${payload.topic}`,
    `Subject: ${payload.subject}`,
    "",
    "Message:",
    payload.message,
  ].join("\n");
}

function buildHtmlEmail(payload) {
  return `
    <div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#0b1219 0%,#101925 52%,#0c141c 100%);border-radius:24px 24px 0 0;padding:28px 32px;color:#ffffff;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#bfe6dd;">N3XRA Notification</p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:700;">New support request</h1>
          <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.78);">A visitor submitted a new support request through n3xra.com.</p>
        </div>
        <div style="background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-top:0;border-radius:0 0 24px 24px;padding:28px 32px;box-shadow:0 24px 60px rgba(12,18,28,0.12);">
          <div style="margin:0 0 20px;padding:16px 18px;border-radius:18px;background:linear-gradient(180deg,#f8fbfa 0%,#f4f7fb 100%);border:1px solid #dce6f0;">
            <p style="margin:0;font-size:14px;color:#5d6979;">Review the request details below. Replying to this email will go to the sender.</p>
          </div>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${[
              ["Name", payload.name],
              ["Email", payload.email],
              ["Organization", payload.organization || "-"],
              ["Topic", payload.topic],
              ["Subject", payload.subject],
              ["Message", payload.message],
            ].map(([label, value]) => `
              <tr>
                <td style="padding:0 0 14px;">
                  <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                    <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">${escapeHtml(label)}</p>
                    <p style="margin:0;font-size:15px;font-weight:700;color:#0f1620;white-space:pre-wrap;">${escapeHtml(value)}</p>
                  </div>
                </td>
              </tr>`).join("")}
          </table>
        </div>
      </div>
    </div>
  `;
}

async function saveSupportRequest(payload, emailMessageId = null) {
  const supabaseUrl = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
  if (!supabaseUrl || !serviceKey) return null;

  const response = await fetch(`${supabaseUrl}/rest/v1/platform_support_requests`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify({
      requester_name: payload.name,
      requester_email: payload.email,
      organization_name: payload.organization || null,
      topic: payload.topic,
      subject: payload.subject,
      message: payload.message,
      source: "website",
      email_message_id: emailMessageId || null,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(String(data?.message || data?.error || "Unable to save support request."));
  }
  const rows = await response.json().catch(() => []);
  return rows?.[0] || null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: "Please wait 30 seconds before sending another support request." });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(500).json({ error: "Missing RESEND_API_KEY." });
  }

  let body = {};
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  } catch {
    return res.status(400).json({ error: "Invalid request body." });
  }

  const payload = {
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    organization: String(body.organization || "").trim(),
    topic: String(body.topic || "").trim(),
    subject: String(body.subject || "").trim(),
    message: String(body.message || "").trim(),
    company: String(body.company || "").trim(),
    website: String(body.website || "").trim(),
    turnstileToken: String(body["cf-turnstile-response"] || body.turnstileToken || "").trim(),
  };

  if (payload.company || payload.website) {
    return res.status(200).json({ ok: true });
  }

  const validationError = validatePayload(payload);
  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  const turnstile = await verifyTurnstile(payload.turnstileToken, req);
  if (!turnstile.ok) {
    return res.status(400).json({ error: turnstile.error });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "n3xra.com Support <noreply@n3xra.com>",
        to: ["support@n3xra.com"],
        subject: `[Support] ${payload.subject}`,
        html: buildHtmlEmail(payload),
        text: buildTextEmail(payload),
        reply_to: payload.email,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: String(data?.message || data?.error || "Unable to send support email."),
      });
    }

    let requestRecord = null;
    try {
      requestRecord = await saveSupportRequest(payload, data?.id || null);
    } catch (saveError) {
      console.error("Support request email sent but queue persistence failed:", saveError);
    }

    return res.status(200).json({ ok: true, id: data?.id || null, requestId: requestRecord?.id || null });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to send support email.",
    });
  }
}
