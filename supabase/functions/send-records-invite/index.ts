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

function escapeHtml(input: string) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    const fromEmail = Deno.env.get("RECORDS_INVITE_FROM_EMAIL") || "N3XRA Records <noreply@n3xra.com>";

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
    const inviteCode = String(payload.inviteCode || "").trim();
    const recipientEmail = String(payload.recipientEmail || "").trim().toLowerCase();
    const recipientName = String(payload.recipientName || "").trim();
    const customMessage = String(payload.customMessage || "").trim();
    const inviteLink = String(payload.inviteLink || "").trim();

    if (!organizationId || !inviteCode || !recipientEmail || !inviteLink) {
      return jsonResponse({ error: "organizationId, inviteCode, recipientEmail, and inviteLink are required." }, 400);
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      return jsonResponse({ error: "Recipient email is invalid." }, 400);
    }

    const [{ data: orgData, error: orgError }, { data: membershipData, error: membershipError }, { data: inviteData, error: inviteError }, { data: profileData }] = await Promise.all([
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
        .from("organization_invites")
        .select("id, code, role, max_uses, redeemed_uses, expires_at, is_disabled")
        .eq("organization_id", organizationId)
        .eq("code", inviteCode)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("full_name")
        .eq("id", user.id)
        .maybeSingle(),
    ]);

    if (orgError || !orgData) {
      return jsonResponse({ error: orgError?.message || "Library not found." }, 404);
    }

    const canManageInvites = orgData.owner_user_id === user.id
      || ["account_admin", "editor"].includes(String(membershipData?.role || ""));

    if (membershipError || !canManageInvites) {
      return jsonResponse({ error: "You do not have permission to send invite emails for this library." }, 403);
    }

    if (inviteError || !inviteData) {
      return jsonResponse({ error: inviteError?.message || "Invite code not found." }, 404);
    }

    if (inviteData.is_disabled) {
      return jsonResponse({ error: "This invite code is disabled." }, 400);
    }

    if (inviteData.expires_at && new Date(inviteData.expires_at).getTime() < Date.now()) {
      return jsonResponse({ error: "This invite code is expired." }, 400);
    }

    if ((inviteData.redeemed_uses || 0) >= (inviteData.max_uses || 0)) {
      return jsonResponse({ error: "This invite code has reached its usage limit." }, 400);
    }

    const inviterName = String(profileData?.full_name || user.email || "N3XRA Records").trim();
    const safeOrgName = escapeHtml(String(orgData.name || "this library"));
    const safeInviteCode = escapeHtml(inviteCode);
    const safeRecipientName = escapeHtml(recipientName);
    const safeInviterName = escapeHtml(inviterName);
    const safeCustomMessage = escapeHtml(customMessage);
    const safeInviteLink = escapeHtml(inviteLink);

    const recipientGreeting = safeRecipientName ? `Hi ${safeRecipientName},` : "Hi,";
    const customNoteBlock = safeCustomMessage
      ? `<p style=\"margin:0 0 14px;font-size:16px;line-height:1.6;color:#2f3d4d;\">${safeCustomMessage}</p>`
      : "";

    const html = `
      <div style="margin:0;padding:28px;background:#f5f7fb;font-family:Manrope, Trebuchet MS, sans-serif;color:#121924;">
        <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-radius:18px;overflow:hidden;">
          <div style="padding:26px 28px;background:linear-gradient(135deg, #0c1218 0%, #123a33 100%);color:#ffffff;">
            <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;opacity:0.82;">N3XRA Records Invite</div>
            <h1 style="margin:10px 0 0;font-size:30px;line-height:1.1;">You're invited to join ${safeOrgName}</h1>
          </div>
          <div style="padding:28px;">
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2f3d4d;">${recipientGreeting}</p>
            <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2f3d4d;">${safeInviterName} invited you to join <strong>${safeOrgName}</strong> on N3XRA Records.</p>
            ${customNoteBlock}
            <p style="margin:0 0 8px;font-size:14px;letter-spacing:0.08em;text-transform:uppercase;color:#176f66;font-weight:700;">Invite code</p>
            <p style="margin:0 0 18px;font-size:24px;line-height:1.2;color:#101924;font-weight:700;">${safeInviteCode}</p>
            <a href="${safeInviteLink}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#123a33;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">Join this library</a>
            <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5b6678;">This link opens signup in Join by invite mode and pre-fills your invite code.</p>
          </div>
        </div>
      </div>
    `;

    const subject = `${inviterName} invited you to ${orgData.name} on N3XRA Records`;

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [recipientEmail],
        subject,
        html,
      }),
    });

    const emailPayload = await emailResponse.json().catch(() => ({}));
    if (!emailResponse.ok) {
      const message = typeof emailPayload?.message === "string" ? emailPayload.message : "Invite email failed to send.";
      return jsonResponse({ error: message }, 400);
    }

    return jsonResponse({ ok: true, emailId: emailPayload?.id || null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected invite email error.";
    return jsonResponse({ error: message }, 500);
  }
});
