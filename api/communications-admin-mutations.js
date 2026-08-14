const {
  clean,
  requirePlatformAdmin,
  sendJson,
  supabaseJson,
} = require("./_communications");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  throw error;
}

function requiredUuid(value, label) {
  const normalized = clean(value, 80);
  if (!UUID_PATTERN.test(normalized)) badRequest(`${label} is invalid.`);
  return normalized;
}

function optionalUuid(value, label) {
  const normalized = clean(value, 80);
  if (!normalized) return null;
  if (!UUID_PATTERN.test(normalized)) badRequest(`${label} is invalid.`);
  return normalized;
}

function requiredText(value, label, minimum, maximum) {
  const normalized = clean(value, maximum);
  if (normalized.length < minimum) badRequest(`${label} is required.`);
  return normalized;
}

function requiredUrl(value, label) {
  const normalized = clean(value, 500);
  try {
    const url = new URL(normalized);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("protocol");
    return url.toString();
  } catch {
    badRequest(`${label} must be a valid HTTP or HTTPS URL.`);
  }
}

function requiredEmail(value) {
  const normalized = clean(value, 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized)) badRequest("Support email is invalid.");
  return normalized;
}

function optionalPhone(value) {
  const normalized = clean(value, 30);
  if (!normalized) return null;
  if (!/^\+[1-9][0-9]{7,14}$/.test(normalized)) badRequest("Support phone must use E.164 format.");
  return normalized;
}

function integer(value, label, maximum = 100000000) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > maximum) badRequest(`${label} is invalid.`);
  return parsed;
}

function boolean(value, label) {
  if (typeof value !== "boolean") badRequest(`${label} is invalid.`);
  return value;
}

function choice(value, label, choices) {
  const normalized = clean(value, 50).toLowerCase();
  if (!choices.includes(normalized)) badRequest(`${label} is invalid.`);
  return normalized;
}

function allowedOrigins(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    badRequest("Provide between one and twenty allowed origins.");
  }
  const normalized = value.map((candidate) => {
    const text = clean(candidate, 300);
    try {
      const url = new URL(text);
      const isLocalhost = url.protocol === "http:" && url.hostname === "localhost";
      if (url.protocol !== "https:" && !isLocalhost) throw new Error("protocol");
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("origin");
      return url.origin;
    } catch {
      badRequest("Allowed origins must be HTTPS origins or localhost development origins.");
    }
  });
  return [...new Set(normalized)];
}

function workspaceArguments(body, actorUserId, idempotencyKey) {
  const slug = requiredText(body.slug, "Workspace slug", 2, 80).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) badRequest("Workspace slug may contain lowercase letters, numbers, and single hyphens.");
  return {
    input_actor_user_id: actorUserId,
    input_idempotency_key: idempotencyKey,
    input_workspace_id: optionalUuid(body.workspaceId, "Workspace"),
    input_organization_id: requiredUuid(body.organizationId, "Organization"),
    input_website_id: optionalUuid(body.websiteId, "Website"),
    input_slug: slug,
    input_program_name: requiredText(body.programName, "Program name", 2, 120),
    input_sender_name: requiredText(body.senderName, "Sender name", 2, 120),
    input_website_url: requiredUrl(body.websiteUrl, "Website URL"),
    input_privacy_policy_url: requiredUrl(body.privacyPolicyUrl, "Privacy policy URL"),
    input_program_terms_url: requiredUrl(body.programTermsUrl, "Program terms URL"),
    input_support_email: requiredEmail(body.supportEmail),
    input_support_phone: optionalPhone(body.supportPhone),
    input_expected_message_frequency: requiredText(body.expectedMessageFrequency, "Expected message frequency", 3, 240),
    input_workspace_status: choice(body.workspaceStatus, "Workspace status", ["setup", "carrier_pending", "paused", "canceled"]),
    input_entitlement_status: choice(body.entitlementStatus, "Entitlement status", ["trialing", "active", "paused", "canceled"]),
    input_portal_enabled: boolean(body.portalEnabled, "Portal access"),
    input_included_sms_segments: integer(body.includedSmsSegments, "Included SMS segments"),
    input_sms_overage_cents: integer(body.smsOverageCents, "SMS overage", 100000),
    input_mms_unit_cents: integer(body.mmsUnitCents, "MMS unit price", 100000),
  };
}

