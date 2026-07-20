const NEW_ACCOUNT_NOTIFY_TO = "quentin@n3xra.com";
const { createAdminNotification } = require("./_admin-notifications");

function getSignupSummary(signupMode) {
  const mode = String(signupMode || "").trim().toLowerCase();
  if (mode === "ai_music") {
    return {
      product: "AI Music Generator",
      flow: "AI Music Signup",
    };
  }

  if (mode === "invite") {
    return {
      product: "N3XRA Records",
      flow: "Join by Invite",
    };
  }

  if (mode === "personal") {
    return {
      product: "N3XRA Records",
      flow: "Personal Account",
    };
  }

  return {
    product: "N3XRA Records",
    flow: "Create Organization",
  };
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildTextEmail(payload) {
  const summary = getSignupSummary(payload.signupMode);
  const lines = [
    `New signup: ${summary.product}`,
    "",
    `Product: ${summary.product}`,
    `Flow: ${summary.flow}`,
    `Name: ${payload.fullName || "-"}`,
    `Email: ${payload.email}`,
    `Created at: ${payload.createdAt}`,
  ];

  if (summary.product === "N3XRA Records") {
    lines.push(`Organization: ${payload.organizationName || "-"}`);
    lines.push(`Invite code: ${payload.inviteCode || "-"}`);
  }

  lines.push(`Raw signup mode: ${payload.signupMode}`);
  return lines.join("\n");
}

function detailCard(label, value) {
  return `
    <div style="padding:14px 16px;border:1px solid #d6dde8;border-radius:14px;background:#ffffff;">
      <p style="margin:0 0 5px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700;color:#415267;">${escapeHtml(label)}</p>
      <p style="margin:0;font-size:16px;font-weight:700;color:#0e1622;">${escapeHtml(value || "-")}</p>
    </div>
  `;
}

function buildHtmlEmail(payload) {
  const summary = getSignupSummary(payload.signupMode);
  const recordsOnly = summary.product === "N3XRA Records";

  return [
    `<div style="margin:0;padding:28px 14px;background:#f3f6fb;font-family:Manrope,Arial,sans-serif;color:#0f1620;line-height:1.5;">
      <div style="max-width:640px;margin:0 auto;">
        <div style="background:#0f1a28;border-radius:20px 20px 0 0;padding:24px 26px;color:#ffffff;">
          <p style="margin:0 0 8px;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;color:#9ed8c9;">N3XRA New Signup</p>
          <h1 style="margin:0;font-size:30px;line-height:1.1;font-weight:700;color:#ffffff;">${escapeHtml(summary.product)}</h1>
          <p style="margin:10px 0 0;font-size:15px;color:#d8e3f1;">
            New account created from <strong style="color:#ffffff;">${escapeHtml(summary.flow)}</strong>.
          </p>
        </div>

        <div style="background:#ffffff;border:1px solid #d6dde8;border-top:0;border-radius:0 0 20px 20px;padding:22px 24px;box-shadow:0 16px 40px rgba(10,18,28,0.12);">
          <div style="display:grid;gap:10px;">
            ${detailCard("Product", summary.product)}
            ${detailCard("Flow", summary.flow)}
            ${detailCard("Name", payload.fullName || "-")}
            ${detailCard("Email", payload.email)}
            ${detailCard("Created At", payload.createdAt)}
            ${recordsOnly ? detailCard("Organization", payload.organizationName || "-") : ""}
            ${recordsOnly ? detailCard("Invite Code", payload.inviteCode || "-") : ""}
            ${detailCard("Raw Signup Mode", payload.signupMode)}
          </div>
          <p style="margin:16px 0 0;font-size:13px;color:#4c5f76;">Replying to this email will send to ${escapeHtml(payload.email)}.</p>
        </div>
      </div>
    </div>`,
  ].join("\n");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return res.status(500).json({ error: "Missing RESEND_API_KEY." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const payload = {
    fullName: String(body.fullName || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    signupMode: String(body.signupMode || "").trim(),
    organizationName: String(body.organizationName || "").trim(),
    inviteCode: String(body.inviteCode || "").trim(),
    createdAt: String(body.createdAt || new Date().toISOString()).trim(),
  };

  if (!payload.email || !payload.signupMode) {
    return res.status(400).json({ error: "Missing required account fields." });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(payload.email) || !emailPattern.test(NEW_ACCOUNT_NOTIFY_TO)) {
    return res.status(400).json({ error: "Invalid email configuration." });
  }

  const summary = getSignupSummary(payload.signupMode);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "n3xra.com <noreply@n3xra.com>",
        to: [NEW_ACCOUNT_NOTIFY_TO],
        subject: `[New Signup • ${summary.product}] ${payload.email}`,
        html: buildHtmlEmail(payload),
        text: buildTextEmail(payload),
        reply_to: payload.email,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      await createAdminNotification({
        eventType: "system.email_delivery_failed",
        product: "accounts",
        priority: "important",
        title: "New-account notification email failed",
        summary: `${payload.email} · ${String(data?.message || data?.error || "Unknown delivery error")}`,
        messageText: buildTextEmail(payload),
        actorName: payload.fullName,
        actorEmail: payload.email,
        actionUrl: "/account/admin/accounts/",
        metadata: { provider: "resend", error: data },
      }).catch(() => null);
      return res.status(response.status).json({
        error: String(data?.message || data?.error || "Unable to send account notification."),
      });
    }

    await createAdminNotification({
      eventType: "account.created",
      product: "accounts",
      priority: "important",
      title: `New ${summary.product} account`,
      summary: `${payload.fullName || payload.email} · ${summary.flow}`,
      messageText: buildTextEmail(payload),
      messageHtml: buildHtmlEmail(payload),
      actorName: payload.fullName,
      actorEmail: payload.email,
      actionUrl: "/account/admin/accounts/",
      metadata: { signup_mode: payload.signupMode, email_message_id: data?.id || null },
    }).catch((error) => console.error("Account notification persistence failed:", error));

    return res.status(200).json({ ok: true, id: data?.id || null });
  } catch (error) {
    await createAdminNotification({
      eventType: "system.email_delivery_failed",
      product: "accounts",
      priority: "important",
      title: "New-account notification failed",
      summary: error instanceof Error ? error.message : "Unable to send account notification.",
      messageText: buildTextEmail(payload),
      actorName: payload.fullName,
      actorEmail: payload.email,
      actionUrl: "/account/admin/accounts/",
    }).catch(() => null);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to send account notification.",
    });
  }
}
