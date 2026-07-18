import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLATFORM_ADMIN_EMAILS = ["quentin@n3xra.com", "quentin@quentinnichols.com"];
const PLATFORM_OWNER_EMAIL = "quentin@n3xra.com";

const PRODUCT_LABELS: Record<string, string> = {
  records: "N3XRA Records",
  ai_music: "AI Music Generator",
  virals: "N3XRA Virals",
  utilities: "N3XRA Utilities",
  all: "All N3XRA accounts",
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

function textValue(value: unknown, limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function normalizeProduct(value: unknown) {
  const product = String(value || "records").trim().toLowerCase();
  return PRODUCT_LABELS[product] ? product : "records";
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function findAuthUserByEmail(adminClient: ReturnType<typeof createClient>, inputEmail: string) {
  const email = normalizeEmail(inputEmail);
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    const match = (data.users || []).find((candidate) => normalizeEmail(candidate.email) === email);
    if (match) return match;
    if ((data.users || []).length < 1000) break;
  }
  return null;
}

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return base64Url(new Uint8Array(digest));
}

function createInviteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function getPlatformAdmin(adminClient: ReturnType<typeof createClient>, user: { id: string; email?: string | null }) {
  const email = normalizeEmail(user.email);
  if (email === PLATFORM_OWNER_EMAIL) {
    return {
      user_id: user.id,
      email,
      role: "owner",
      status: "active",
    };
  }

  const { data, error } = await adminClient
    .from("platform_admins")
    .select("user_id, email, role, status")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

function isOwnerAdmin(adminRecord: Record<string, unknown> | null) {
  return String(adminRecord?.role || "") === "owner";
}

function addRecipient(
  map: Map<string, Record<string, unknown>>,
  input: {
    user_id?: string | null;
    email?: string | null;
    name?: string | null;
    product?: string;
    productLabel?: string;
    plan?: string | null;
    status?: string | null;
    context?: string | null;
  }
) {
  const email = normalizeEmail(input.email);
  if (!email || !isValidEmail(email)) return;
  const existing = map.get(email);
  const product = input.product || "all";
  const productLabel = input.productLabel || PRODUCT_LABELS[product] || PRODUCT_LABELS.all;
  const context = textValue(input.context, 300);

  if (existing) {
    const products = new Set(String(existing.product || "").split(",").map((item) => item.trim()).filter(Boolean));
    products.add(product);
    const contexts = new Set(String(existing.context || "").split(" | ").map((item) => item.trim()).filter(Boolean));
    if (context) contexts.add(context);
    existing.product = Array.from(products).join(",");
    existing.productLabel = products.has("all") ? PRODUCT_LABELS.all : Array.from(products).map((item) => PRODUCT_LABELS[item] || item).join(", ");
    existing.context = Array.from(contexts).join(" | ");
    if (!existing.plan && input.plan) existing.plan = input.plan;
    if (!existing.status && input.status) existing.status = input.status;
    return;
  }

  map.set(email, {
    user_id: input.user_id || null,
    email,
    name: textValue(input.name, 180) || email,
    product,
    productLabel,
    plan: textValue(input.plan, 80),
    status: textValue(input.status, 80),
    context,
  });
}

function getProfileMap(profiles: Array<Record<string, unknown>> | null) {
  return new Map((profiles || []).map((profile) => [String(profile.id || ""), profile]));
}

async function loadProfiles(adminClient: ReturnType<typeof createClient>) {
  const { data, error } = await adminClient
    .from("profiles")
    .select("id, email, full_name")
    .order("email", { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

async function listNotificationRecipients(adminClient: ReturnType<typeof createClient>, product: string) {
  const profiles = await loadProfiles(adminClient);
  const profileMap = getProfileMap(profiles);
  const recipients = new Map<string, Record<string, unknown>>();

  if (product === "all") {
    profiles.forEach((profile) => {
      addRecipient(recipients, {
        user_id: String(profile.id || ""),
        email: String(profile.email || ""),
        name: String(profile.full_name || ""),
        product: "all",
        productLabel: PRODUCT_LABELS.all,
        context: "Shared N3XRA account",
      });
    });
    return Array.from(recipients.values()).sort(sortRecipients);
  }

  if (product === "records") {
    const [{ data: organizations, error: orgError }, { data: memberships, error: membershipError }] = await Promise.all([
      adminClient.from("organizations").select("id, name, owner_user_id, subscription_tier, account_status"),
      adminClient.from("organization_memberships").select("organization_id, user_id, role"),
    ]);
    if (orgError || membershipError) throw new Error(orgError?.message || membershipError?.message || "Unable to load Records recipients.");
    const orgMap = new Map((organizations || []).map((org) => [org.id, org]));

    (organizations || []).forEach((org) => {
      const profile = profileMap.get(String(org.owner_user_id || ""));
      addRecipient(recipients, {
        user_id: String(org.owner_user_id || ""),
        email: String(profile?.email || ""),
        name: String(profile?.full_name || ""),
        product,
        productLabel: PRODUCT_LABELS.records,
        plan: String(org.subscription_tier || ""),
        status: String(org.account_status || ""),
        context: `${org.name || "Records library"} owner`,
      });
    });

    (memberships || []).forEach((membership) => {
      const org = orgMap.get(membership.organization_id);
      const profile = profileMap.get(String(membership.user_id || ""));
      addRecipient(recipients, {
        user_id: String(membership.user_id || ""),
        email: String(profile?.email || ""),
        name: String(profile?.full_name || ""),
        product,
        productLabel: PRODUCT_LABELS.records,
        plan: String(org?.subscription_tier || ""),
        status: String(org?.account_status || ""),
        context: `${org?.name || "Records library"} ${membership.role || "member"}`,
      });
    });
  }

  if (product === "ai_music") {
    const { data, error } = await adminClient
      .from("music_profiles")
      .select("user_id, display_name, plan, account_status, monthly_song_limit, songs_used");
    if (error) throw new Error(error.message);
    (data || []).forEach((musicProfile) => {
      const profile = profileMap.get(String(musicProfile.user_id || ""));
      addRecipient(recipients, {
        user_id: String(musicProfile.user_id || ""),
        email: String(profile?.email || ""),
        name: String(musicProfile.display_name || profile?.full_name || ""),
        product,
        productLabel: PRODUCT_LABELS.ai_music,
        plan: String(musicProfile.plan || ""),
        status: String(musicProfile.account_status || ""),
        context: `${musicProfile.songs_used || 0}/${musicProfile.monthly_song_limit || 0} songs used`,
      });
    });
  }

  if (product === "virals") {
    const { data, error } = await adminClient
      .from("virals_profiles")
      .select("user_id, plan, account_status, monthly_analysis_limit, analyses_used");
    if (error) throw new Error(error.message);
    (data || []).forEach((viralsProfile) => {
      const profile = profileMap.get(String(viralsProfile.user_id || ""));
      addRecipient(recipients, {
        user_id: String(viralsProfile.user_id || ""),
        email: String(profile?.email || ""),
        name: String(profile?.full_name || ""),
        product,
        productLabel: PRODUCT_LABELS.virals,
        plan: String(viralsProfile.plan || ""),
        status: String(viralsProfile.account_status || ""),
        context: `${viralsProfile.analyses_used || 0}/${viralsProfile.monthly_analysis_limit || 0} analyses used`,
      });
    });
  }

  if (product === "utilities") {
    const [{ data: organizations, error: orgError }, { data: members, error: memberError }] = await Promise.all([
      adminClient.from("utility_organizations").select("id, name, status, launch_status, primary_contact_email"),
      adminClient.from("utility_organization_members").select("organization_id, user_id, role"),
    ]);
    if (orgError || memberError) throw new Error(orgError?.message || memberError?.message || "Unable to load Utilities recipients.");
    const orgMap = new Map((organizations || []).map((org) => [org.id, org]));

    (organizations || []).forEach((org) => {
      addRecipient(recipients, {
        email: String(org.primary_contact_email || ""),
        name: String(org.name || ""),
        product,
        productLabel: PRODUCT_LABELS.utilities,
        plan: String(org.launch_status || ""),
        status: String(org.status || ""),
        context: `${org.name || "Utilities organization"} primary contact`,
      });
    });

    (members || []).forEach((member) => {
      const org = orgMap.get(member.organization_id);
      const profile = profileMap.get(String(member.user_id || ""));
      addRecipient(recipients, {
        user_id: String(member.user_id || ""),
        email: String(profile?.email || ""),
        name: String(profile?.full_name || ""),
        product,
        productLabel: PRODUCT_LABELS.utilities,
        plan: String(org?.launch_status || ""),
        status: String(org?.status || ""),
        context: `${org?.name || "Utilities organization"} ${member.role || "member"}`,
      });
    });
  }

  return Array.from(recipients.values()).sort(sortRecipients);
}

function sortRecipients(first: Record<string, unknown>, second: Record<string, unknown>) {
  return String(first.email || "").localeCompare(String(second.email || ""));
}

function buildNotificationText(options: {
  productLabel: string;
  message: string;
  ctaUrl: string;
  ctaLabel: string;
}) {
  return [
    `${options.productLabel} update`,
    "",
    options.message,
    "",
    options.ctaUrl ? `${options.ctaLabel}: ${options.ctaUrl}` : "",
    "",
    "You are receiving this because your account is connected to N3XRA.",
  ].filter((line, index, lines) => line || lines[index - 1]).join("\n");
}

function buildNotificationHtml(options: {
  productLabel: string;
  subject: string;
  preheader: string;
  message: string;
  ctaUrl: string;
  ctaLabel: string;
}) {
  const safeProduct = escapeHtml(options.productLabel);
  const safeSubject = escapeHtml(options.subject);
  const safePreheader = escapeHtml(options.preheader);
  const safeMessage = escapeHtml(options.message).replace(/\n/g, "<br>");
  const safeCtaUrl = escapeHtml(options.ctaUrl);
  const safeCtaLabel = escapeHtml(options.ctaLabel || "Open N3XRA");

  const preheader = safePreheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${safePreheader}</div>`
    : "";
  const cta = safeCtaUrl
    ? `<p style="margin:24px 0 0;"><a href="${safeCtaUrl}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#123a33;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;">${safeCtaLabel}</a></p>`
    : "";

  return `
    ${preheader}
    <div style="margin:0;padding:28px;background:#f5f7fb;font-family:Manrope,Trebuchet MS,sans-serif;color:#121924;">
      <div style="max-width:660px;margin:0 auto;background:#ffffff;border:1px solid rgba(15,22,32,0.08);border-radius:18px;overflow:hidden;">
        <div style="padding:26px 28px;background:#0f141b;color:#ffffff;">
          <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;font-weight:700;opacity:0.82;">${safeProduct}</div>
          <h1 style="margin:10px 0 0;font-size:28px;line-height:1.15;">${safeSubject}</h1>
        </div>
        <div style="padding:28px;">
          <div style="margin:0;font-size:16px;line-height:1.65;color:#2f3d4d;">${safeMessage}</div>
          ${cta}
          <p style="margin:24px 0 0;padding-top:18px;border-top:1px solid rgba(15,22,32,0.08);font-size:12px;line-height:1.5;color:#6b7482;">You are receiving this because your account is connected to N3XRA.</p>
        </div>
      </div>
    </div>
  `;
}

function getAppOrigin(request: Request) {
  const origin = request.headers.get("Origin");
  if (origin) return origin;

  const referer = request.headers.get("Referer");
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      // Ignore invalid referrers and fall back to the production domain.
    }
  }

  return "https://n3xra.com";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return jsonResponse({ error: "Supabase environment variables are missing." }, 500);
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
    const action = payload.action;

    if (action === "redeem-platform-admin-invite") {
      const token = String(payload.token || "").trim();
      if (!token) {
        return jsonResponse({ error: "Invite token is required." }, 400);
      }

      const tokenHash = await sha256(token);
      const { data: invite, error: inviteError } = await adminClient
        .from("platform_admin_invites")
        .select("id, email, role, status, expires_at, created_by_user_id")
        .eq("token_hash", tokenHash)
        .maybeSingle();

      if (inviteError) return jsonResponse({ error: inviteError.message }, 400);
      if (!invite || invite.status !== "pending") {
        return jsonResponse({ error: "This admin invite is not valid." }, 400);
      }
      if (new Date(String(invite.expires_at || "")).getTime() < Date.now()) {
        await adminClient
          .from("platform_admin_invites")
          .update({ status: "expired", updated_at: new Date().toISOString() })
          .eq("id", invite.id);
        return jsonResponse({ error: "This admin invite has expired." }, 400);
      }

      const userEmail = normalizeEmail(user.email);
      if (normalizeEmail(invite.email) !== userEmail) {
        return jsonResponse({ error: `This invite is for ${invite.email}. Sign in with that email to redeem it.` }, 403);
      }

      const now = new Date().toISOString();
      const { error: adminError } = await adminClient
        .from("platform_admins")
        .upsert({
          user_id: user.id,
          email: userEmail,
          role: "admin",
          status: "active",
          invited_by_user_id: invite.created_by_user_id || null,
          updated_at: now,
        }, { onConflict: "user_id" });

      if (adminError) return jsonResponse({ error: adminError.message }, 400);

      const { error: redeemError } = await adminClient
        .from("platform_admin_invites")
        .update({
          status: "redeemed",
          redeemed_by_user_id: user.id,
          redeemed_at: now,
          updated_at: now,
        })
        .eq("id", invite.id);

      if (redeemError) return jsonResponse({ error: redeemError.message }, 400);
      return jsonResponse({ ok: true, role: "admin" });
    }

    const platformAdmin = await getPlatformAdmin(adminClient, { id: user.id, email: user.email });
    if (!platformAdmin) {
      return jsonResponse({ error: "Platform admin access required." }, 403);
    }

    if (action === "get-platform-admin-access") {
      return jsonResponse({
        ok: true,
        admin: {
          email: platformAdmin.email,
          role: platformAdmin.role,
          status: platformAdmin.status,
        },
      });
    }

    if (action === "list-website-members") {
      const websiteId = String(payload.websiteId || "").trim();
      if (!isValidUuid(websiteId)) {
        return jsonResponse({ error: "A valid websiteId is required." }, 400);
      }

      const { data: website, error: websiteError } = await adminClient
        .from("client_websites")
        .select("id, name")
        .eq("id", websiteId)
        .maybeSingle();
      if (websiteError) return jsonResponse({ error: websiteError.message }, 400);
      if (!website) return jsonResponse({ error: "Website not found." }, 404);

      const { data: memberships, error: membershipError } = await adminClient
        .from("website_members")
        .select("id, website_id, user_id, role, status, created_at, updated_at")
        .eq("website_id", websiteId)
        .order("created_at", { ascending: true });
      if (membershipError) return jsonResponse({ error: membershipError.message }, 400);

      const members = await Promise.all((memberships || []).map(async (membership) => {
        const { data: authData } = await adminClient.auth.admin.getUserById(membership.user_id);
        const authUser = authData?.user;
        return {
          ...membership,
          email: normalizeEmail(authUser?.email),
          name: textValue(
            authUser?.user_metadata?.full_name ||
            authUser?.user_metadata?.name ||
            authUser?.email,
            180,
          ),
        };
      }));
      return jsonResponse({ ok: true, website, members });
    }

    if (action === "assign-website-member") {
      const websiteId = String(payload.websiteId || "").trim();
      const email = normalizeEmail(payload.email);
      const role = String(payload.role || "").trim().toLowerCase();
      if (!isValidUuid(websiteId)) return jsonResponse({ error: "A valid websiteId is required." }, 400);
      if (!isValidEmail(email)) return jsonResponse({ error: "Enter a valid client email." }, 400);
      if (!["owner", "editor", "viewer"].includes(role)) {
        return jsonResponse({ error: "Role must be owner, editor, or viewer." }, 400);
      }

      const { data: website, error: websiteError } = await adminClient
        .from("client_websites")
        .select("id, name")
        .eq("id", websiteId)
        .maybeSingle();
      if (websiteError) return jsonResponse({ error: websiteError.message }, 400);
      if (!website) return jsonResponse({ error: "Website not found." }, 404);

      const targetUser = await findAuthUserByEmail(adminClient, email);
      if (!targetUser) {
        return jsonResponse({
          error: "No N3XRA account uses this email yet. Ask the client to create their account first, then assign them.",
        }, 404);
      }

      const now = new Date().toISOString();
      const { data: membership, error: membershipError } = await adminClient
        .from("website_members")
        .upsert({
          website_id: websiteId,
          user_id: targetUser.id,
          role,
          status: "active",
          invited_by_user_id: user.id,
          updated_at: now,
        }, { onConflict: "website_id,user_id" })
        .select("id, website_id, user_id, role, status, created_at, updated_at")
        .single();
      if (membershipError) return jsonResponse({ error: membershipError.message }, 400);
      return jsonResponse({
        ok: true,
        membership: {
          ...membership,
          email,
          name: textValue(targetUser.user_metadata?.full_name || targetUser.user_metadata?.name || email, 180),
        },
      });
    }

    if (action === "update-website-member") {
      const membershipId = String(payload.membershipId || "").trim();
      const role = String(payload.role || "").trim().toLowerCase();
      const status = String(payload.status || "active").trim().toLowerCase();
      if (!isValidUuid(membershipId)) return jsonResponse({ error: "A valid membershipId is required." }, 400);
      if (!["owner", "editor", "viewer"].includes(role)) {
        return jsonResponse({ error: "Role must be owner, editor, or viewer." }, 400);
      }
      if (!["active", "revoked"].includes(status)) {
        return jsonResponse({ error: "Status must be active or revoked." }, 400);
      }

      const { data: membership, error } = await adminClient
        .from("website_members")
        .update({ role, status, updated_at: new Date().toISOString() })
        .eq("id", membershipId)
        .select("id, website_id, user_id, role, status, created_at, updated_at")
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 400);
      if (!membership) return jsonResponse({ error: "Website membership not found." }, 404);
      return jsonResponse({ ok: true, membership });
    }

    if (action === "list-platform-admins") {
      if (!isOwnerAdmin(platformAdmin)) {
        return jsonResponse({ error: "Owner admin access required." }, 403);
      }

      const [{ data: admins, error: adminsError }, { data: invites, error: invitesError }] = await Promise.all([
        adminClient
          .from("platform_admins")
          .select("user_id, email, role, status, invited_by_user_id, created_at, updated_at")
          .order("role", { ascending: false })
          .order("email", { ascending: true }),
        adminClient
          .from("platform_admin_invites")
          .select("id, email, role, status, expires_at, created_at, redeemed_at, revoked_at")
          .order("created_at", { ascending: false })
          .limit(100),
      ]);

      if (adminsError || invitesError) {
        return jsonResponse({ error: adminsError?.message || invitesError?.message || "Unable to load platform admins." }, 400);
      }

      return jsonResponse({ ok: true, admins: admins || [], invites: invites || [] });
    }

    if (action === "create-platform-admin-invite") {
      if (!isOwnerAdmin(platformAdmin)) {
        return jsonResponse({ error: "Owner admin access required." }, 403);
      }

      const email = normalizeEmail(payload.email);
      if (!email || !isValidEmail(email)) {
        return jsonResponse({ error: "Enter a valid admin email." }, 400);
      }
      if (email === PLATFORM_OWNER_EMAIL) {
        return jsonResponse({ error: "The owner account is already the master admin." }, 400);
      }

      const token = createInviteToken();
      const tokenHash = await sha256(token);
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: invite, error } = await adminClient
        .from("platform_admin_invites")
        .insert({
          email,
          role: "admin",
          token_hash: tokenHash,
          expires_at: expiresAt,
          created_by_user_id: user.id,
        })
        .select("id, email, role, status, expires_at, created_at")
        .single();

      if (error) return jsonResponse({ error: error.message }, 400);

      const inviteUrl = new URL(getAppOrigin(request) + "/account");
      inviteUrl.searchParams.set("admin_invite", token);
      inviteUrl.searchParams.set("email", email);
      inviteUrl.searchParams.set("mode", "signup");

      return jsonResponse({ ok: true, invite, inviteUrl: inviteUrl.toString() });
    }

    if (action === "revoke-platform-admin-invite") {
      if (!isOwnerAdmin(platformAdmin)) {
        return jsonResponse({ error: "Owner admin access required." }, 403);
      }

      const inviteId = String(payload.inviteId || "").trim();
      if (!inviteId) return jsonResponse({ error: "inviteId is required." }, 400);
      const now = new Date().toISOString();
      const { error } = await adminClient
        .from("platform_admin_invites")
        .update({
          status: "revoked",
          revoked_by_user_id: user.id,
          revoked_at: now,
          updated_at: now,
        })
        .eq("id", inviteId)
        .eq("status", "pending");

      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true });
    }

    if (action === "revoke-platform-admin") {
      if (!isOwnerAdmin(platformAdmin)) {
        return jsonResponse({ error: "Owner admin access required." }, 403);
      }

      const userId = String(payload.userId || "").trim();
      if (!userId) return jsonResponse({ error: "userId is required." }, 400);
      if (userId === user.id) return jsonResponse({ error: "The owner cannot revoke themselves here." }, 400);

      const { error } = await adminClient
        .from("platform_admins")
        .update({ status: "revoked", updated_at: new Date().toISOString() })
        .eq("user_id", userId)
        .neq("role", "owner");

      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true });
    }

    if (action === "reset-password") {
      const email = String(payload.email || "").trim();
      if (!email) {
        return jsonResponse({ error: "email is required." }, 400);
      }

      const redirectTo = `${getAppOrigin(request)}/app/reset-password`;
      const { error } = await adminClient.auth.resetPasswordForEmail(email, {
        redirectTo,
      });

      if (error) {
        return jsonResponse({ error: error.message }, 400);
      }

      return jsonResponse({ ok: true });
    }

    if (action === "list-notification-recipients") {
      const product = normalizeProduct(payload.product);
      const recipients = await listNotificationRecipients(adminClient, product);
      return jsonResponse({
        ok: true,
        product,
        productLabel: PRODUCT_LABELS[product],
        recipients,
        count: recipients.length,
      });
    }

    if (action === "send-notification-email") {
      const resendApiKey = Deno.env.get("RESEND_API_KEY");
      if (!resendApiKey) {
        return jsonResponse({ error: "RESEND_API_KEY is missing." }, 500);
      }

      const product = normalizeProduct(payload.product);
      const productLabel = PRODUCT_LABELS[product];
      const subject = textValue(payload.subject, 180);
      const preheader = textValue(payload.preheader, 220);
      const message = String(payload.message || "").trim().slice(0, 8000);
      const ctaUrl = String(payload.ctaUrl || "").trim().slice(0, 900);
      const ctaLabel = textValue(payload.ctaLabel || "Open N3XRA", 80);
      const rawEmails = Array.isArray(payload.recipientEmails) ? payload.recipientEmails : [];
      const recipientEmails = Array.from(new Set(rawEmails.map(normalizeEmail).filter(Boolean))).slice(0, 500);

      if (!subject || !message || !recipientEmails.length) {
        return jsonResponse({ error: "subject, message, and recipientEmails are required." }, 400);
      }
      const invalidEmail = recipientEmails.find((email) => !isValidEmail(email));
      if (invalidEmail) {
        return jsonResponse({ error: `Recipient email is invalid: ${invalidEmail}` }, 400);
      }
      if (ctaUrl && !/^https?:\/\//i.test(ctaUrl)) {
        return jsonResponse({ error: "ctaUrl must start with http:// or https://." }, 400);
      }

      const allowedRecipients = await listNotificationRecipients(adminClient, product);
      const allowedEmails = new Set(allowedRecipients.map((recipient) => normalizeEmail(recipient.email)).filter(Boolean));
      const unauthorizedEmail = recipientEmails.find((email) => !allowedEmails.has(email));
      if (unauthorizedEmail) {
        return jsonResponse({ error: `Recipient is not in the selected product audience: ${unauthorizedEmail}` }, 400);
      }

      const html = buildNotificationHtml({ productLabel, subject, preheader, message, ctaUrl, ctaLabel });
      const text = buildNotificationText({ productLabel, message, ctaUrl, ctaLabel });
      const fromEmail = Deno.env.get("PLATFORM_UPDATE_FROM_EMAIL") || "N3XRA <updates@n3xra.com>";

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

        const emailPayload = await emailResponse.json().catch(() => ({}));
        if (emailResponse.ok) {
          sent.push({ email, id: typeof emailPayload?.id === "string" ? emailPayload.id : null });
        } else {
          failed.push({ email, error: String(emailPayload?.message || emailPayload?.error || "Update email failed to send.") });
        }
      }

      return jsonResponse({
        ok: failed.length === 0,
        sent,
        failed,
        sentCount: sent.length,
        failedCount: failed.length,
      }, sent.length ? 200 : 400);
    }

    return jsonResponse({ error: "Unsupported platform-admin action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected platform-admin error.";
    return jsonResponse({ error: message }, 500);
  }
});
