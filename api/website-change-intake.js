const { IdentityResolver, getAuthorizationToken } = require("./_ai-core/auth");
const { analyzeWebsiteChange } = require("./_ai-core/websiteChangeIntake");
const { safeErrorMessage } = require("./_ai-core/security");
const { serviceRequest } = require("./_website-proposal-ai-supabase");

const MAX_BODY_BYTES = 12 * 1024;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 12;
const rateMap = new Map();
const allowedKinds = new Set(["business_hours", "contact_information", "content", "asset", "design", "functionality", "code", "other"]);
const allowedScopes = new Set(["content", "code", "unknown"]);

function clean(value, limit) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") return JSON.parse(req.body || "{}");
  return {};
}

function limited(userId) {
  const now = Date.now();
  const current = rateMap.get(userId);
  if (!current || now - current.startedAt > RATE_WINDOW_MS) {
    rateMap.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX;
}

function safeAnalysis(value) {
  const analysis = value && typeof value === "object" ? value : {};
  const changeKind = allowedKinds.has(analysis.changeKind) ? analysis.changeKind : "other";
  const changeScope = allowedScopes.has(analysis.changeScope) ? analysis.changeScope : "unknown";
  const title = clean(analysis.title, 100) || "Website change request";
  const summary = clean(analysis.summary, 500);
  return { title, summary, changeKind, changeScope };
}

async function accessibleWebsite(userId, websiteId) {
  const memberships = await serviceRequest(`website_members?select=website_id&website_id=eq.${encodeURIComponent(websiteId)}&user_id=eq.${encodeURIComponent(userId)}&status=eq.active&limit=1`);
  if (!Array.isArray(memberships) || !memberships.length) return null;
  const websites = await serviceRequest(`client_websites?select=id,name,organization_id,status,live_preview_enabled&id=eq.${encodeURIComponent(websiteId)}&limit=1`);
  return Array.isArray(websites) && websites[0] && websites[0].status !== "archived" ? websites[0] : null;
}

async function startFastPreview(requestId, authorizationToken, env, fetcher) {
  const supabaseUrl = String(env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
  const anonKey = String(env.SUPABASE_ANON_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  if (!authorizationToken || !anonKey) throw new Error("Fast Preview is not configured for this deployment.");
  const response = await fetcher(`${supabaseUrl}/functions/v1/website-change-automation`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authorizationToken}`, apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ action: "start-preview", requestId, previewMode: "n3xra_live" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(clean(payload?.error || `Fast Preview could not start (${response.status}).`, 500));
  return payload;
}

function createWebsiteChangeIntakeHandler(options = {}) {
  const env = options.env || process.env;
  const fetcher = options.fetcher || fetch;
  const analyze = options.analyze || ((request) => analyzeWebsiteChange(request, { env, fetcher }));
  const identityResolver = options.identityResolver || new IdentityResolver(env, { fetcher });
  const findWebsite = options.accessibleWebsite || accessibleWebsite;
  const beginFastPreview = options.startFastPreview || ((requestId, token) => startFastPreview(requestId, token, env, fetcher));
  const insertRequest = options.insertRequest || ((record) => serviceRequest("platform_support_requests", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(record),
  }));

  return async function handler(req, res) {
    res.setHeader("Cache-Control", "private, no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "Method not allowed." });
    }
    try {
      const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
      if (Buffer.byteLength(rawBody, "utf8") > MAX_BODY_BYTES) return res.status(413).json({ error: "Request body is too large." });
      const authorizationToken = getAuthorizationToken(req.headers || {});
      const identity = await identityResolver.resolve(authorizationToken);
      if (!identity.user) return res.status(401).json({ error: "Authentication required." });
      if (limited(identity.user.id)) return res.status(429).json({ error: "Too many requests. Please wait a minute and try again." });
      const body = parseBody(req);
      const action = clean(body.action, 20);
      const websiteId = clean(body.websiteId, 80);
      const request = clean(body.request, 4000);
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(websiteId)) return res.status(400).json({ error: "Choose a valid website." });
      if (request.length < 5) return res.status(400).json({ error: "Please describe the website change you need." });
      const website = await findWebsite(identity.user.id, websiteId);
      if (!website) return res.status(403).json({ error: "This website is not available to your account." });
      if (action === "analyze") {
        return res.status(200).json({ ok: true, analysis: await analyze(request) });
      }
      if (action !== "submit") return res.status(400).json({ error: "Choose whether to review or submit the request." });
      const analysis = safeAnalysis(body.analysis);
      if (!analysis.summary) return res.status(400).json({ error: "Review the request before sending it." });
      const inserted = await insertRequest({
        requester_user_id: identity.user.id,
        requester_name: identity.user.displayName,
        requester_email: identity.user.email,
        organization_name: website.name,
        organization_id: website.organization_id,
        website_id: website.id,
        topic: "website-change",
        subject: analysis.title,
        message: request,
        source: "client_portal",
        origin: "client",
        client_visible: true,
        intake_mode: "ai_assisted",
        change_kind: analysis.changeKind,
        change_scope: analysis.changeScope,
        automation_status: "awaiting_review",
        assistant_summary: analysis.summary,
      });
      const createdRequest = Array.isArray(inserted) ? inserted[0] : inserted;
      let preview = { eligible: Boolean(website.live_preview_enabled), started: false };
      if (website.live_preview_enabled && createdRequest?.id) {
        try {
          const result = await beginFastPreview(createdRequest.id, authorizationToken);
          preview = { eligible: true, started: true, run: result?.run || null };
        } catch (error) {
          console.error("Fast Preview could not start after website request intake.", error);
          preview = { eligible: true, started: false, error: safeErrorMessage(error, "Fast Preview could not start automatically.") };
        }
      }
      return res.status(201).json({ ok: true, request: createdRequest, preview });
    } catch (error) {
      return res.status(Number(error?.status || 500)).json({ error: safeErrorMessage(error, "The website request could not be prepared.") });
    }
  };
}

const handler = createWebsiteChangeIntakeHandler();
module.exports = handler;
module.exports.createWebsiteChangeIntakeHandler = createWebsiteChangeIntakeHandler;
