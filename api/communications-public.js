const {
  clean,
  hashRequestIp,
  loadPublicWorkspace,
  loadSignupSource,
  loadSourceByType,
  sendJson,
  supabaseJson,
} = require("./_communications");

const recentSubmissions = new Map();

function isRateLimited(ipHash) {
  const now = Date.now();
  const recent = (recentSubmissions.get(ipHash) || []).filter((time) => now - time < 60 * 60 * 1000);
  if (recent.length >= 12) return true;
  recent.push(now);
  recentSubmissions.set(ipHash, recent);
  return false;
}

async function hasPersistentRateLimit(ipHash) {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const rows = await supabaseJson(
    `website_form_submissions?select=id&request_ip_hash=eq.${encodeURIComponent(ipHash)}&submitted_at=gte.${encodeURIComponent(since)}&limit=13`,
  );
  return Array.isArray(rows) && rows.length >= 12;
}

function normalizedRequestOrigin(req) {
  return clean(req?.headers?.origin, 500).replace(/\/+$/, "").toLowerCase();
}

function originIsAllowed(data, origin) {
  return Boolean(origin) && (data.form.allowed_origins || []).map((value) => String(value).toLowerCase()).includes(origin);
}

function applyCors(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

function publicWorkspacePayload(data, sourceToken = "") {
  const channelStatuses = new Map(data.channels.map((item) => [item.channel, item.status]));
  const consent = data.form.active_consent_configuration || {};
  return {
    slug: data.workspace.slug,
    programName: data.workspace.program_name,
    senderName: data.workspace.sender_name,
    websiteUrl: data.workspace.website_url,
    privacyPolicyUrl: data.workspace.privacy_policy_url,
    programTermsUrl: data.workspace.program_terms_url,
    supportEmail: data.workspace.support_email,
    supportPhone: data.workspace.support_phone,
    expectedMessageFrequency: data.workspace.expected_message_frequency,
    phoneNumber: data.number?.phone_e164 || "",
    form: {
      name: data.form.name,
      fields: data.fields,
      successMessage: data.form.success_message,
    },
    channels: {
      sms: { available: channelStatuses.get("sms") === "active", disclosure: consent.sms || null },
      email: {
        available: ["pending_setup", "pending_verification", "active"].includes(channelStatuses.get("email")) && Boolean(consent.email),
        deliveryReady: channelStatuses.get("email") === "active",
        disclosure: consent.email || null,
      },
    },
    topics: data.topics,
    ...(sourceToken ? { sourceToken } : {}),
  };
}

async function handleSubscribe(req, res) {
  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
  if (clean(body.company, 200)) return sendJson(res, 200, { ok: true, message: "Your preferences are saved." });

  const data = await loadPublicWorkspace(body.workspace);
  if (!data) return sendJson(res, 404, { error: "This subscription page is not active." });
  const origin = normalizedRequestOrigin(req);
  if (originIsAllowed(data, origin)) applyCors(res, origin);
  const source = await loadSignupSource(data.form.id, body.sourceToken);
  if (!source) return sendJson(res, 400, { error: "This signup link is invalid or expired." });

  const smsConsent = body.smsConsent === true;
  const emailConsent = body.emailConsent === true;
  const topicIds = [...new Set((Array.isArray(body.topicIds) ? body.topicIds : []).map((value) => clean(value, 36)).filter(Boolean))];
  const idempotencyKey = clean(body.idempotencyKey, 200);
  if (!smsConsent && !emailConsent) return sendJson(res, 400, { error: "Choose text messages, email, or both." });
  if (!/^[A-Za-z0-9_-]{16,200}$/.test(idempotencyKey)) {
    return sendJson(res, 400, { error: "This submission could not be verified." });
  }

  const ipHash = hashRequestIp(req);
  if (isRateLimited(ipHash) || await hasPersistentRateLimit(ipHash)) {
    return sendJson(res, 429, { error: "Too many requests. Please try again later." });
  }

  const sourcePage = clean(body.sourcePage, 1000);
  const consentVersions = body.consentVersions && typeof body.consentVersions === "object"
    ? body.consentVersions
    : {};
  await supabaseJson("rpc/ingest_website_form_submission", {
    method: "POST",
    headers: { "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({
      input_form_public_id: data.form.public_id,
      input_source_token: source.public_token,
      input_idempotency_key: idempotencyKey,
      input_origin: origin,
      input_source_page: sourcePage,
      input_values: {
        full_name: clean(body.fullName, 160),
        phone: clean(body.phone, 40),
        email: clean(body.email, 320),
      },
      input_topic_ids: topicIds,
      input_channels: [smsConsent ? "sms" : "", emailConsent ? "email" : ""].filter(Boolean),
      input_consent_versions: consentVersions,
      input_ip_hash: ipHash,
      input_user_agent: clean(req.headers["user-agent"], 500),
      input_link_contact: false,
    }),
  });

  return sendJson(res, 200, { ok: true, message: data.form.success_message });
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      const data = await loadPublicWorkspace(req.query?.workspace);
      const origin = normalizedRequestOrigin(req);
      if (!data || !originIsAllowed(data, origin)) return res.status(403).send("Origin is not allowed.");
      applyCors(res, origin);
      return res.status(204).send("");
    }
    if (req.method === "GET") {
      const data = await loadPublicWorkspace(req.query?.workspace);
      if (!data) return sendJson(res, 404, { error: "This subscription page is not active." });
      const sourceType = clean(req.query?.sourceType, 50).toLowerCase();
      if (sourceType) {
        if (sourceType !== "website_embed") return sendJson(res, 400, { error: "This signup source is unavailable." });
        const origin = normalizedRequestOrigin(req);
        if (!originIsAllowed(data, origin)) return sendJson(res, 403, { error: "This website is not allowed to use the signup form." });
        const source = await loadSourceByType(data.form.id, sourceType);
        if (!source) return sendJson(res, 404, { error: "This signup source is unavailable." });
        applyCors(res, origin);
        return sendJson(res, 200, publicWorkspacePayload(data, source.public_token));
      }
      const requestedSource = clean(req.query?.source, 200);
      if (requestedSource && !await loadSignupSource(data.form.id, requestedSource)) {
        return sendJson(res, 404, { error: "This signup link is invalid or expired." });
      }
      return sendJson(res, 200, publicWorkspacePayload(data));
    }
    if (req.method === "POST") return handleSubscribe(req, res);
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    console.error("Communications public request failed:", error);
    const message = String(error?.message || "");
    const safe = /unavailable|invalid|outdated|required|choose|separate subscriber|origin|source|verified/i.test(message)
      ? message
      : "We could not save your preferences right now.";
    return sendJson(res, 500, { error: safe });
  }
};

module.exports.publicWorkspacePayload = publicWorkspacePayload;
module.exports.originIsAllowed = originIsAllowed;