function formArguments(body, actorUserId, idempotencyKey) {
  const emailEnabled = boolean(body.emailEnabled, "Email collection");
  const smsEnabled = boolean(body.smsEnabled, "Text collection");
  if (!emailEnabled && !smsEnabled) badRequest("Enable email, texting, or both.");
  return {
    input_actor_user_id: actorUserId,
    input_idempotency_key: idempotencyKey,
    input_workspace_id: requiredUuid(body.workspaceId, "Workspace"),
    input_form_id: optionalUuid(body.formId, "Form"),
    input_website_id: requiredUuid(body.websiteId, "Website"),
    input_name: requiredText(body.name, "Form name", 2, 120),
    input_status: choice(body.status, "Form status", ["draft", "active", "paused", "archived"]),
    input_success_message: requiredText(body.successMessage, "Success message", 2, 500),
    input_allowed_origins: allowedOrigins(body.allowedOrigins),
    input_email_enabled: emailEnabled,
    input_sms_enabled: smsEnabled,
    input_email_version: emailEnabled ? requiredText(body.emailVersion, "Email consent version", 3, 120) : "disabled",
    input_email_disclosure: emailEnabled ? requiredText(body.emailDisclosure, "Email disclosure", 20, 2000) : "disabled",
    input_email_checkbox_label: emailEnabled ? requiredText(body.emailCheckboxLabel, "Email checkbox label", 2, 120) : "disabled",
    input_sms_version: smsEnabled ? requiredText(body.smsVersion, "Text consent version", 3, 120) : "disabled",
    input_sms_disclosure: smsEnabled ? requiredText(body.smsDisclosure, "Text disclosure", 40, 3000) : "disabled",
    input_sms_checkbox_label: smsEnabled ? requiredText(body.smsCheckboxLabel, "Text checkbox label", 2, 120) : "disabled",
  };
}

function topicArguments(body, actorUserId, idempotencyKey) {
  const slug = requiredText(body.slug, "Topic slug", 2, 80).toLowerCase();
  if (!SLUG_PATTERN.test(slug)) badRequest("Topic slug may contain lowercase letters, numbers, and single hyphens.");
  return {
    input_actor_user_id: actorUserId,
    input_idempotency_key: idempotencyKey,
    input_workspace_id: requiredUuid(body.workspaceId, "Workspace"),
    input_topic_id: optionalUuid(body.topicId, "Topic"),
    input_slug: slug,
    input_name: requiredText(body.name, "Topic name", 2, 120),
    input_description: clean(body.description, 500) || null,
    input_active: boolean(body.active, "Topic status"),
    input_sort_order: integer(body.sortOrder, "Topic order", 10000),
  };
}

function pricingArguments(body, actorUserId, idempotencyKey) {
  return {
    input_actor_user_id: actorUserId,
    input_idempotency_key: idempotencyKey,
    input_workspace_id: requiredUuid(body.workspaceId, "Workspace"),
    input_included_sms_segments: integer(body.includedSmsSegments, "Included SMS segments"),
    input_sms_overage_cents: integer(body.smsOverageCents, "SMS overage", 100000),
    input_mms_unit_cents: integer(body.mmsUnitCents, "MMS unit price", 100000),
    input_entitlement_status: choice(body.entitlementStatus, "Entitlement status", ["trialing", "active", "paused", "canceled"]),
    input_portal_enabled: boolean(body.portalEnabled, "Portal access"),
  };
}

const operations = {
  provision_workspace: {
    rpc: "communications_admin_provision_workspace",
    arguments: workspaceArguments,
  },
  save_form: {
    rpc: "communications_admin_save_form",
    arguments: formArguments,
  },
  save_topic: {
    rpc: "communications_admin_save_topic",
    arguments: topicArguments,
  },
  update_pricing: {
    rpc: "communications_admin_update_pricing",
    arguments: pricingArguments,
  },
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const { user } = await requirePlatformAdmin(req);
    let parsedBody = req.body;
    if (typeof parsedBody === "string") {
      try {
        parsedBody = JSON.parse(parsedBody);
      } catch {
        badRequest("Request body must be valid JSON.");
      }
    }
    const body = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody) ? parsedBody : {};
    const operationName = clean(body.operation, 50).toLowerCase();
    const operation = operations[operationName];
    if (!operation) badRequest("Unknown Communications Admin operation.");
    const idempotencyKey = requiredUuid(body.idempotencyKey, "Idempotency key");
    const args = operation.arguments(body, user.id, idempotencyKey);
    const result = await supabaseJson(`rpc/${operation.rpc}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return sendJson(res, 200, result);
  } catch (error) {
    const status = Number(error?.status || 500);
    if (status >= 500) console.error("Communications Admin mutation failed:", error);
    return sendJson(res, status >= 400 && status < 600 ? status : 500, {
      error: status >= 500 ? "Communications Admin could not complete that operation." : error.message,
    });
  }
};

module.exports.operations = operations;
