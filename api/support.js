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
    "New support request from n3xra.com",
    "",
    `Name: ${payload.name}`,
    `Email: ${payload.email}`,
    `Organization: ${payload.organization || "-"}`,
    `Topic: ${payload.topic}`,
    `Subject: ${payload.subject}`,
    "",
    "Message:",
    payload.message,
  ].join("\n");
}

function buildHtmlEmail(payload) {
  return `
    <div style="font-family: Arial, sans-serif; color: #111827; line-height: 1.6;">
      <h2 style="margin: 0 0 16px;">New support request</h2>
      <p style="margin: 0 0 8px;"><strong>Name:</strong> ${escapeHtml(payload.name)}</p>
      <p style="margin: 0 0 8px;"><strong>Email:</strong> ${escapeHtml(payload.email)}</p>
      <p style="margin: 0 0 8px;"><strong>Organization:</strong> ${escapeHtml(payload.organization || "-")}</p>
      <p style="margin: 0 0 8px;"><strong>Topic:</strong> ${escapeHtml(payload.topic)}</p>
      <p style="margin: 0 0 16px;"><strong>Subject:</strong> ${escapeHtml(payload.subject)}</p>
      <div style="padding: 16px; border: 1px solid #e5e7eb; border-radius: 12px; background: #f9fafb;">
        <p style="margin: 0; white-space: pre-wrap;">${escapeHtml(payload.message)}</p>
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
    name: String(body.name || "").trim(),
    email: String(body.email || "").trim(),
    organization: String(body.organization || "").trim(),
    topic: String(body.topic || "").trim(),
    subject: String(body.subject || "").trim(),
    message: String(body.message || "").trim(),
    company: String(body.company || "").trim(),
  };

  if (payload.company) {
    return res.status(200).json({ ok: true });
  }

  if (!payload.name || !payload.email || !payload.topic || !payload.subject || !payload.message) {
    return res.status(400).json({ error: "All required fields must be filled out." });
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(payload.email)) {
    return res.status(400).json({ error: "Enter a valid email address." });
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "n3xra.com Support <noreply@n3xra.com>",
        to: ["support@n3xra.com"],
        subject: `[Support] ${payload.subject}`,
        html: buildHtmlEmail(payload),
        text: buildTextEmail(payload),
        reply_to: payload.email,
      }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: String(data?.message || data?.error || "Unable to send support email."),
      });
    }

    return res.status(200).json({ ok: true, id: data?.id || null });
  } catch (error) {
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Unable to send support email.",
    });
  }
}
