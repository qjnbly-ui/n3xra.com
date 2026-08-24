const { createHash, timingSafeEqual } = require("node:crypto");
const { serviceRequest } = require("./_website-proposal-ai-supabase");
const { sendWebsiteChangeClientEmail } = require("./_website-change-client-email");
const clean = (value, limit) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const digest = (value) => createHash("sha256").update(String(value || "")).digest("hex");
const sameHash = (left, right) => { try { return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex")); } catch { return false; } };
module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
  try {
    const body = req.body && typeof req.body === "object" ? req.body : JSON.parse(req.body || "{}");
    const runId = clean(body.runId, 80), token = clean(body.token, 200), headSha = clean(body.headSha, 40).toLowerCase(), previewUrl = clean(body.previewUrl, 500), errorMessage = clean(body.error, 2000);
    if (!/^[0-9a-f-]{36}$/i.test(runId) || !token) return res.status(400).json({ error: "Invalid callback." });
    const rows = await serviceRequest(`website_change_runs?select=id,request_id,website_id,state,callback_token_hash,callback_expires_at&id=eq.${encodeURIComponent(runId)}&limit=1`);
    const run = Array.isArray(rows) ? rows[0] : null;
    if (!run || !sameHash(digest(token), run.callback_token_hash) || Date.parse(run.callback_expires_at) < Date.now() || !["queued", "coding"].includes(run.state)) return res.status(403).json({ error: "This callback is not valid." });
    const succeeded = /^[0-9a-f]{40}$/.test(headSha) && /^https:\/\/[^/\s]+[.]vercel[.]app\/?$/.test(previewUrl) && !errorMessage;
    const now = new Date().toISOString(), state = succeeded ? "preview_ready" : "failed";
    await serviceRequest(`website_change_runs?id=eq.${encodeURIComponent(runId)}`, { method: "PATCH", body: JSON.stringify({ state, head_sha: succeeded ? headSha : null, preview_url: succeeded ? previewUrl : null, error_message: succeeded ? null : (errorMessage || "The preview workflow did not complete."), preview_ready_at: succeeded ? now : null, callback_token_hash: "0".repeat(64), updated_at: now }) });
    await serviceRequest(`platform_support_requests?id=eq.${encodeURIComponent(run.request_id)}`, { method: "PATCH", body: JSON.stringify({ automation_status: succeeded ? "preview_ready" : "failed", updated_at: now }) });
    if (succeeded) {
      try {
        const [requests, websites] = await Promise.all([
          serviceRequest(`platform_support_requests?select=requester_name,requester_email,subject&id=eq.${encodeURIComponent(run.request_id)}&limit=1`),
          serviceRequest(`client_websites?select=name,portal_slug,live_url&id=eq.${encodeURIComponent(run.website_id)}&limit=1`),
        ]);
        const support = Array.isArray(requests) ? requests[0] : null;
        const website = Array.isArray(websites) ? websites[0] : null;
        await sendWebsiteChangeClientEmail({ stage: "preview_ready", runId, requesterName: support?.requester_name, requesterEmail: support?.requester_email, websiteName: website?.name, requestSubject: support?.subject, actionUrl: previewUrl });
        await serviceRequest(`website_change_runs?id=eq.${encodeURIComponent(runId)}`, { method: "PATCH", body: JSON.stringify({ preview_email_sent_at: now, client_email_delivery_error: null, updated_at: now }) });
      } catch (emailError) {
        const deliveryError = clean(emailError instanceof Error ? emailError.message : "The preview-ready email could not be sent.", 2000);
        await serviceRequest(`website_change_runs?id=eq.${encodeURIComponent(runId)}`, { method: "PATCH", body: JSON.stringify({ client_email_delivery_error: deliveryError, updated_at: now }) }).catch(() => null);
        console.error("Preview-ready email failed:", deliveryError);
      }
    }
    return res.status(200).json({ ok: true, state });
  } catch { return res.status(500).json({ error: "Unable to record the preview result." }); }
};
