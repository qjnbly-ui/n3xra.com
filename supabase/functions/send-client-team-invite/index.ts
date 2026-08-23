import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const response = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

function escapeHtml(value: unknown) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const fromEmail = Deno.env.get("CLIENT_TEAM_INVITE_FROM_EMAIL") || "N3XRA <noreply@n3xra.com>";
    if (!supabaseUrl || !anonKey || !serviceRoleKey) return response({ error: "Supabase environment variables are missing." }, 500);
    if (!resendApiKey) return response({ error: "Email delivery is not configured." }, 503);

    const authorization = request.headers.get("Authorization");
    if (!authorization) return response({ error: "Sign in is required." }, 401);
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) return response({ error: "Sign in is required." }, 401);

    const payload = await request.json().catch(() => ({}));
    const inviteId = String(payload.inviteId || "").trim();
    const portalOrigin = String(payload.portalOrigin || "").trim();
    if (!inviteId || !portalOrigin) return response({ error: "Invitation details are missing." }, 400);

    const origin = new URL(portalOrigin);
    if (origin.protocol !== "https:" && origin.hostname !== "localhost") return response({ error: "Portal address is invalid." }, 400);

    const { data: invite, error: inviteError } = await adminClient
      .from("organization_invites")
      .select("id,organization_id,code,role,recipient_email,recipient_name,expires_at,is_disabled,redeemed_uses,max_uses,organization:organizations(name,owner_user_id)")
      .eq("id", inviteId)
      .maybeSingle();
    if (inviteError || !invite) return response({ error: "Invitation not found." }, 404);

    const organization = Array.isArray(invite.organization) ? invite.organization[0] : invite.organization;
    const [{ data: membership }, { data: platformAdmin }] = await Promise.all([
      adminClient.from("organization_memberships").select("role").eq("organization_id", invite.organization_id).eq("user_id", user.id).maybeSingle(),
      adminClient.from("platform_admins").select("role,status").eq("user_id", user.id).eq("status", "active").maybeSingle(),
    ]);
    const canManage = organization?.owner_user_id === user.id || membership?.role === "account_admin" || ["owner", "admin"].includes(String(platformAdmin?.role || ""));
    if (!canManage) return response({ error: "Only an account administrator can send invitations." }, 403);

    const hostname = origin.hostname.toLowerCase();
    let approvedPortalHost = hostname === "localhost" || hostname === "n3xra.com" || hostname === "www.n3xra.com";
    if (!approvedPortalHost && hostname.endsWith(".portal.n3xra.com")) {
      const portalSlug = hostname.slice(0, -".portal.n3xra.com".length);
      const { data: website } = await adminClient.from("client_websites").select("id").eq("organization_id", invite.organization_id).eq("portal_slug", portalSlug).maybeSingle();
      approvedPortalHost = Boolean(website?.id);
    }
    if (!approvedPortalHost) {
      const { data: domain } = await adminClient.from("website_domains").select("website:client_websites!inner(organization_id)").eq("domain_name", hostname).eq("domain_purpose", "portal").eq("status", "active").maybeSingle();
      const domainWebsite = Array.isArray(domain?.website) ? domain.website[0] : domain?.website;
      approvedPortalHost = domainWebsite?.organization_id === invite.organization_id;
    }
    if (!approvedPortalHost) return response({ error: "Portal address is not approved for this organization." }, 400);
    if (!invite.recipient_email || invite.is_disabled || Number(invite.redeemed_uses) >= Number(invite.max_uses) || (invite.expires_at && new Date(invite.expires_at).getTime() <= Date.now())) {
      return response({ error: "This invitation is no longer active." }, 400);
    }

    const { data: inviterProfile } = await adminClient.from("profiles").select("full_name").eq("id", user.id).maybeSingle();
    const organizationName = String(organization?.name || "your organization");
    const inviterName = String(inviterProfile?.full_name || user.email || "An account administrator");
    const roleLabel = invite.role === "account_admin" ? "Administrator" : invite.role === "editor" ? "Editor" : "View only";
    const joinUrl = new URL("/account/", origin);
    joinUrl.searchParams.set("signup", "invite");
    joinUrl.searchParams.set("invite", invite.code);
    joinUrl.searchParams.set("email", invite.recipient_email);
    joinUrl.searchParams.set("client_portal", "1");

    const emailResult = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromEmail,
        to: [invite.recipient_email],
        subject: `${inviterName} invited you to ${organizationName}`,
        html: `<div style="margin:0;padding:32px;background:#eef4f5;font-family:Manrope,Arial,sans-serif;color:#142019"><div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid #d7e1e3"><div style="padding:28px 32px;background:#13271d;color:#fff"><div style="font-size:12px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:#8ed1c7">N3XRA Client Portal</div><h1 style="margin:10px 0 0;font-family:Georgia,serif;font-size:32px">Join ${escapeHtml(organizationName)}</h1></div><div style="padding:32px"><p style="font-size:16px;line-height:1.6">${invite.recipient_name ? `Hi ${escapeHtml(invite.recipient_name)},` : "Hello,"}</p><p style="font-size:16px;line-height:1.6">${escapeHtml(inviterName)} invited you to the ${escapeHtml(organizationName)} client portal with <strong>${escapeHtml(roleLabel)}</strong> access.</p><a href="${escapeHtml(joinUrl.toString())}" style="display:inline-block;margin:10px 0 18px;padding:13px 22px;background:#13271d;color:#fff;text-decoration:none;font-weight:800">Accept invitation</a><p style="font-size:13px;line-height:1.5;color:#64716b">This secure invitation expires in seven days and only works for ${escapeHtml(invite.recipient_email)}.</p></div></div></div>`,
      }),
    });
    const emailPayload = await emailResult.json().catch(() => ({}));
    if (!emailResult.ok) return response({ error: typeof emailPayload?.message === "string" ? emailPayload.message : "The invitation email could not be sent." }, 400);
    return response({ ok: true, emailId: emailPayload?.id || null });
  } catch (error) {
    return response({ error: error instanceof Error ? error.message : "The invitation email could not be sent." }, 500);
  }
});
