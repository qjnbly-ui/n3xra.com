const DEFAULT_FROM = "N3XRA Website Updates <noreply@n3xra.com>";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function validHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

function buildWebsiteChangeEmail({ stage, requesterName, websiteName, requestSubject, actionUrl }) {
  const previewReady = stage === "preview_ready";
  const firstName = String(requesterName || "").trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const site = String(websiteName || "your website").trim();
  const change = String(requestSubject || "Website update").trim();
  const subject = previewReady ? `Your ${site} preview is ready` : `Your ${site} update is live`;
  const heading = previewReady ? "Your private preview is ready" : "Your website update is live";
  const message = previewReady
    ? "N3XRA finished preparing the requested website change. You can review the private preview now. Nothing has been published to the live website yet."
    : "N3XRA reviewed and approved the requested change. It has now been published to the website's main branch.";
  const button = previewReady ? "Review private preview" : "Open live website";
  const safeUrl = validHttpsUrl(actionUrl);
  const text = [
    greeting,
    "",
    message,
    "",
    `Request: ${change}`,
    safeUrl ? `${button}: ${safeUrl}` : "",
    "",
    "You can also see the request status in your N3XRA client portal.",
  ].filter(Boolean).join("\n");
  const html = `<div style="margin:0;padding:32px 16px;background:#edf3f5;font-family:Arial,sans-serif;color:#101820;line-height:1.6"><div style="max-width:640px;margin:0 auto"><div style="padding:28px 32px;background:#07111b;color:#fff;border-radius:22px 22px 0 0"><p style="margin:0 0 9px;color:#69c7bd;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase">N3XRA Website Management</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;line-height:1.2">${escapeHtml(heading)}</h1></div><div style="padding:30px 32px;background:#fff;border:1px solid #dce4e8;border-top:0;border-radius:0 0 22px 22px"><p style="margin:0 0 16px;font-size:16px">${escapeHtml(greeting)}</p><p style="margin:0 0 20px;font-size:16px">${escapeHtml(message)}</p><div style="margin:0 0 22px;padding:16px 18px;background:#f4f8f8;border-left:4px solid #278b80"><p style="margin:0;color:#66727c;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Requested change</p><p style="margin:5px 0 0;font-weight:700">${escapeHtml(change)}</p></div>${safeUrl ? `<a href="${escapeHtml(safeUrl)}" style="display:inline-block;padding:13px 21px;background:#07111b;color:#fff;text-decoration:none;font-weight:800;border-radius:8px">${escapeHtml(button)}</a>` : ""}<p style="margin:24px 0 0;color:#68757e;font-size:13px">You can also see the request status in your N3XRA client portal.</p></div></div></div>`;
  return { subject, text, html };
}

async function sendWebsiteChangeClientEmail(input, dependencies = {}) {
  const apiKey = String(dependencies.apiKey || process.env.RESEND_API_KEY || "").trim();
  const recipient = validEmail(input.requesterEmail);
  if (!apiKey) throw new Error("RESEND_API_KEY is missing.");
  if (!recipient) throw new Error("The support request does not have a valid client email address.");
  if (!["preview_ready", "published"].includes(input.stage)) throw new Error("Choose a valid website email stage.");
  const content = buildWebsiteChangeEmail(input);
  const response = await (dependencies.fetch || fetch)("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `website-change/${input.runId}/${input.stage}`,
    },
    body: JSON.stringify({
      from: process.env.WEBSITE_CHANGE_EMAIL_FROM || DEFAULT_FROM,
      to: [recipient],
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(payload?.message || payload?.error || `Resend returned ${response.status}.`).slice(0, 2000));
  return { id: payload?.id || null };
}

module.exports = { buildWebsiteChangeEmail, sendWebsiteChangeClientEmail };
