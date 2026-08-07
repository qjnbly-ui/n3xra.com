import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PLATFORM_ADMIN_EMAILS = ["quentin@n3xra.com", "quentin@quentinnichols.com"];
const PLATFORM_OWNER_EMAIL = "quentin@n3xra.com";
const ADMIN_RECORDS_WORKSPACE_NAME = "N3XRA Administration";
const ADMIN_RECORDS_WORKSPACE_SLUG = "n3xra-administration";

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

function normalizePhone(value: unknown) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 10) digits = `1${digits}`;
  return /^[1-9][0-9]{7,14}$/.test(digits) ? `+${digits}` : "";
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

async function ensureAdminRecordsWorkspace(
  adminClient: ReturnType<typeof createClient>,
  currentAdminUserId: string,
) {
  const ownerUser = await findAuthUserByEmail(adminClient, PLATFORM_OWNER_EMAIL);
  if (!ownerUser?.id) throw new Error("The N3XRA owner account is unavailable.");

  let { data: organization, error: organizationError } = await adminClient
    .from("organizations")
    .select("id,name,slug")
    .eq("slug", ADMIN_RECORDS_WORKSPACE_SLUG)
    .maybeSingle();
  if (organizationError) throw new Error(organizationError.message);

  if (!organization) {
    const createResult = await adminClient
      .from("organizations")
      .insert({
        name: ADMIN_RECORDS_WORKSPACE_NAME,
        slug: ADMIN_RECORDS_WORKSPACE_SLUG,
        owner_user_id: ownerUser.id,
        subscription_tier: "organization",
        account_status: "active",
        document_limit: 10000,
        storage_limit_mb: 51200,
        user_limit: 100,
        public_embed_enabled: false,
      })
      .select("id,name,slug")
      .single();

    if (createResult.error?.code === "23505") {
      const existingResult = await adminClient
        .from("organizations")
        .select("id,name,slug")
        .eq("slug", ADMIN_RECORDS_WORKSPACE_SLUG)
        .single();
      if (existingResult.error) throw new Error(existingResult.error.message);
      organization = existingResult.data;
    } else if (createResult.error) {
      throw new Error(createResult.error.message);
    } else {
      organization = createResult.data;
    }
  }

  if (!organization?.id) throw new Error("The N3XRA Admin Records workspace could not be resolved.");

  const { data: activeAdmins, error: activeAdminsError } = await adminClient
    .from("platform_admins")
    .select("user_id")
    .eq("status", "active");
  if (activeAdminsError) throw new Error(activeAdminsError.message);

  const adminUserIds = Array.from(new Set([
    ownerUser.id,
    currentAdminUserId,
    ...(activeAdmins || []).map((admin) => String(admin.user_id || "")).filter(Boolean),
  ]));
  const memberships = adminUserIds.map((userId) => ({
    organization_id: organization.id,
    user_id: userId,
    role: "account_admin",
    created_by: ownerUser.id,
    updated_at: new Date().toISOString(),
  }));
  const { error: membershipError } = await adminClient
    .from("organization_memberships")
    .upsert(memberships, { onConflict: "organization_id,user_id" });
  if (membershipError) throw new Error(membershipError.message);

  return organization;
}

async function listAllAuthUsers(adminClient: ReturnType<typeof createClient>) {
  const users: Array<any> = [];
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    users.push(...(data.users || []));
    if ((data.users || []).length < 1000) break;
  }
  return users;
}

