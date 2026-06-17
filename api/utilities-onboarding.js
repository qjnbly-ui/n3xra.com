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
    "New N3XRA Utilities onboarding request",
    "",
    `District/Provider: ${payload.district}`,
    `Primary contact: ${payload.contact}`,
    `Email: ${payload.email}`,
    `Phone: ${payload.phone || "-"}`,
    `Customer accounts: ${payload.accounts || "-"}`,
    `Current billing tools: ${payload.billingTools || "-"}`,
    "",
    "Most manual work:",
    payload.manualWork || "-",
  ].join("\n");
}

function detailCard(label, value) {
  return `
    <tr>
      <td style="padding:0 0 14px;">
        <div style="padding:16px 18px;border:1px solid #e5e7eb;border-radius:18px;background:#ffffff;">
          <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:700;color:#176f66;">${escapeHtml(label)}</p>
          <p style="margin:0;font-size:16px;font-weight:700;color:#0f1620;white-space:pre-wrap;">${escapeHtml(value || "-")}</p>
        </div>
      </td>
    </tr>
  `;
}

function buildHtmlEmail(payload) {
  return `
    <div style="margin:0;padding:32px 16px;background:#edf2f8;font-family:Arial,sans-serif;color:#0f1620;line-height:1.6;">
      <div style="max-width:680px;margin:0 auto;">
        <div style="background:linear-gradient(135deg,#07120f 0%,#0d221d 58%,#06100d 100%);border-radius:24px 24px 0 0;padding:28px 32px;color:#ffffff;">
          <p style="margin:0 0 10px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;font-weight:700;color:#9ff2d2;">N3XRA Utilities</p>
          <h1 style="margin:0;font-size:28px;line-height:1.15;font-weight:700;">New onboarding request</h1>
          <p style="margin:12px 0 0;font-size:15px;color:rgba(255,255,255,0.78);">
            A utility provider submitted the onboarding form.
          </p>
        </div>

        <div style="background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-top:0;border-radius:0 0 24px 24px;padding:28px 32px;box-shadow:0 24px 60px rgba(12,18,28,0.12);">
          <div style="margin:0 0 20px;padding:16px 18px;border-radius:18px;background:linear-gradient(180deg,#f8fbfa 0%,#f4f7fb 100%);border:1px solid #dce6f0;">
            <p style="margin:0;font-size:14px;color:#5d6979;">
              Replying to this email will go to the onboarding contact.
            </p>
          </div>

          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
            ${detailCard("District / Provider", payload.district)}
            ${detailCard("Primary contact", payload.contact)}
            ${detailCard("Email", payload.email)}
            ${detailCard("Phone", payload.phone)}
            ${detailCard("Customer accounts", payload.accounts)}
            ${detailCard("Current billing tools", payload.billingTools)}
            ${detailCard("Most manual work", payload.manualWork)}
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

  const notifyTo = String(process.env.UTILITIES_ONBOARDING_NOTIFY_TO || "quentin@n3xra.com")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const payload = {
    district: String(body.district || "").trim(),
    contact: String(body.contact || "").trim(),
    email: String(body.email || "").trim().toLowerCase(),
    phone: String(body.phone || "").trim(),
    billingTools: String(body.billing_tools || body.billingTools || "").trim(),
    accounts: String(body.accounts || "").trim(),
    manualWork: String(body.manual_work || body.manualWork || "").trim(),
    company: String(body.company || "").trim(),
  };

  if (payload.company) {
    return res.status(200).json({ ok: true });
  }

  if (!payload.district || !payload.contact || !payload.email) {
    return res.status(400).json({ error: "District, contact, and email are required." });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(payload.email) || notifyTo.some((email) => !emailPattern.test(email))) {
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
        from: "N3XRA Utilities <noreply@n3xra.com>",
        to: notifyTo,
        subject: `[N3XRA Utilities] Onboarding request: ${payload.district}`,
        html: buildHtmlEmail(payload),
        text: buildTextEmail(payload),
        reply_to: payload.email,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: String(data?.message || data?.error || "Unable to send onboarding request."),
      });
    }

    return res.status(200).json({ ok: true, id: data?.id || null });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to send onboarding request.",
    });
  }
}
