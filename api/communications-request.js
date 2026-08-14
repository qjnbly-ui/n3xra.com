const {
  clean,
  hashRequestIp,
  normalizeEmail,
  normalizeKeyword,
  normalizePhone,
  resolveRequesterOwnership,
  sendJson,
  supabaseJson,
} = require("./_communications");

const recentRequests = new Map();

function validUrl(value) {
  try {
    const url = new URL(clean(value, 500));
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function optionalNonnegativeInteger(value) {
  const raw = clean(value, 20);
  if (!raw || !Number.isFinite(Number(raw))) return null;
  return Math.max(0, Math.round(Number(raw)));
}

function isRateLimited(ipHash) {
  const now = Date.now();
  const recent = (recentRequests.get(ipHash) || []).filter((time) => now - time < 24 * 60 * 60 * 1000);
  if (recent.length >= 4) return true;
  recent.push(now);
  recentRequests.set(ipHash, recent);
  return false;
}

async function hasPersistentRateLimit(ipHash) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const rows = await supabaseJson(
    `communications_number_requests?select=id&ip_hash=eq.${encodeURIComponent(ipHash)}&created_at=gte.${encodeURIComponent(since)}&limit=5`,
  );
  return Array.isArray(rows) && rows.length >= 4;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    if (clean(body.company, 200)) return sendJson(res, 200, { ok: true });
    const ipHash = hashRequestIp(req);
    if (isRateLimited(ipHash) || await hasPersistentRateLimit(ipHash)) {
      return sendJson(res, 429, { error: "Too many requests. Please try again tomorrow." });
    }

    const channels = [...new Set((Array.isArray(body.channels) ? body.channels : [])
      .map((value) => clean(value, 10).toLowerCase())
      .filter((value) => ["sms", "email"].includes(value)))];
    const ownership = await resolveRequesterOwnership(req, body.websiteUrl);
    const payload = {
      organization_id: ownership.organizationId,
      website_id: ownership.websiteId,
      requester_user_id: ownership.requesterUserId,
      organization_name: clean(body.organizationName, 180),
      website_url: validUrl(body.websiteUrl),
      primary_contact_name: clean(body.contactName, 160),
      primary_contact_email: normalizeEmail(body.contactEmail),
      primary_contact_phone: normalizePhone(body.contactPhone) || null,
      preferred_area_code: clean(body.areaCode, 3) || null,
      intended_use: clean(body.intendedUse, 2000),
      estimated_subscriber_count: optionalNonnegativeInteger(body.estimatedSubscribers),
      estimated_monthly_message_volume: optionalNonnegativeInteger(body.estimatedMessages),
      requested_topics: [...new Set((Array.isArray(body.topics) ? body.topics : [])
        .map((value) => clean(value, 80))
        .filter(Boolean))].slice(0, 20),
      requested_keyword: normalizeKeyword(body.keyword) || null,
      requested_channels: channels,
      example_messages: clean(body.exampleMessages, 3000),
      privacy_policy_url: validUrl(body.privacyPolicyUrl),
      terms_url: validUrl(body.termsUrl),
      ip_hash: ipHash,
    };

    if (!payload.organization_name || !payload.website_url || !payload.primary_contact_name
      || !payload.primary_contact_email || !payload.intended_use || !payload.example_messages
      || !payload.privacy_policy_url || !payload.terms_url || !channels.length) {
      return sendJson(res, 400, { error: "Complete all required request details." });
    }
    if (payload.preferred_area_code && !/^[0-9]{3}$/.test(payload.preferred_area_code)) {
      return sendJson(res, 400, { error: "Enter a three-digit preferred area code." });
    }
    if (payload.requested_keyword && !/^[A-Z0-9]{2,20}$/.test(payload.requested_keyword)) {
      return sendJson(res, 400, { error: "Use 2–20 letters or numbers for the keyword." });
    }

    const rows = await supabaseJson("communications_number_requests", {
      method: "POST",
      headers: { "Content-Type": "application/json", Prefer: "return=representation" },
      body: JSON.stringify(payload),
    });
    return sendJson(res, 201, {
      ok: true,
      requestId: Array.isArray(rows) ? rows[0]?.id || "" : "",
      message: "Your Nexra Number request is in review. We’ll follow up within one business day.",
    });
  } catch (error) {
    console.error("Nexra Number request failed:", error);
    return sendJson(res, 500, { error: "We could not submit your request right now." });
  }
};

module.exports.validUrl = validUrl;
module.exports.optionalNonnegativeInteger = optionalNonnegativeInteger;