async function loadPlatformAccountData(adminClient: ReturnType<typeof createClient>) {
  const [
    profilesResult,
    recordsOrganizationsResult,
    recordsMembershipsResult,
    websitesResult,
    websiteMembersResult,
    utilityOrganizationsResult,
    utilityMembersResult,
    utilityRolesResult,
    musicProfilesResult,
    viralsProfilesResult,
    accountPhonesResult,
    authUsers,
  ] = await Promise.all([
    adminClient.from("profiles").select("id, email, full_name, organization_name, role, subscription_tier, account_status, created_at, updated_at"),
    adminClient.from("organizations").select("id, name, owner_user_id, subscription_tier, account_status, billing_cycle, document_limit, user_limit, storage_limit_mb, stripe_customer_id, stripe_subscription_id, subscription_current_period_end"),
    adminClient.from("organization_memberships").select("id, organization_id, user_id, role, created_at"),
    adminClient.from("client_websites").select("id, name, status"),
    adminClient.from("website_members").select("id, website_id, user_id, role, status, created_at"),
    adminClient.from("utility_organizations").select("id, name, status, launch_status"),
    adminClient.from("utility_organization_members").select("id, organization_id, user_id, role_id, status, created_at"),
    adminClient.from("utility_roles").select("id, name, display_name"),
    adminClient.from("music_profiles").select("user_id, display_name, plan, account_status, monthly_song_limit, songs_used, stripe_customer_id, stripe_subscription_id, subscription_current_period_end"),
    adminClient.from("virals_profiles").select("user_id, plan, account_status, monthly_analysis_limit, analyses_used, stripe_customer_id, stripe_subscription_id, subscription_current_period_end"),
    adminClient.from("account_phone_credentials").select("user_id, phone_e164, failed_attempts, locked_until, last_authenticated_at, last_password_reset_sent_at, created_at, updated_at"),
    listAllAuthUsers(adminClient),
  ]);

  const results = [
    profilesResult,
    recordsOrganizationsResult,
    recordsMembershipsResult,
    websitesResult,
    websiteMembersResult,
    utilityOrganizationsResult,
    utilityMembersResult,
    utilityRolesResult,
    musicProfilesResult,
    viralsProfilesResult,
    accountPhonesResult,
  ];
  const firstError = results.find((result) => result.error)?.error;
  if (firstError) throw new Error(firstError.message);

  const profiles = profilesResult.data || [];
  const profileMap = new Map(profiles.map((profile) => [String(profile.id), profile]));
  const authMap = new Map(authUsers.map((authUser) => [String(authUser.id), authUser]));
  const recordsOrgMap = new Map((recordsOrganizationsResult.data || []).map((organization) => [String(organization.id), organization]));
  const websiteMap = new Map((websitesResult.data || []).map((website) => [String(website.id), website]));
  const utilityMap = new Map((utilityOrganizationsResult.data || []).map((organization) => [String(organization.id), organization]));
  const utilityRoleMap = new Map((utilityRolesResult.data || []).map((role) => [String(role.id), role]));
  const accountPhoneMap = new Map((accountPhonesResult.data || []).map((credential) => [String(credential.user_id), credential]));
  const accessMap = new Map<string, Array<Record<string, unknown>>>();

  const addAccess = (userId: unknown, access: Record<string, unknown>) => {
    const key = String(userId || "");
    if (!key) return;
    const items = accessMap.get(key) || [];
    const existingIndex = items.findIndex((item) =>
      String(item.product || "") === String(access.product || "") &&
      String(item.organizationId || "") === String(access.organizationId || "")
    );
    if (existingIndex >= 0) {
      const existing = items[existingIndex];
      const role = [existing.role, access.role].map((value) => String(value || "")).includes("owner")
        ? "owner"
        : access.role || existing.role;
      items[existingIndex] = { ...existing, ...access, role };
      accessMap.set(key, items);
      return;
    }
    items.push(access);
    accessMap.set(key, items);
  };

  (recordsOrganizationsResult.data || []).forEach((organization) => addAccess(organization.owner_user_id, {
    product: "records", productLabel: PRODUCT_LABELS.records, organizationId: organization.id,
    organization: organization.name, role: "owner", status: organization.account_status,
  }));
  (recordsMembershipsResult.data || []).forEach((membership) => {
    const organization = recordsOrgMap.get(String(membership.organization_id));
    addAccess(membership.user_id, {
      product: "records", productLabel: PRODUCT_LABELS.records, organizationId: membership.organization_id,
      organization: organization?.name || "Records organization", role: membership.role, status: organization?.account_status || "active",
    });
  });
  (websiteMembersResult.data || []).forEach((membership) => {
    const website = websiteMap.get(String(membership.website_id));
    addAccess(membership.user_id, {
      product: "websites", productLabel: "Client Websites", organizationId: membership.website_id,
      organization: website?.name || "Client website", role: membership.role, status: membership.status,
    });
  });
  (utilityMembersResult.data || []).forEach((membership) => {
    const organization = utilityMap.get(String(membership.organization_id));
    const role = utilityRoleMap.get(String(membership.role_id));
    addAccess(membership.user_id, {
      product: "utilities", productLabel: PRODUCT_LABELS.utilities, organizationId: membership.organization_id,
      organization: organization?.name || "Utility organization", role: role?.display_name || role?.name || "member", status: membership.status || organization?.status || "active",
    });
  });
  (musicProfilesResult.data || []).forEach((profile) => addAccess(profile.user_id, {
    product: "ai_music", productLabel: PRODUCT_LABELS.ai_music, role: "account", status: profile.account_status, plan: profile.plan,
  }));
  (viralsProfilesResult.data || []).forEach((profile) => addAccess(profile.user_id, {
    product: "virals", productLabel: PRODUCT_LABELS.virals, role: "account", status: profile.account_status, plan: profile.plan,
  }));

  const knownUserIds = new Set([
    ...profiles.map((profile) => String(profile.id)),
    ...authUsers.map((authUser) => String(authUser.id)),
  ]);
  const accounts = Array.from(knownUserIds).map((userId) => {
    const profile = profileMap.get(userId);
    const authUser = authMap.get(userId);
    const phoneCredential = accountPhoneMap.get(userId);
    const authProviders = Array.from(new Set([
      ...(Array.isArray(authUser?.app_metadata?.providers) ? authUser.app_metadata.providers : []),
      ...(Array.isArray(authUser?.identities) ? authUser.identities.map((identity: any) => identity?.provider) : []),
      authUser?.app_metadata?.provider,
    ].map((provider) => String(provider || "").trim()).filter(Boolean)));
    const authPhone = normalizePhone(authUser?.phone || authUser?.user_metadata?.phone || authUser?.user_metadata?.phone_number);
    const accountPhone = normalizePhone(phoneCredential?.phone_e164);
    return {
      id: userId,
      email: normalizeEmail(profile?.email || authUser?.email),
      name: textValue(profile?.full_name || authUser?.user_metadata?.full_name || authUser?.user_metadata?.name || authUser?.email, 180),
      createdAt: authUser?.created_at || profile?.created_at || null,
      updatedAt: authUser?.updated_at || profile?.updated_at || null,
      lastSignInAt: authUser?.last_sign_in_at || null,
      bannedUntil: authUser?.banned_until || null,
      emailConfirmedAt: authUser?.email_confirmed_at || null,
      phone: authPhone || accountPhone,
      authPhone: authPhone || "",
      phoneConfirmedAt: authUser?.phone_confirmed_at || null,
      phoneAccessConfigured: Boolean(accountPhone),
      phoneAccessCreatedAt: phoneCredential?.created_at || null,
      phoneAccessUpdatedAt: phoneCredential?.updated_at || null,
      phoneLastAuthenticatedAt: phoneCredential?.last_authenticated_at || null,
      phoneLockedUntil: phoneCredential?.locked_until || null,
      phoneFailedAttempts: Number(phoneCredential?.failed_attempts || 0),
      phonePasswordResetSentAt: phoneCredential?.last_password_reset_sent_at || null,
      providers: authProviders,
      isAnonymous: Boolean(authUser?.is_anonymous),
      profileOrganization: textValue(profile?.organization_name, 180),
      profileRole: textValue(profile?.role, 80),
      profilePlan: textValue(profile?.subscription_tier, 80),
      profileStatus: textValue(profile?.account_status, 80),
      access: accessMap.get(userId) || [],
    };
  }).filter((account) => account.email).sort((a, b) => a.email.localeCompare(b.email));

  const billing: Array<Record<string, unknown>> = [];
  (recordsOrganizationsResult.data || []).forEach((organization) => {
    const owner = profileMap.get(String(organization.owner_user_id));
    billing.push({
      id: organization.id, product: "records", productLabel: PRODUCT_LABELS.records,
      account: organization.name, email: owner?.email || "", plan: organization.subscription_tier,
      status: organization.account_status, cycle: organization.billing_cycle || "monthly",
      customerId: organization.stripe_customer_id, subscriptionId: organization.stripe_subscription_id,
      periodEnd: organization.subscription_current_period_end,
      usage: `${organization.document_limit || 0} documents · ${organization.user_limit || 0} seats · ${organization.storage_limit_mb || 0} MB`,
    });
  });
  (musicProfilesResult.data || []).forEach((profile) => {
    const owner = profileMap.get(String(profile.user_id));
    billing.push({
      id: profile.user_id, product: "ai_music", productLabel: PRODUCT_LABELS.ai_music,
      account: profile.display_name || owner?.full_name || owner?.email || "Music account", email: owner?.email || "",
      plan: profile.plan, status: profile.account_status, customerId: profile.stripe_customer_id,
      subscriptionId: profile.stripe_subscription_id, periodEnd: profile.subscription_current_period_end,
      usage: `${profile.songs_used || 0}/${profile.monthly_song_limit || 0} songs`,
    });
  });
  (viralsProfilesResult.data || []).forEach((profile) => {
    const owner = profileMap.get(String(profile.user_id));
    billing.push({
      id: profile.user_id, product: "virals", productLabel: PRODUCT_LABELS.virals,
      account: owner?.full_name || owner?.email || "Virals account", email: owner?.email || "",
      plan: profile.plan, status: profile.account_status, customerId: profile.stripe_customer_id,
      subscriptionId: profile.stripe_subscription_id, periodEnd: profile.subscription_current_period_end,
      usage: `${profile.analyses_used || 0}/${profile.monthly_analysis_limit || 0} analyses`,
    });
  });

  return { accounts, billing };
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

function normalizeDemoClaimCode(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function createDemoClaimCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
  return `DEMO-${token.slice(0, 4)}-${token.slice(4, 8)}-${token.slice(8, 12)}`;
}

function createOrganizationSlug(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "demo";
  const suffixBytes = new Uint8Array(5);
  crypto.getRandomValues(suffixBytes);
  const suffix = Array.from(suffixBytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${base}-${suffix}`;
}

function buildDemoClaimUrl(request: Request, code: string, email = "") {
  const claimUrl = new URL(getAppOrigin(request) + "/n3xra-records/login.html");
  claimUrl.searchParams.set("mode", "signup");
  claimUrl.searchParams.set("signup", "invite");
  claimUrl.searchParams.set("invite", code);
  if (email) claimUrl.searchParams.set("email", email);
  return claimUrl.toString();
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
    if (!existing.user_id && input.user_id) existing.user_id = input.user_id;
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
    const [
      { data: organizations, error: orgError },
      { data: members, error: memberError },
      { data: roles, error: roleError },
    ] = await Promise.all([
      adminClient.from("utility_organizations").select("id, name, status, launch_status, primary_contact_email"),
      adminClient.from("utility_organization_members").select("organization_id, user_id, role_id"),
      adminClient.from("utility_roles").select("id, name, display_name"),
    ]);
    if (orgError || memberError || roleError) {
      throw new Error(orgError?.message || memberError?.message || roleError?.message || "Unable to load Utilities recipients.");
    }
    const orgMap = new Map((organizations || []).map((org) => [org.id, org]));
    const roleMap = new Map((roles || []).map((role) => [role.id, role]));

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
      const role = roleMap.get(member.role_id);
      const profile = profileMap.get(String(member.user_id || ""));
      addRecipient(recipients, {
        user_id: String(member.user_id || ""),
        email: String(profile?.email || ""),
        name: String(profile?.full_name || ""),
        product,
        productLabel: PRODUCT_LABELS.utilities,
        plan: String(org?.launch_status || ""),
        status: String(org?.status || ""),
        context: `${org?.name || "Utilities organization"} ${role?.display_name || role?.name || "member"}`,
      });
    });
  }

  const recipientList = Array.from(recipients.values()).sort(sortRecipients);
  const userIds = recipientList.map((recipient) => String(recipient.user_id || "")).filter(isValidUuid);
  if (!userIds.length) return recipientList;

  const [{ data: credentials, error: credentialsError }, { data: consentEvents, error: consentError }] = await Promise.all([
    adminClient.from("account_phone_credentials").select("user_id,phone_e164").in("user_id", userIds),
    adminClient.from("sms_consent_events").select("phone_e164,event_type,created_at").order("created_at", { ascending: false }).limit(10000),
  ]);
  if (credentialsError || consentError) {
    throw new Error(credentialsError?.message || consentError?.message || "Unable to load SMS settings.");
  }

  const latestConsentByPhone = new Map<string, Record<string, unknown>>();
  (consentEvents || []).forEach((event) => {
    const phone = normalizePhone(event.phone_e164);
    if (phone && !latestConsentByPhone.has(phone)) latestConsentByPhone.set(phone, event);
  });
  const credentialByUser = new Map((credentials || []).map((credential) => [String(credential.user_id || ""), credential]));
  return recipientList.map((recipient) => {
    const credential = credentialByUser.get(String(recipient.user_id || ""));
    const phone = normalizePhone(credential?.phone_e164);
    const consent = phone ? latestConsentByPhone.get(phone) : null;
    return {
      ...recipient,
      phone,
      smsOptedIn: Boolean(phone && consent?.event_type === "opt_in"),
    };
  });
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

function buildNotificationSms(options: {
  productLabel: string;
  message: string;
  ctaUrl: string;
  ctaLabel: string;
}) {
  return [
    `${options.productLabel}:`,
    options.message,
    options.ctaUrl ? `${options.ctaLabel}: ${options.ctaUrl}` : "",
    "Reply STOP to opt out or HELP for help.",
  ].filter(Boolean).join("\n\n").slice(0, 1200);
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

    if (action === "claim-records-demo-workspace") {
      const claimCode = normalizeDemoClaimCode(payload.code);
      if (!claimCode.startsWith("DEMO-") || claimCode.length < 15) {
        return jsonResponse({ error: "Enter a valid demo claim code." }, 400);
      }

      const codeHash = await sha256(claimCode);
      const { data, error } = await adminClient.rpc("claim_records_demo_workspace", {
        input_code_hash: codeHash,
        input_claimant_user_id: user.id,
        input_claimant_email: normalizeEmail(user.email),
      });

      if (error) return jsonResponse({ error: error.message }, 400);
      if (data?.ok === false) return jsonResponse({ error: data?.error || "Unable to claim the demo workspace." }, 400);
      return jsonResponse({
        ok: true,
        organizationId: data?.organization_id || null,
        organizationName: data?.organization_name || null,
      });
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

    if (action === "list-website-request-workspace") {
      const [requestsResult, proposalsResult, reviewsResult, websitesResult, membersResult] = await Promise.all([
        adminClient.from("website_service_requests").select("*").order("created_at", { ascending: false }),
        adminClient.from("website_proposals").select("id,request_id"),
        adminClient.from("website_request_ai_reviews").select("*").order("created_at", { ascending: false }).limit(250),
        adminClient.from("client_websites").select("id,name,status,live_url").neq("status", "archived").order("name"),
        adminClient.from("website_members").select("website_id,user_id,status,role"),
      ]);
      const firstError = [requestsResult, proposalsResult, reviewsResult, websitesResult, membersResult]
        .find((result) => result.error)?.error;
      if (firstError) return jsonResponse({ error: firstError.message }, 400);
      return jsonResponse({
        ok: true,
        requests: requestsResult.data || [],
        proposals: proposalsResult.data || [],
        aiReviews: reviewsResult.data || [],
        websites: websitesResult.data || [],
        websiteMembers: membersResult.data || [],
      });
    }

    if (action === "recover-website-request-review") {
      const reviewId = String(payload.reviewId || "").trim();
      if (!isValidUuid(reviewId)) return jsonResponse({ error: "A valid intake review is required." }, 400);
      const { data: review, error: reviewError } = await adminClient
        .from("website_request_ai_reviews")
        .select("id,user_id,contact_email,project_snapshot,created_at")
        .eq("id", reviewId)
        .single();
      if (reviewError || !review) return jsonResponse({ error: reviewError?.message || "The intake review was not found." }, 404);

      const { data: existing } = await adminClient
        .from("website_service_requests")
        .select("*")
        .eq("ai_review_id", review.id)
        .maybeSingle();
      if (existing) return jsonResponse({ ok: true, request: existing, recovered: false });

      const project = review.project_snapshot || {};
      const email = normalizeEmail(review.contact_email || project.email);
      const authUser = review.user_id ? { id: review.user_id } : await findAuthUserByEmail(adminClient, email);
      if (!authUser?.id) return jsonResponse({ error: "The client must verify their email before this intake can be recovered." }, 400);
      const contactName = textValue(project.contactName, 160);
      const businessName = textValue(project.businessName, 180);
      const primaryGoal = textValue(project.primaryGoal, 2000);
      if (!contactName || !businessName || !email || !primaryGoal) return jsonResponse({ error: "This intake is missing required contact or project information." }, 400);

      const { data: recoveredRequest, error: recoverError } = await adminClient
        .from("website_service_requests")
        .insert({
          user_id: authUser.id,
          contact_name: contactName,
          business_name: businessName,
          contact_email: email,
          contact_phone: textValue(project.phone, 40) || null,
          project_type: textValue(project.projectType, 40) || "new_website",
          existing_website_url: textValue(project.existingWebsiteUrl, 500) || null,
          primary_goal: primaryGoal,
          audience: textValue(project.primaryAudience, 2000) || null,
          requested_pages: Array.isArray(project.requestedPages) ? project.requestedPages.map((item: unknown) => textValue(item, 160)).filter(Boolean) : [],
          requested_features: Array.isArray(project.requestedFeatures) ? project.requestedFeatures.map((item: unknown) => textValue(item, 160)).filter(Boolean) : [],
          service_plan: textValue(project.servicePlan, 40) || null,
          service_plan_auto_applied: Boolean(project.servicePlanAutoApplied),
          service_plan_reason: textValue(project.servicePlanReason, 1000) || null,
          budget_range: textValue(project.budgetRange, 80) || null,
          target_launch_date: textValue(project.preferredLaunchDate, 20) || null,
          referral_code: textValue(project.referralCode, 80) || null,
          offer_code: textValue(project.offerCode, 80) || null,
          additional_notes: textValue(project.additionalNotes, 4000) || null,
          ai_review_id: review.id,
          status: "submitted",
          created_at: review.created_at,
        })
        .select("*")
        .single();
      if (recoverError) return jsonResponse({ error: recoverError.message }, 400);
      return jsonResponse({ ok: true, request: recoveredRequest, recovered: true });
    }

    if (action === "delete-website-request-review") {
      const reviewId = String(payload.reviewId || "").trim();
      if (!isValidUuid(reviewId)) return jsonResponse({ error: "A valid intake review is required." }, 400);

      const { data: linkedRequest, error: linkedRequestError } = await adminClient
        .from("website_service_requests")
        .select("id")
        .eq("ai_review_id", reviewId)
        .maybeSingle();
      if (linkedRequestError) return jsonResponse({ error: linkedRequestError.message }, 400);
      if (linkedRequest) return jsonResponse({ error: "This intake has already been recovered. Delete or archive the submitted request instead." }, 409);

      const { data: deletedReview, error: deleteError } = await adminClient
        .from("website_request_ai_reviews")
        .delete()
        .eq("id", reviewId)
        .select("id")
        .maybeSingle();
      if (deleteError) return jsonResponse({ error: deleteError.message }, 400);
      if (!deletedReview) return jsonResponse({ error: "The saved intake was not found." }, 404);
      return jsonResponse({ ok: true, deletedId: deletedReview.id });
    }

    if (action === "list-n3xra-files") {
      const [{ data: files, error: filesError }, { data: access, error: accessError }, { data: admins, error: adminsError }] = await Promise.all([
        adminClient.from("n3xra_files").select("id,name,storage_path,mime_type,size_bytes,created_by,created_at").order("created_at", { ascending: false }),
        adminClient.from("n3xra_file_access").select("file_id,user_id"),
        adminClient.from("platform_admins").select("user_id,email,role,status").eq("status", "active").order("email", { ascending: true }),
      ]);
      if (filesError || accessError || adminsError) {
        return jsonResponse({ error: filesError?.message || accessError?.message || adminsError?.message || "Unable to load N3XRA Files." }, 400);
      }
      const allowedFileIds = new Set((access || []).filter((item) => String(item.user_id) === user.id).map((item) => String(item.file_id)));
      const visibleFiles = (files || []).filter((file) => allowedFileIds.has(String(file.id)));
      return jsonResponse({
        ok: true,
        files: visibleFiles,
        access: access || [],
        admins: admins || [],
      });
    }

    if (action === "create-n3xra-file") {
      const name = textValue(payload.name, 180);
      const storagePath = String(payload.storagePath || "").trim();
      const mimeType = textValue(payload.mimeType || "application/octet-stream", 180);
      const sizeBytes = Math.max(0, Number(payload.sizeBytes || 0));
      if (!name || !storagePath || !Number.isFinite(sizeBytes)) return jsonResponse({ error: "File name, storage path, and size are required." }, 400);
      if (!storagePath.startsWith("uploads/") || storagePath.includes("..")) return jsonResponse({ error: "Invalid storage path." }, 400);
      const { data: file, error: fileError } = await adminClient.from("n3xra_files").insert({
        name,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: Math.round(sizeBytes),
        created_by: user.id,
      }).select("id,name,storage_path,mime_type,size_bytes,created_by,created_at").single();
      if (fileError) return jsonResponse({ error: fileError.message }, 400);
      const { error: accessError } = await adminClient.from("n3xra_file_access").insert({ file_id: file.id, user_id: user.id, granted_by: user.id });
      if (accessError) return jsonResponse({ error: accessError.message }, 400);
      return jsonResponse({ ok: true, file });
    }

    if (action === "update-n3xra-file-access") {
      const fileId = String(payload.fileId || "").trim();
      const userIds = Array.isArray(payload.userIds) ? Array.from(new Set(payload.userIds.map((value) => String(value || "").trim()).filter(isValidUuid))) : [];
      if (!isValidUuid(fileId)) return jsonResponse({ error: "A valid fileId is required." }, 400);
      const { data: file, error: fileError } = await adminClient.from("n3xra_files").select("id").eq("id", fileId).maybeSingle();
      if (fileError || !file) return jsonResponse({ error: fileError?.message || "File not found." }, 404);
      const { error: deleteError } = await adminClient.from("n3xra_file_access").delete().eq("file_id", fileId);
      if (deleteError) return jsonResponse({ error: deleteError.message }, 400);
      const rows = Array.from(new Set([user.id, ...userIds])).map((userId) => ({ file_id: fileId, user_id: userId, granted_by: user.id }));
      const { error: insertError } = await adminClient.from("n3xra_file_access").insert(rows);
      if (insertError) return jsonResponse({ error: insertError.message }, 400);
      return jsonResponse({ ok: true, userIds: rows.map((row) => row.user_id) });
    }

    if (action === "get-n3xra-file-url") {
      const fileId = String(payload.fileId || "").trim();
      if (!isValidUuid(fileId)) return jsonResponse({ error: "A valid fileId is required." }, 400);
      const { data: file, error: fileError } = await adminClient.from("n3xra_files").select("id,name,storage_path,mime_type").eq("id", fileId).maybeSingle();
      if (fileError || !file) return jsonResponse({ error: fileError?.message || "File not found." }, 404);
      const { data: grant, error: grantError } = await adminClient.from("n3xra_file_access").select("file_id").eq("file_id", fileId).eq("user_id", user.id).maybeSingle();
      if (grantError || !grant) return jsonResponse({ error: "You do not have access to this file." }, 403);
      const { data: signed, error: signedError } = await adminClient.storage.from("n3xra-files").createSignedUrl(file.storage_path, 60 * 10);
      if (signedError || !signed?.signedUrl) return jsonResponse({ error: signedError?.message || "Unable to prepare the file." }, 400);
      return jsonResponse({ ok: true, url: signed.signedUrl, name: file.name, mimeType: file.mime_type });
    }

    if (action === "delete-n3xra-file") {
      const fileId = String(payload.fileId || "").trim();
      if (!isValidUuid(fileId)) return jsonResponse({ error: "A valid fileId is required." }, 400);
      const { data: file, error: fileError } = await adminClient.from("n3xra_files").select("id,storage_path").eq("id", fileId).maybeSingle();
      if (fileError || !file) return jsonResponse({ error: fileError?.message || "File not found." }, 404);
      const { error: storageError } = await adminClient.storage.from("n3xra-files").remove([file.storage_path]);
      if (storageError) return jsonResponse({ error: storageError.message }, 400);
      const { error: deleteError } = await adminClient.from("n3xra_files").delete().eq("id", fileId);
      if (deleteError) return jsonResponse({ error: deleteError.message }, 400);
      return jsonResponse({ ok: true });
    }

    if (action === "delete-n3xra-folder") {
      const folderPath = String(payload.folderPath || "").trim().replace(/^\/|\/$/g, "");
      if (!folderPath || folderPath.includes("..")) return jsonResponse({ error: "A valid folder path is required." }, 400);
      const { data: files, error: filesError } = await adminClient.from("n3xra_files").select("id,storage_path").like("name", `${folderPath}/%`);
      if (filesError) return jsonResponse({ error: filesError.message }, 400);
      if (files?.length) {
        const { error: storageError } = await adminClient.storage.from("n3xra-files").remove(files.map((file) => file.storage_path));
        if (storageError) return jsonResponse({ error: storageError.message }, 400);
        const { error: deleteError } = await adminClient.from("n3xra_files").delete().in("id", files.map((file) => file.id));
        if (deleteError) return jsonResponse({ error: deleteError.message }, 400);
      }
      return jsonResponse({ ok: true, deletedCount: files?.length || 0 });
    }

    if (action === "open-admin-records-workspace") {
      const organization = await ensureAdminRecordsWorkspace(adminClient, user.id);
      return jsonResponse({
        ok: true,
        organizationId: organization.id,
        organizationName: organization.name,
      });
    }

    if (action === "list-platform-accounts") {
      const { accounts } = await loadPlatformAccountData(adminClient);
      return jsonResponse({ ok: true, accounts, count: accounts.length });
    }

    if (action === "update-platform-account") {
      const userId = String(payload.userId || "").trim();
      const name = textValue(payload.name, 180);
      const email = normalizeEmail(payload.email);
      if (!isValidUuid(userId)) return jsonResponse({ error: "A valid userId is required." }, 400);
      if (!name) return jsonResponse({ error: "Account name is required." }, 400);
      if (!isValidEmail(email)) return jsonResponse({ error: "A valid email is required." }, 400);

      const { data: currentUser, error: currentUserError } = await adminClient.auth.admin.getUserById(userId);
      if (currentUserError || !currentUser?.user) {
        return jsonResponse({ error: currentUserError?.message || "Account not found." }, 404);
      }
      const { data: updatedAuth, error: updateAuthError } = await adminClient.auth.admin.updateUserById(userId, {
        email,
        user_metadata: { ...(currentUser.user.user_metadata || {}), full_name: name, name },
      });
      if (updateAuthError || !updatedAuth?.user) {
        return jsonResponse({ error: updateAuthError?.message || "Unable to update the account." }, 400);
      }
      const { error: profileError } = await adminClient.from("profiles").upsert({
        id: userId,
        email,
        full_name: name,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" });
      if (profileError) return jsonResponse({ error: profileError.message }, 400);

      return jsonResponse({
        ok: true,
        account: {
          id: userId,
          email: normalizeEmail(updatedAuth.user.email),
          name,
          emailConfirmedAt: updatedAuth.user.email_confirmed_at || null,
        },
      });
    }

    if (action === "set-platform-account-suspension") {
      const userId = String(payload.userId || "").trim();
      const suspended = payload.suspended === true;
      if (!isValidUuid(userId)) return jsonResponse({ error: "A valid userId is required." }, 400);
      if (userId === user.id) return jsonResponse({ error: "You cannot suspend your own administrator account." }, 400);
      const { data: updatedAuth, error: updateError } = await adminClient.auth.admin.updateUserById(userId, {
        ban_duration: suspended ? "876000h" : "none",
      });
      if (updateError || !updatedAuth?.user) {
        return jsonResponse({ error: updateError?.message || "Unable to update account access." }, 400);
      }
      return jsonResponse({
        ok: true,
        suspended,
        bannedUntil: updatedAuth.user.banned_until || null,
      });
    }

    if (action === "list-records-demo-workspaces") {
      const { data, error } = await adminClient
        .from("records_demo_workspace_claims")
        .select("id,organization_id,code_last_four,recipient_email,status,expires_at,claimed_at,created_at,organizations(name,slug,owner_user_id)")
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) return jsonResponse({ error: error.message }, 400);

      const workspaces = (data || []).map((claim: any) => {
        const organization = Array.isArray(claim.organizations) ? claim.organizations[0] : claim.organizations;
        return {
          id: claim.id,
          organizationId: claim.organization_id,
          organizationName: organization?.name || "Demo workspace",
          slug: organization?.slug || "",
          codeLastFour: claim.code_last_four,
          recipientEmail: claim.recipient_email || "",
          status: claim.status,
          expiresAt: claim.expires_at,
          claimedAt: claim.claimed_at,
          createdAt: claim.created_at,
        };
      });
      return jsonResponse({ ok: true, workspaces, count: workspaces.length });
    }

    if (action === "create-records-demo-workspace") {
      const organizationName = textValue(payload.organizationName, 160);
      const recipientEmail = normalizeEmail(payload.recipientEmail);
      if (!organizationName) return jsonResponse({ error: "Enter an organization name." }, 400);
      if (recipientEmail && !isValidEmail(recipientEmail)) {
        return jsonResponse({ error: "Enter a valid recipient email or leave it blank." }, 400);
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const code = createDemoClaimCode();
      const codeHash = await sha256(normalizeDemoClaimCode(code));
      const { data: organization, error: organizationError } = await adminClient
        .from("organizations")
        .insert({
          name: organizationName,
          slug: createOrganizationSlug(organizationName),
          owner_user_id: user.id,
          subscription_tier: "organization",
          account_status: "trialing",
          document_limit: 10000,
          storage_limit_mb: 51200,
          user_limit: 15,
          public_embed_enabled: false,
          subscription_current_period_end: expiresAt,
        })
        .select("id,name,slug")
        .single();
      if (organizationError) return jsonResponse({ error: organizationError.message }, 400);

      const { error: membershipError } = await adminClient
        .from("organization_memberships")
        .insert({
          organization_id: organization.id,
          user_id: user.id,
          role: "account_admin",
          created_by: user.id,
        });
      if (membershipError) {
        await adminClient.from("organizations").delete().eq("id", organization.id);
        return jsonResponse({ error: membershipError.message }, 400);
      }

      const { data: claim, error: claimError } = await adminClient
        .from("records_demo_workspace_claims")
        .insert({
          organization_id: organization.id,
          code_hash: codeHash,
          code_last_four: code.slice(-4),
          recipient_email: recipientEmail || null,
          created_by_user_id: user.id,
          expires_at: expiresAt,
        })
        .select("id,status,expires_at,created_at")
        .single();
      if (claimError) {
        await adminClient.from("organizations").delete().eq("id", organization.id);
        return jsonResponse({ error: claimError.message }, 400);
      }

      return jsonResponse({
        ok: true,
        workspace: {
          id: claim.id,
          organizationId: organization.id,
          organizationName: organization.name,
          status: claim.status,
          expiresAt: claim.expires_at,
          createdAt: claim.created_at,
        },
        code,
        claimUrl: buildDemoClaimUrl(request, code, recipientEmail),
      });
    }

    if (action === "rotate-records-demo-claim-code") {
      const claimId = String(payload.claimId || "").trim();
      if (!isValidUuid(claimId)) return jsonResponse({ error: "A valid claimId is required." }, 400);
      const code = createDemoClaimCode();
      const codeHash = await sha256(normalizeDemoClaimCode(code));
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: claim, error } = await adminClient
        .from("records_demo_workspace_claims")
        .update({
          code_hash: codeHash,
          code_last_four: code.slice(-4),
          expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq("id", claimId)
        .eq("status", "pending")
        .select("id,recipient_email,expires_at")
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 400);
      if (!claim) return jsonResponse({ error: "Only a pending demo claim can be rotated." }, 400);
      return jsonResponse({
        ok: true,
        code,
        expiresAt: claim.expires_at,
        claimUrl: buildDemoClaimUrl(request, code, claim.recipient_email || ""),
      });
    }

    if (action === "revoke-records-demo-claim") {
      const claimId = String(payload.claimId || "").trim();
      if (!isValidUuid(claimId)) return jsonResponse({ error: "A valid claimId is required." }, 400);
      const now = new Date().toISOString();
      const { data: claim, error } = await adminClient
        .from("records_demo_workspace_claims")
        .update({ status: "revoked", revoked_at: now, updated_at: now })
        .eq("id", claimId)
        .eq("status", "pending")
        .select("id")
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 400);
      if (!claim) return jsonResponse({ error: "Only a pending demo claim can be revoked." }, 400);
      return jsonResponse({ ok: true });
    }

    if (action === "list-platform-billing") {
      const { billing } = await loadPlatformAccountData(adminClient);
      return jsonResponse({ ok: true, billing, count: billing.length });
    }

    if (action === "list-support-requests") {
      const { data, error } = await adminClient
        .from("platform_support_requests")
        .select("id, requester_user_id, requester_name, requester_email, organization_name, topic, subject, message, status, priority, assigned_to_user_id, internal_notes, source, email_message_id, created_at, updated_at, resolved_at")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true, requests: data || [], count: data?.length || 0 });
    }

    if (action === "update-support-request") {
      const requestId = String(payload.requestId || "").trim();
      const status = String(payload.status || "").trim().toLowerCase();
      const priority = String(payload.priority || "").trim().toLowerCase();
      const internalNotes = String(payload.internalNotes || "").trim().slice(0, 8000);
      if (!isValidUuid(requestId)) return jsonResponse({ error: "A valid requestId is required." }, 400);
      if (!["new", "in_progress", "waiting", "resolved", "closed"].includes(status)) {
        return jsonResponse({ error: "Invalid support status." }, 400);
      }
      if (!["low", "normal", "high", "urgent"].includes(priority)) {
        return jsonResponse({ error: "Invalid support priority." }, 400);
      }
      const now = new Date().toISOString();
      const { data, error } = await adminClient
        .from("platform_support_requests")
        .update({
          status,
          priority,
          internal_notes: internalNotes || null,
          assigned_to_user_id: user.id,
          resolved_at: ["resolved", "closed"].includes(status) ? now : null,
          updated_at: now,
        })
        .eq("id", requestId)
        .select("id, requester_name, requester_email, organization_name, topic, subject, message, status, priority, internal_notes, created_at, updated_at, resolved_at")
        .maybeSingle();
      if (error) return jsonResponse({ error: error.message }, 400);
      if (!data) return jsonResponse({ error: "Support request not found." }, 404);
      return jsonResponse({ ok: true, request: data });
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

    if (action === "create-existing-website-project") {
      const websiteId = String(payload.websiteId || "").trim();
      const clientUserId = String(payload.clientUserId || "").trim();
      const name = textValue(payload.name, 180);
      const status = String(payload.status || "active").trim().toLowerCase();
      const targetStartDate = String(payload.targetStartDate || "").trim() || null;
      const targetLaunchDate = String(payload.targetLaunchDate || "").trim() || null;
      const createProposal = Boolean(payload.createProposal);
      const openOnboarding = Boolean(payload.openOnboarding);
      const proposalTitle = textValue(payload.proposalTitle || `New work for ${name}`, 160);
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;

      if (!isValidUuid(websiteId)) return jsonResponse({ error: "A valid websiteId is required." }, 400);
      if (!isValidUuid(clientUserId)) return jsonResponse({ error: "Choose a valid client account." }, 400);
      if (!name) return jsonResponse({ error: "Enter a project name." }, 400);
      if (!["active", "pending", "on_hold"].includes(status)) {
        return jsonResponse({ error: "Project status must be active, pending, or on hold." }, 400);
      }
      if (targetStartDate && !datePattern.test(targetStartDate)) {
        return jsonResponse({ error: "Enter a valid target start date." }, 400);
      }
      if (targetLaunchDate && !datePattern.test(targetLaunchDate)) {
        return jsonResponse({ error: "Enter a valid target launch date." }, 400);
      }
      if (targetStartDate && targetLaunchDate && targetLaunchDate < targetStartDate) {
        return jsonResponse({ error: "The target launch date cannot be before the start date." }, 400);
      }

      const [{ data: website, error: websiteError }, { data: membership, error: membershipError }, { data: existingProject, error: projectLookupError }] = await Promise.all([
        adminClient.from("client_websites").select("id,name,live_url,status").eq("id", websiteId).maybeSingle(),
        adminClient.from("website_members").select("id,user_id,role,status").eq("website_id", websiteId).eq("user_id", clientUserId).eq("status", "active").maybeSingle(),
        adminClient.from("website_projects").select("id,name").eq("managed_website_id", websiteId).maybeSingle(),
      ]);
      if (websiteError || membershipError || projectLookupError) {
        return jsonResponse({ error: websiteError?.message || membershipError?.message || projectLookupError?.message || "Unable to validate this website." }, 400);
      }
      if (!website) return jsonResponse({ error: "Website not found." }, 404);
      if (!membership) return jsonResponse({ error: "The selected account must have active access to this website." }, 400);
      if (existingProject) {
        return jsonResponse({ error: `${existingProject.name} is already the project for this website.`, projectId: existingProject.id }, 409);
      }

      const { data: project, error: projectError } = await adminClient
        .from("website_projects")
        .insert({
          request_id: null,
          proposal_id: null,
          client_user_id: clientUserId,
          managed_website_id: websiteId,
          name,
          source: "existing_website",
          status,
          current_stage: "ongoing",
          progress_percent: 100,
          target_start_date: targetStartDate,
          target_launch_date: targetLaunchDate,
          client_summary: "This existing website is connected to N3XRA for ongoing work, files, proposals, and onboarding.",
          admin_next_step: "Use this workspace for future website work and ongoing management.",
          owner_admin_user_id: user.id,
          created_by_user_id: user.id,
        })
        .select("*")
        .single();
      if (projectError) return jsonResponse({ error: projectError.message }, 400);

      const { error: historicalMilestoneError } = await adminClient
        .from("website_project_milestones")
        .update({ status: "not_applicable" })
        .eq("project_id", project.id)
        .in("stage", ["agreement", "billing", "onboarding", "production", "client_review", "launch"]);
      if (historicalMilestoneError) {
        await adminClient.from("website_projects").delete().eq("id", project.id);
        return jsonResponse({ error: historicalMilestoneError.message }, 400);
      }
      const { error: ongoingMilestoneError } = await adminClient
        .from("website_project_milestones")
        .update({ status: "available", client_note: "The website is active and ready for ongoing N3XRA work." })
        .eq("project_id", project.id)
        .eq("stage", "ongoing");
      if (ongoingMilestoneError) {
        await adminClient.from("website_projects").delete().eq("id", project.id);
        return jsonResponse({ error: ongoingMilestoneError.message }, 400);
      }

      let proposal = null;
      let onboarding = null;
      const warnings: string[] = [];

      if (createProposal) {
        const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(clientUserId);
        const client = authData?.user;
        const clientEmail = normalizeEmail(client?.email);
        if (authError || !client || !isValidEmail(clientEmail)) {
          warnings.push("The project was created, but the proposal draft could not be created because the client account has no valid email.");
        } else {
          const clientName = textValue(client.user_metadata?.full_name || client.user_metadata?.name || clientEmail, 180);
          const { data: requestRow, error: requestError } = await adminClient
            .from("website_service_requests")
            .insert({
              user_id: clientUserId,
              contact_name: clientName,
              business_name: website.name,
              contact_email: clientEmail,
              project_type: "maintenance",
              existing_website_url: website.live_url || null,
              primary_goal: "Plan and price new work for this existing website.",
              status: "proposal_drafting",
              admin_notes: "Created by a platform admin from the existing website project.",
              reviewed_by_user_id: user.id,
              reviewed_at: new Date().toISOString(),
            })
            .select("id")
            .single();
          if (requestError) {
            warnings.push(`The project was created, but the proposal request could not be created: ${requestError.message}`);
          } else {
            const { data: proposalRow, error: proposalError } = await adminClient
              .from("website_proposals")
              .insert({
                request_id: requestRow.id,
                project_id: project.id,
                client_user_id: clientUserId,
                title: proposalTitle,
                status: "draft",
                created_by_user_id: user.id,
              })
              .select("id,request_id,project_id,title,status")
              .single();
            if (proposalError) {
              await adminClient.from("website_service_requests").delete().eq("id", requestRow.id);
              warnings.push(`The project was created, but the proposal draft could not be created: ${proposalError.message}`);
            } else {
              proposal = proposalRow;
            }
          }
        }
      }

      if (openOnboarding) {
        const { data: onboardingRow, error: onboardingError } = await adminClient
          .from("website_onboardings")
          .insert({
            project_id: project.id,
            request_id: null,
            proposal_id: null,
            client_user_id: clientUserId,
            status: "not_started",
            unlocked_by_user_id: user.id,
          })
          .select("id,project_id,status")
          .single();
        if (onboardingError) {
          warnings.push(`The project was created, but onboarding could not be opened: ${onboardingError.message}`);
        } else {
          onboarding = onboardingRow;
        }
      }

      return jsonResponse({ ok: true, project, proposal, onboarding, warnings });
    }

    if (action === "create-existing-website-proposal") {
      const projectId = String(payload.projectId || "").trim();
      const proposalTitle = textValue(payload.proposalTitle, 160);
      if (!isValidUuid(projectId)) return jsonResponse({ error: "A valid projectId is required." }, 400);
      if (!proposalTitle) return jsonResponse({ error: "Enter a proposal title." }, 400);

      const { data: project, error: projectError } = await adminClient
        .from("website_projects")
        .select("id,client_user_id,managed_website_id,name,source,client_websites(id,name,live_url)")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return jsonResponse({ error: projectError.message }, 400);
      if (!project || project.source !== "existing_website") return jsonResponse({ error: "Existing website project not found." }, 404);
      const website = Array.isArray(project.client_websites) ? project.client_websites[0] : project.client_websites;
      if (!website) return jsonResponse({ error: "This project is not linked to a managed website." }, 400);

      const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(project.client_user_id);
      const client = authData?.user;
      const clientEmail = normalizeEmail(client?.email);
      if (authError || !client || !isValidEmail(clientEmail)) {
        return jsonResponse({ error: "The project client account does not have a valid email." }, 400);
      }
      const clientName = textValue(client.user_metadata?.full_name || client.user_metadata?.name || clientEmail, 180);
      const { data: requestRow, error: requestError } = await adminClient
        .from("website_service_requests")
        .insert({
          user_id: project.client_user_id,
          contact_name: clientName,
          business_name: website.name,
          contact_email: clientEmail,
          project_type: "maintenance",
          existing_website_url: website.live_url || null,
          primary_goal: "Plan and price new work for this existing website.",
          status: "proposal_drafting",
          admin_notes: "Created by a platform admin from the existing website project.",
          reviewed_by_user_id: user.id,
          reviewed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (requestError) return jsonResponse({ error: requestError.message }, 400);

      const { data: proposal, error: proposalError } = await adminClient
        .from("website_proposals")
        .insert({
          request_id: requestRow.id,
          project_id: project.id,
          client_user_id: project.client_user_id,
          title: proposalTitle,
          status: "draft",
          created_by_user_id: user.id,
        })
        .select("id,request_id,project_id,title,status")
        .single();
      if (proposalError) {
        await adminClient.from("website_service_requests").delete().eq("id", requestRow.id);
        return jsonResponse({ error: proposalError.message }, 400);
      }
      return jsonResponse({ ok: true, proposal });
    }

    if (action === "open-existing-website-onboarding") {
      const projectId = String(payload.projectId || "").trim();
      if (!isValidUuid(projectId)) return jsonResponse({ error: "A valid projectId is required." }, 400);
      const { data: project, error: projectError } = await adminClient
        .from("website_projects")
        .select("id,client_user_id,source")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return jsonResponse({ error: projectError.message }, 400);
      if (!project || project.source !== "existing_website") return jsonResponse({ error: "Existing website project not found." }, 404);

      const { data: existing, error: existingError } = await adminClient
        .from("website_onboardings")
        .select("id,project_id,status")
        .eq("project_id", project.id)
        .maybeSingle();
      if (existingError) return jsonResponse({ error: existingError.message }, 400);
      if (existing) return jsonResponse({ ok: true, onboarding: existing, existing: true });

      const { data: onboarding, error } = await adminClient
        .from("website_onboardings")
        .insert({
          project_id: project.id,
          request_id: null,
          proposal_id: null,
          client_user_id: project.client_user_id,
          status: "not_started",
          unlocked_by_user_id: user.id,
        })
        .select("id,project_id,status")
        .single();
      if (error) return jsonResponse({ error: error.message }, 400);
      return jsonResponse({ ok: true, onboarding });
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

      const { data: adminWorkspace, error: workspaceError } = await adminClient
        .from("organizations")
        .select("id")
        .eq("slug", ADMIN_RECORDS_WORKSPACE_SLUG)
        .maybeSingle();
      if (workspaceError) return jsonResponse({ error: workspaceError.message }, 400);
      if (adminWorkspace?.id) {
        const { error: membershipError } = await adminClient
          .from("organization_memberships")
          .delete()
          .eq("organization_id", adminWorkspace.id)
          .eq("user_id", userId);
        if (membershipError) return jsonResponse({ error: membershipError.message }, 400);
      }

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
      const product = normalizeProduct(payload.product);
      const productLabel = PRODUCT_LABELS[product];
      const channel = String(payload.channel || "email").trim().toLowerCase();
      const subject = textValue(payload.subject, 180);
      const preheader = textValue(payload.preheader, 220);
      const message = String(payload.message || "").trim().slice(0, 8000);
      const ctaUrl = String(payload.ctaUrl || "").trim().slice(0, 900);
      const ctaLabel = textValue(payload.ctaLabel || "Open N3XRA", 80);
      const rawEmails = Array.isArray(payload.recipientEmails) ? payload.recipientEmails : [];
      const recipientEmails = Array.from(new Set(rawEmails.map(normalizeEmail).filter(Boolean))).slice(0, 500);

      if (!["email", "sms", "both"].includes(channel)) {
        return jsonResponse({ error: "channel must be email, sms, or both." }, 400);
      }
      if (["email", "both"].includes(channel) && !subject) {
        return jsonResponse({ error: "subject is required for email delivery." }, 400);
      }
      if (!message || !recipientEmails.length) {
        return jsonResponse({ error: "message and recipientEmails are required." }, 400);
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

      const sent: Array<{ email: string; id: string | null; channel: string }> = [];
      const failed: Array<{ email: string; error: string }> = [];

      if (["email", "both"].includes(channel)) {
        const resendApiKey = Deno.env.get("RESEND_API_KEY");
        if (!resendApiKey) return jsonResponse({ error: "RESEND_API_KEY is missing." }, 500);
        const html = buildNotificationHtml({ productLabel, subject, preheader, message, ctaUrl, ctaLabel });
        const text = buildNotificationText({ productLabel, message, ctaUrl, ctaLabel });
        const fromEmail = Deno.env.get("PLATFORM_UPDATE_FROM_EMAIL") || "N3XRA <updates@n3xra.com>";
        for (const email of recipientEmails) {
          const emailResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ from: fromEmail, to: [email], subject, html, text, reply_to: user.email }),
          });
          const emailPayload = await emailResponse.json().catch(() => ({}));
          if (emailResponse.ok) sent.push({ email, id: typeof emailPayload?.id === "string" ? emailPayload.id : null, channel: "email" });
          else failed.push({ email, error: String(emailPayload?.message || emailPayload?.error || "Update email failed to send.") });
        }
      }

      if (["sms", "both"].includes(channel)) {
        const accountSid = String(Deno.env.get("TWILIO_ACCOUNT_SID") || "").trim();
        const authToken = String(Deno.env.get("TWILIO_AUTH_TOKEN") || "").trim();
        const fromPhone = normalizePhone(Deno.env.get("TWILIO_RECEPTIONIST_NUMBER") || "+15416526840");
        if (!accountSid || !authToken || !fromPhone) return jsonResponse({ error: "Twilio messaging is not configured." }, 500);
        const recipientByEmail = new Map(allowedRecipients.map((recipient) => [normalizeEmail(recipient.email), recipient]));
        const smsBody = buildNotificationSms({ productLabel, message, ctaUrl, ctaLabel });
        for (const email of recipientEmails) {
          const recipient = recipientByEmail.get(email);
          const phone = normalizePhone(recipient?.phone);
          if (!phone || recipient?.smsOptedIn !== true) {
            failed.push({ email, error: "Text skipped because this account has no active SMS consent." });
            continue;
          }
          const form = new URLSearchParams({ From: fromPhone, To: phone, Body: smsBody });
          const smsResponse = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
            method: "POST",
            headers: {
              Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: form.toString(),
          });
          const smsPayload = await smsResponse.json().catch(() => ({}));
          if (smsResponse.ok) sent.push({ email, id: typeof smsPayload?.sid === "string" ? smsPayload.sid : null, channel: "sms" });
          else failed.push({ email, error: String(smsPayload?.message || "Text message failed to send.") });
        }
      }

      return jsonResponse({
        ok: failed.length === 0,
        sent,
        failed,
        sentCount: sent.length,
        emailSentCount: sent.filter((item) => item.channel === "email").length,
        smsSentCount: sent.filter((item) => item.channel === "sms").length,
        failedCount: failed.length,
      }, sent.length ? 200 : 400);
    }

    return jsonResponse({ error: "Unsupported platform-admin action." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected platform-admin error.";
    return jsonResponse({ error: message }, 500);
  }
});
