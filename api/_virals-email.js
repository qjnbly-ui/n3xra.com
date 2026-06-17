const VIRALS_EMAIL_FROM = process.env.VIRALS_EMAIL_FROM || "N3XRA Virals <noreply@n3xra.com>";
const VIRALS_EMAIL_REPLY_TO = process.env.VIRALS_EMAIL_REPLY_TO || "support@n3xra.com";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getApplicationValue(application, camelKey, snakeKey = camelKey) {
  return application?.[camelKey] ?? application?.[snakeKey] ?? "";
}

function getProgramConfig(decision, program) {
  const normalized = decision === "reject" ? "rejected" : String(program || "standard").toLowerCase();
  if (normalized === "founding") {
    return {
      label: "Founding Creator Program",
      commissionLabel: "30%",
      subjectLabel: "Founding Creator Program approved",
      intro: "Your application for the N3XRA Virals Founding Creator Program has been approved.",
      details: [
        "You will earn 30% recurring commission for the lifetime of every account you refer.",
        "Your promo code gives customers 10% off their first 3 months.",
        "Founding Creator spots are approval-only and limited.",
      ],
    };
  }
  if (normalized === "standard") {
    return {
      label: "Standard Creator Program",
      commissionLabel: "20%",
      subjectLabel: "Creator Program approved",
      intro: "Your application for the N3XRA Virals Creator Program has been approved.",
      details: [
        "You will earn 20% recurring commission for the lifetime of every account you refer.",
        "Your promo code gives customers 10% off their first 3 months.",
        "Complete Stripe payout setup from your N3XRA Virals account settings before payouts can be sent.",
      ],
    };
  }
  return {
    label: "Creator Program",
    commissionLabel: "0%",
    subjectLabel: "Creator Program application update",
    intro: "Thank you for applying to promote N3XRA Virals. Your application was not approved at this time.",
    details: [
      "Your requested promo code has been released.",
      "You may apply again later if your creator positioning, audience, or TikTok content changes.",
      "Questions can be sent to support@n3xra.com.",
    ],
  };
}

function buildCreatorDecisionEmail(application, decision, program) {
  const email = getApplicationValue(application, "email");
  const handle = getApplicationValue(application, "tiktokUsername", "tiktok_username") || "creator";
  const code = getApplicationValue(application, "normalizedCode", "normalized_code") || getApplicationValue(application, "requestedCode", "requested_code");
  const displayName = getApplicationValue(application, "displayName", "display_name") || `@${handle}`;
  const isRejected = decision === "reject";
  const config = getProgramConfig(isRejected ? "reject" : "approve", program);
  const subject = isRejected
    ? "N3XRA Virals creator application update"
    : `N3XRA Virals ${config.subjectLabel}`;
  const ctaLabel = isRejected ? "Open N3XRA Virals" : "Open account settings";
  const ctaUrl = "https://n3xra.com/virals/";
  const referralUrl = code
    ? `https://n3xra.com/n3xra-virals/login/?mode=signup&promo=${encodeURIComponent(code)}&next=${encodeURIComponent("/virals/")}`
    : "";

  const text = [
    `Hi ${displayName},`,
    "",
    config.intro,
    "",
    `TikTok: @${handle}`,
    code ? `Promo code: ${code}` : "",
    referralUrl ? `Referral signup link: ${referralUrl}` : "",
    "",
    ...config.details.map((item) => `- ${item}`),
    "",
    isRejected
      ? "Thank you for your interest in N3XRA Virals."
      : "Use your account settings to complete Stripe payout onboarding and track referral performance.",
    "",
    "N3XRA Virals",
    "support@n3xra.com",
  ].filter(Boolean).join("\n");

  const html = `
    <div style="margin:0;padding:28px 14px;background:#eef4f8;font-family:Arial,sans-serif;color:#111827;line-height:1.6;color-scheme:light;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d7e2ea;border-radius:22px;overflow:hidden;">
        <div style="height:8px;background:#18c8ff;"></div>
        <div style="padding:28px 30px 18px;background:#ffffff;color:#111827;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;font-weight:800;color:#0e7490;">N3XRA Virals</p>
          <h1 style="margin:0;font-size:30px;line-height:1.14;color:#111827;">${escapeHtml(config.subjectLabel)}</h1>
          <p style="margin:14px 0 0;font-size:16px;color:#374151;">${escapeHtml(config.intro)}</p>
        </div>
        <div style="padding:0 30px 30px;background:#ffffff;color:#111827;">
          <p style="margin:0 0 18px;font-size:16px;color:#111827;">Hi <strong style="color:#111827;">${escapeHtml(displayName)}</strong>,</p>
          <div style="margin:0 0 20px;padding:16px 18px;border-radius:16px;background:#f8fafc;border:1px solid #dbe5ee;color:#111827;">
            <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:800;color:#0e7490;">TikTok</p>
            <p style="margin:0;font-size:18px;font-weight:800;color:#111827;">@${escapeHtml(handle)}</p>
            ${code ? `<p style="margin:10px 0 0;font-size:16px;color:#111827;"><strong style="color:#111827;">Promo code:</strong> ${escapeHtml(code)}</p>` : ""}
            ${referralUrl ? `<p style="margin:10px 0 0;font-size:15px;color:#111827;"><strong style="color:#111827;">Signup link:</strong> <a href="${referralUrl}" style="color:#0369a1;">${escapeHtml(referralUrl)}</a></p>` : ""}
          </div>
          <ul style="margin:0 0 22px;padding-left:22px;color:#1f2937;font-size:15px;">
            ${config.details.map((item) => `<li style="margin:0 0 8px;color:#1f2937;">${escapeHtml(item)}</li>`).join("")}
          </ul>
          <a href="${ctaUrl}" style="display:inline-block;padding:13px 18px;border-radius:14px;background:#18c8ff;color:#051016;font-weight:800;text-decoration:none;">${escapeHtml(ctaLabel)}</a>
          <p style="margin:24px 0 0;font-size:13px;color:#4b5563;">Questions? Reply to this email or contact <a href="mailto:support@n3xra.com" style="color:#0369a1;">support@n3xra.com</a>.</p>
        </div>
      </div>
    </div>
  `;

  return {
    to: email ? [email] : [],
    from: VIRALS_EMAIL_FROM,
    reply_to: VIRALS_EMAIL_REPLY_TO,
    subject,
    html,
    text,
  };
}

async function sendCreatorDecisionEmail(application, decision, program) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) throw new Error("Missing RESEND_API_KEY.");
  const email = buildCreatorDecisionEmail(application, decision, program);
  if (!email.to.length) throw new Error("Creator application has no recipient email.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(email),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || "Creator decision email failed to send."));
  }
  return { id: data?.id || null, to: email.to, subject: email.subject };
}

module.exports = {
  buildCreatorDecisionEmail,
  sendCreatorDecisionEmail,
};
