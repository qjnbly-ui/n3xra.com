import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function escapeHtml(input: unknown) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function textValue(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeRecipientEmails(payload: Record<string, unknown>) {
  const raw = Array.isArray(payload.recipientEmails)
    ? payload.recipientEmails
    : [payload.recipientEmail];
  return Array.from(new Set(
    raw
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

function buildTextEmail(options: {
  senderName: string;
  organizationName: string;
  message: string;
}) {
  return [
    `${options.senderName} sent this message from ${options.organizationName}.`,
    "",
    options.message,
    "",
    "Powered by N3XRA Records.",
  ].join("\n");
}

function buildHtmlEmail(options: {
  senderName: string;
  organizationName: string;
  message: string;
}) {
  const safeSender = escapeHtml(options.senderName);
  const safeOrg = escapeHtml(options.organizationName);
  const safeMessage = escapeHtml(options.message).replace(/\n/g, "<br>");

  return `
    <div style="margin:0;padding:28px;background:#f5f7fb;font-family:Manrope,Trebuchet MS,sans-serif;color:#121924;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-radius:18px;overflow:hidden;">
        <div style="padding:24px 28px;background:#0f141b;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;opacity:0.82;">N3XRA Records Message</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;">Message from ${safeOrg}</h1>
        </div>
        <div style="padding:28px;">
          <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#5b6678;">${safeSender} sent this from <strong>${safeOrg}</strong>.</p>
          <div style="margin:0;font-size:16px;line-height:1.65;color:#2f3d4d;">${safeMessage}</div>
          <p style="margin:22px 0 0;padding-top:18px;border-top:1px solid rgba(15,22,32,0.08);font-size:12px;letter-spacing:0.14em;text-transform:uppercase;color:#6b7482;font-weight:700;">Powered by N3XRA Records</p>
        </div>
      </div>
    </div>
  `;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("APP_MESSAGE_FROM_EMAIL") || "N3XRA Records <updates@n3xra.com>";

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment variables are missing." }, 500);
    }
    if (!resendApiKey) {
      return jsonResponse({ error: "RESEND_API_KEY is missing." }, 500);
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing Authorization header." }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: {
        headers: {
          Authorization: authHeader,
        },
      },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: userError?.message || "Unable to resolve user." }, 401);
    }

    const payload = await request.json().catch(() => ({}));
    const organizationId = String(payload.organizationId || "").trim();
    const recipientEmails = normalizeRecipientEmails(payload);
    const subject = textValue(payload.subject).slice(0, 180);
    const message = String(payload.message || "").trim().slice(0, 5000);

    if (!organizationId || !recipientEmails.length || !subject || !message) {
      return jsonResponse({ error: "organizationId, recipientEmails, subject, and message are required." }, 400);
    }
    const invalidEmail = recipientEmails.find((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
    if (invalidEmail) {
      return jsonResponse({ error: `Recipient email is invalid: ${invalidEmail}` }, 400);
    }

    const [{ data: organization, error: organizationError }, { data: membership, error: membershipError }, { data: profile }] = await Promise.all([
      adminClient
        .from("organizations")
        .select("id, name, owner_user_id")
        .eq("id", organizationId)
        .maybeSingle(),
      adminClient
        .from("organization_memberships")
        .select("role")
        .eq("organization_id", organizationId)
        .eq("user_id", user.id)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (organizationError || !organization) {
      return jsonResponse({ error: organizationError?.message || "Library not found." }, 404);
    }
    if (membershipError) {
      return jsonResponse({ error: membershipError.message }, 400);
    }

    const isPlatformAdmin = String(user.email || "").toLowerCase() === "quentin@quentinnichols.com";
    const isOwner = organization.owner_user_id === user.id;
    if (!membership && !isOwner && !isPlatformAdmin) {
      return jsonResponse({ error: "You do not have access to send messages from this library." }, 403);
    }

    const senderName = textValue(profile?.full_name) || textValue(user.email) || "N3XRA Records";
    const organizationName = textValue(organization.name) || "N3XRA Records";
    const html = buildHtmlEmail({ senderName, organizationName, message });
    const text = buildTextEmail({ senderName, organizationName, message });

    const sent: Array<{ email: string; id: string | null }> = [];
    const failed: Array<{ email: string; error: string }> = [];

    for (const email of recipientEmails) {
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [email],
          subject,
          html,
          text,
          reply_to: user.email,
        }),
      });

      const emailResult = await emailResponse.json().catch(() => ({}));
      if (emailResponse.ok) {
        sent.push({ email, id: typeof emailResult?.id === "string" ? emailResult.id : null });
      } else {
        failed.push({ email, error: String(emailResult?.message || emailResult?.error || "Message email failed to send.") });
      }
    }

    return jsonResponse({
      ok: failed.length === 0,
      sent,
      failed,
      sentCount: sent.length,
      failedCount: failed.length,
    }, sent.length ? 200 : 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected message send error.";
    return jsonResponse({ error: message }, 500);
  }
});
