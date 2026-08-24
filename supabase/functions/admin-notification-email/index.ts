import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { buildAdminNotificationEmail, type AdminNotification } from "./email-format.ts";

const json = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

function safeEqual(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) difference |= leftBytes[index] ^ rightBytes[index];
  return difference === 0;
}

function emailList(value: string) {
  return [...new Set(value.split(",").map((email) => email.trim().toLowerCase()).filter((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))].slice(0, 10);
}

async function wait(milliseconds: number) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  const expectedToken = String(Deno.env.get("ADMIN_NOTIFICATION_WEBHOOK_TOKEN") || "").trim();
  const suppliedToken = String(request.headers.get("x-n3xra-webhook-token") || "").trim();
  if (!expectedToken || !safeEqual(suppliedToken, expectedToken)) return json({ error: "Unauthorized." }, 401);

  const body = await request.json().catch(() => ({}));
  const notificationId = String(body?.notification_id || body?.record?.id || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(notificationId)) {
    return json({ error: "A valid notification is required." }, 400);
  }

  const supabaseUrl = String(Deno.env.get("SUPABASE_URL") || "").trim();
  const serviceKey = String(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "").trim();
  const resendApiKey = String(Deno.env.get("RESEND_API_KEY") || "").trim();
  const recipients = emailList(Deno.env.get("ADMIN_NOTIFICATION_EMAIL_TO") || "quentin@n3xra.com");
  if (!supabaseUrl || !serviceKey || !resendApiKey || !recipients.length) return json({ error: "Notification email delivery is not configured." }, 503);

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const claim = await admin.rpc("claim_admin_notification_email", { input_notification_id: notificationId });
  if (claim.error) return json({ error: "Notification email could not be claimed." }, 500);
  const notification = (Array.isArray(claim.data) ? claim.data[0] : claim.data) as AdminNotification | null;
  if (!notification) return json({ ok: true, duplicate: true });

  const content = buildAdminNotificationEmail(notification, Deno.env.get("APP_ORIGIN") || "https://www.n3xra.com");
  const from = Deno.env.get("ADMIN_NOTIFICATION_EMAIL_FROM") || "N3XRA Notifications <noreply@n3xra.com>";
  let providerId = "";
  let deliveryError = "Email delivery failed.";

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": `admin-notification/${notification.id}`,
      },
      body: JSON.stringify({ from, to: recipients, subject: content.subject, html: content.html, text: content.text }),
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok) {
      providerId = typeof payload?.id === "string" ? payload.id : "accepted";
      break;
    }
    deliveryError = String(payload?.message || payload?.error || `Resend returned ${response.status}.`).slice(0, 2000);
    if (response.status < 500 && response.status !== 429) break;
    if (attempt < 2) await wait(250 * (2 ** attempt));
  }

  if (providerId) {
    await admin.from("admin_notifications").update({
      email_delivery_status: "sent",
      email_sent_at: new Date().toISOString(),
      email_provider_id: providerId,
      email_delivery_error: null,
    }).eq("id", notification.id).eq("email_delivery_status", "sending");
    return json({ ok: true });
  }

  await admin.from("admin_notifications").update({
    email_delivery_status: "failed",
    email_delivery_error: deliveryError,
  }).eq("id", notification.id).eq("email_delivery_status", "sending");
  return json({ error: "Notification email delivery failed." }, 502);
});
