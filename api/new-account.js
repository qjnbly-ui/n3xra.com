const NEW_ACCOUNT_NOTIFY_TO = "quentin@n3xra.com";

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function buildTextEmail(payload) {
  return [
    "New n3xra.com account created",
    "",
    `Name: ${payload.fullName || "-"}`,
    `Email: ${payload.email}`,
    `Signup mode: ${payload.signupMode}`,
    `Organization: ${payload.organizationName || "-"}`,
    `Invite code: ${payload.inviteCode || "-"}`,
    `Created at: ${payload.createdAt}`,
  ].join("\n");
}

function buildHtmlEmail(payload) {
  return `
    <div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.6;">
      <div style="max-width:640px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#0b1219 0%,#101925 52%,#0c141c 100%);border-radius:24px 24px 0 0;padding:28px 32px;color:#ffffff;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#bfe6dd;">N3XRA Notification</p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:700;">New account created</h1>
          <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.78);">
            A new user finished the account creation flow on n3xra.com.
          </p>
        </div>

        <div style="background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-top:0;border-radius:0 0 24px 24px;padding:28px 32px;box-shadow:0 24px 60px rgba(12,18,28,0.12);">
          <div style="margin:0 0 20px;padding:16px 18px;border-radius:18px;background:linear-gradient(180deg,#f8fbfa 0%,#f4f7fb 100%);border:1px solid #dce6f0;">
            <p style="margin:0;font-size:14px;color:#5d6979;">
              Review the account details below. Replying to this email will go to the new user's address.
            </p>
          </div>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            <tr>
              <td style="padding:0 0 14px;">
                <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                  <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">Name</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;">${escapeHtml(payload.fullName || "-")}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 14px;">
                <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                  <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">Email</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;">${escapeHtml(payload.email)}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 14px;">
                <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                  <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">Signup Mode</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;">${escapeHtml(payload.signupMode)}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 14px;">
                <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                  <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">Organization</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;">${escapeHtml(payload.organizationName || "-")}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 14px;">
                <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                  <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">Invite Code</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;">${escapeHtml(payload.inviteCode || "-")}</p>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:0;">
                <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
                  <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">Created At</p>
                  <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;">${escapeHtml(payload.createdAt)}</p>
                </div>
              </td>
            </tr>
          </table>
        </div>
      </div>
    </div>
  `;
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
        subject: `[New Account] ${payload.email}`,
        html: buildHtmlEmail(payload),
        text: buildTextEmail(payload),
        reply_to: payload.email,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: String(data?.message || data?.error || "Unable to send account notification."),
      });
    }

    return res.status(200).json({ ok: true, id: data?.id || null });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to send account notification.",
    });
  }
}
