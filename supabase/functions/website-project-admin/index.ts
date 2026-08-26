import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function respond(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function text(value: unknown, limit = 1000) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function email(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function githubRepositoryName(value: unknown) {
  return text(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 100);
}

function bytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function derLength(length: number) {
  if (length < 128) return new Uint8Array([length]);
  const encoded: number[] = [];
  let remaining = length;
  while (remaining > 0) {
    encoded.unshift(remaining & 0xff);
    remaining >>>= 8;
  }
  return new Uint8Array([0x80 | encoded.length, ...encoded]);
}

function der(tag: number, value: Uint8Array) {
  return bytes(new Uint8Array([tag]), derLength(value.length), value);
}

function pemBytes(pem: string) {
  const encoded = pem.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const binary = atob(encoded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function githubPrivateKey(pem: string) {
  const keyBytes = pemBytes(pem);
  if (!pem.includes("BEGIN RSA PRIVATE KEY")) return keyBytes;
  const version = new Uint8Array([0x02, 0x01, 0x00]);
  const rsaEncryptionAlgorithm = new Uint8Array([
    0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
  ]);
  return der(0x30, bytes(version, rsaEncryptionAlgorithm, der(0x04, keyBytes)));
}

function base64Url(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  input.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

async function githubAppJwt(clientId: string, privateKey: string) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: clientId }));
  const signingInput = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    githubPrivateKey(privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

interface GitHubConfiguration {
  clientId: string;
  privateKey: string;
  installationId: string;
  organization: string;
  templateOwner: string;
  templateRepository: string;
  apiVersion: string;
}

function githubConfiguration(): GitHubConfiguration {
  const configuration = {
    clientId: text(Deno.env.get("GITHUB_APP_CLIENT_ID") || Deno.env.get("GITHUB_APP_ID"), 200),
    privateKey: String(Deno.env.get("GITHUB_APP_PRIVATE_KEY") || "").replace(/\\n/g, "\n").trim(),
    installationId: text(Deno.env.get("GITHUB_APP_INSTALLATION_ID"), 100),
    organization: text(Deno.env.get("GITHUB_ORGANIZATION"), 100),
    templateOwner: text(Deno.env.get("GITHUB_TEMPLATE_OWNER"), 100),
    templateRepository: text(Deno.env.get("GITHUB_TEMPLATE_REPOSITORY"), 100),
    apiVersion: text(Deno.env.get("GITHUB_API_VERSION") || "2026-03-10", 20),
  };
  if (!configuration.clientId || !configuration.privateKey || !configuration.installationId
    || !configuration.organization || !configuration.templateOwner || !configuration.templateRepository) {
    throw new Error("GitHub App provisioning is not configured.");
  }
  const githubName = /^[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,99})$/;
  if (!/^\d+$/.test(configuration.installationId)
    || !githubName.test(configuration.organization)
    || !githubName.test(configuration.templateOwner)
    || !githubName.test(configuration.templateRepository)) {
    throw new Error("GitHub App provisioning configuration is invalid.");
  }
  return configuration;
}

async function githubRequest(
  configuration: GitHubConfiguration,
  path: string,
  token: string,
  options: RequestInit = {},
) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "N3XRA-Website-Provisioning/1.0",
      "X-GitHub-Api-Version": configuration.apiVersion,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function githubInstallationToken(configuration: GitHubConfiguration) {
  const jwt = await githubAppJwt(configuration.clientId, configuration.privateKey);
  const { response, data } = await githubRequest(
    configuration,
    `/app/installations/${encodeURIComponent(configuration.installationId)}/access_tokens`,
    jwt,
    {
      method: "POST",
      body: JSON.stringify({ permissions: { administration: "write", contents: "read" } }),
    },
  );
  if (!response.ok || !data?.token) {
    throw new Error(`GitHub App authentication failed${data?.message ? `: ${text(data.message, 300)}` : "."}`);
  }
  return String(data.token);
}

interface VercelConfiguration {
  accessToken: string;
  teamId: string;
  teamSlug: string;
}

function vercelConfiguration(): VercelConfiguration {
  const configuration = {
    accessToken: String(Deno.env.get("VERCEL_ACCESS_TOKEN") || "").trim(),
    teamId: text(Deno.env.get("VERCEL_TEAM_ID"), 200),
    teamSlug: text(Deno.env.get("VERCEL_TEAM_SLUG"), 100),
  };
  if (!configuration.accessToken || !configuration.teamId || !configuration.teamSlug) {
    throw new Error("Vercel provisioning is not configured.");
  }
  if (!/^team_[A-Za-z0-9]+$/.test(configuration.teamId)
    || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(configuration.teamSlug)) {
    throw new Error("Vercel provisioning configuration is invalid.");
  }
  return configuration;
}

async function vercelRequest(
  configuration: VercelConfiguration,
  path: string,
  options: RequestInit = {},
) {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`https://api.vercel.com${path}${separator}teamId=${encodeURIComponent(configuration.teamId)}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${configuration.accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "N3XRA-Website-Provisioning/1.0",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForVercelDeployment(
  configuration: VercelConfiguration,
  deploymentId: string,
) {
  let deployment: Record<string, any> = {};
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await vercelRequest(
      configuration,
      `/v13/deployments/${encodeURIComponent(deploymentId)}`,
    );
    if (!result.response.ok) {
      throw new Error(`Vercel could not read the preview deployment${result.data?.error?.message ? `: ${text(result.data.error.message, 300)}` : "."}`);
    }
    deployment = result.data;
    const state = text(deployment.readyState || deployment.status, 40).toUpperCase();
    if (state === "READY") return deployment;
    if (["ERROR", "CANCELED"].includes(state)) {
      throw new Error(`Vercel preview deployment ${state.toLowerCase()}.`);
    }
    await wait(2500);
  }
  throw new Error("Vercel preview deployment did not become ready before the setup timeout.");
}

function brandColor(value: unknown, fallback: string) {
  const candidate = text(value, 7);
  return /^#[0-9a-f]{6}$/i.test(candidate) ? candidate : fallback;
}

function brandFont(value: unknown, fallback: string) {
  const candidate = text(value, 80);
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}$/.test(candidate) ? candidate : fallback;
}

function publicHttpsUrl(value: unknown) {
  const candidate = text(value, 1000);
  try {
    const url = new URL(candidate);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

async function websitePreviewEnvironment(
  adminClient: ReturnType<typeof createClient>,
  website: Record<string, any>,
) {
  const { data: branding, error: brandingError } = await adminClient
    .from("website_portal_branding")
    .select("logo_asset_id,primary_color,accent_color,heading_font,body_font")
    .eq("website_id", website.id)
    .maybeSingle();
  if (brandingError) throw new Error(`Unable to read approved website branding: ${brandingError.message}`);

  let logoUrl = "";
  if (branding?.logo_asset_id) {
    const { data: logoAsset, error: assetError } = await adminClient
      .from("website_assets")
      .select("id,current_version_id,status")
      .eq("id", branding.logo_asset_id)
      .eq("website_id", website.id)
      .maybeSingle();
    if (assetError) throw new Error(`Unable to read the approved website logo: ${assetError.message}`);

    if (logoAsset?.status === "active" && logoAsset.current_version_id) {
      const { data: logoVersion, error: versionError } = await adminClient
        .from("website_asset_versions")
        .select("public_url,storage_bucket,status")
        .eq("id", logoAsset.current_version_id)
        .eq("asset_id", logoAsset.id)
        .maybeSingle();
      if (versionError) throw new Error(`Unable to read the approved website logo version: ${versionError.message}`);
      if (logoVersion?.status === "published" && logoVersion.storage_bucket === "website-assets-public") {
        logoUrl = publicHttpsUrl(logoVersion.public_url);
      }
    }
  }

  const portalSlug = text(website.portal_slug, 100).toLowerCase();
  const portalUrl = website.portal_enabled && /^[a-z0-9](?:[a-z0-9-]{0,98}[a-z0-9])?$/.test(portalSlug)
    ? `https://${portalSlug}.portal.n3xra.com/`
    : "";

  return {
    PUBLIC_N3XRA_SITE_NAME: text(website.name, 180) || "Your new website",
    PUBLIC_N3XRA_LOGO_URL: logoUrl,
    PUBLIC_N3XRA_PRIMARY_COLOR: brandColor(branding?.primary_color, "#17231b"),
    PUBLIC_N3XRA_ACCENT_COLOR: brandColor(branding?.accent_color, "#b77946"),
    PUBLIC_N3XRA_HEADING_FONT: brandFont(branding?.heading_font, "Fraunces"),
    PUBLIC_N3XRA_BODY_FONT: brandFont(branding?.body_font, "Manrope"),
    PUBLIC_N3XRA_PORTAL_URL: portalUrl,
  };
}

async function configureVercelPreviewEnvironment(
  configuration: VercelConfiguration,
  projectId: string,
  customEnvironmentId: string,
  environment: Record<string, string>,
) {
  const result = await vercelRequest(
    configuration,
    `/v10/projects/${encodeURIComponent(projectId)}/env?upsert=true`,
    {
      method: "POST",
      body: JSON.stringify(Object.entries(environment).map(([key, value]) => ({
        key,
        value,
        type: "encrypted",
        target: ["preview"],
        customEnvironmentIds: [customEnvironmentId],
      }))),
    },
  );
  if (!result.response.ok) {
    throw new Error(`Vercel could not configure the personalized preview${result.data?.error?.message ? `: ${text(result.data.error.message, 300)}` : "."}`);
  }
}

async function ensureVercelStagingEnvironment(
  configuration: VercelConfiguration,
  projectId: string,
) {
  const path = `/v9/projects/${encodeURIComponent(projectId)}/custom-environments`;
  const existingResult = await vercelRequest(configuration, path);
  if (!existingResult.response.ok) {
    throw new Error(`Vercel could not read the staging environment${existingResult.data?.error?.message ? `: ${text(existingResult.data.error.message, 300)}` : "."}`);
  }
  const environments = Array.isArray(existingResult.data?.environments)
    ? existingResult.data.environments
    : Array.isArray(existingResult.data)
      ? existingResult.data
      : [];
  let staging = environments.find((environment: Record<string, any>) => environment.slug === "staging") || null;
  if (!staging) {
    const createdResult = await vercelRequest(configuration, path, {
      method: "POST",
      body: JSON.stringify({
        slug: "staging",
        description: "N3XRA managed website review environment",
        copyEnvVarsFrom: "preview",
      }),
    });
    if (!createdResult.response.ok) {
      throw new Error(`Vercel could not create the staging environment${createdResult.data?.error?.message ? `: ${text(createdResult.data.error.message, 300)}` : "."}`);
    }
    staging = createdResult.data;
  }
  if (!staging?.id || staging.slug !== "staging") {
    throw new Error("Vercel returned an invalid staging environment.");
  }
  return staging;
}

async function createProposal(
  adminClient: ReturnType<typeof createClient>,
  project: Record<string, any>,
  website: Record<string, any>,
  adminUserId: string,
  title: string,
) {
  const { data: authData, error: authError } = await adminClient.auth.admin.getUserById(project.client_user_id);
  const client = authData?.user;
  const clientEmail = email(client?.email);
  if (authError || !client || !isEmail(clientEmail)) {
    throw new Error("The project client account does not have a valid email.");
  }

  const clientName = text(client.user_metadata?.full_name || client.user_metadata?.name || clientEmail, 180);
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
      reviewed_by_user_id: adminUserId,
      reviewed_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (requestError) throw new Error(requestError.message);

  const { data: proposal, error: proposalError } = await adminClient
    .from("website_proposals")
    .insert({
      request_id: requestRow.id,
      project_id: project.id,
      client_user_id: project.client_user_id,
      title,
      status: "draft",
      created_by_user_id: adminUserId,
    })
    .select("id,request_id,project_id,title,status")
    .single();
  if (proposalError) {
    await adminClient.from("website_service_requests").delete().eq("id", requestRow.id);
    throw new Error(proposalError.message);
  }
  return proposal;
}

async function openOnboarding(
  adminClient: ReturnType<typeof createClient>,
  project: Record<string, any>,
  adminUserId: string,
) {
  const { data: existing, error: existingError } = await adminClient
    .from("website_onboardings")
    .select("id,project_id,status")
    .eq("project_id", project.id)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);
  if (existing) return { ...existing, existing: true };

  const { data: onboarding, error } = await adminClient
    .from("website_onboardings")
    .insert({
      project_id: project.id,
      request_id: null,
      proposal_id: null,
      client_user_id: project.client_user_id,
      status: "not_started",
      unlocked_by_user_id: adminUserId,
    })
    .select("id,project_id,status")
    .single();
  if (error) throw new Error(error.message);
  return onboarding;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return respond({ error: "Supabase environment variables are missing." }, 500);
    }

    const authHeader = request.headers.get("Authorization");
    if (!authHeader) return respond({ error: "Missing Authorization header." }, 401);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData?.user;
    if (userError || !user) return respond({ error: userError?.message || "Unable to resolve user." }, 401);

    const { data: platformAdmin, error: adminError } = await adminClient
      .from("platform_admins")
      .select("user_id,role,status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();
    if (adminError) return respond({ error: adminError.message }, 400);
    if (!platformAdmin) return respond({ error: "Platform admin access required." }, 403);

    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "");

    if (action === "create-direct-website-project") {
      const websiteId = String(payload.websiteId || "").trim();
      const name = text(payload.name, 180);
      if (!isUuid(websiteId)) return respond({ error: "A valid websiteId is required." }, 400);
      if (!name) return respond({ error: "Enter a project name." }, 400);

      const [websiteResult, projectResult] = await Promise.all([
        adminClient
          .from("client_websites")
          .select("id,name,organization_id,organizations(owner_user_id)")
          .eq("id", websiteId)
          .maybeSingle(),
        adminClient
          .from("website_projects")
          .select("*")
          .eq("managed_website_id", websiteId)
          .maybeSingle(),
      ]);
      const lookupError = websiteResult.error || projectResult.error;
      if (lookupError) return respond({ error: lookupError.message }, 400);
      if (!websiteResult.data) return respond({ error: "Website not found." }, 404);
      if (projectResult.data) {
        return respond({ ok: true, project: projectResult.data, message: "The website build workspace is already ready." });
      }

      const organization = Array.isArray(websiteResult.data.organizations)
        ? websiteResult.data.organizations[0]
        : websiteResult.data.organizations;
      const { data: project, error: insertError } = await adminClient
        .from("website_projects")
        .insert({
          request_id: null,
          proposal_id: null,
          client_user_id: organization?.owner_user_id || null,
          managed_website_id: websiteId,
          name,
          source: "existing_website",
          status: "active",
          current_stage: "production",
          progress_percent: 0,
          client_summary: "This website build started directly in N3XRA. Client access, proposals, onboarding, and billing can be added later.",
          admin_next_step: "Create the private GitHub repository and Vercel preview, then begin the website build.",
          owner_admin_user_id: user.id,
          created_by_user_id: user.id,
        })
        .select("*")
        .single();
      if (insertError) return respond({ error: insertError.message }, 400);

      const { error: skippedError } = await adminClient
        .from("website_project_milestones")
        .update({ status: "not_applicable" })
        .eq("project_id", project.id)
        .in("stage", ["agreement", "billing", "onboarding"]);
      const { error: buildError } = skippedError ? { error: null } : await adminClient
        .from("website_project_milestones")
        .update({ status: "available", client_note: "The build workspace is ready for repository and preview setup." })
        .eq("project_id", project.id)
        .eq("stage", "production");
      if (skippedError || buildError) {
        await adminClient.from("website_projects").delete().eq("id", project.id);
        return respond({ error: skippedError?.message || buildError?.message || "Unable to initialize the build workspace." }, 400);
      }

      return respond({ ok: true, project, message: "Website build workspace ready." });
    }

    if (action === "create-existing-website-project") {
      const websiteId = String(payload.websiteId || "").trim();
      const clientUserId = String(payload.clientUserId || "").trim();
      const name = text(payload.name, 180);
      const status = String(payload.status || "active").trim().toLowerCase();
      const targetStartDate = String(payload.targetStartDate || "").trim() || null;
      const targetLaunchDate = String(payload.targetLaunchDate || "").trim() || null;
      const datePattern = /^\d{4}-\d{2}-\d{2}$/;

      if (!isUuid(websiteId)) return respond({ error: "A valid websiteId is required." }, 400);
      if (!isUuid(clientUserId)) return respond({ error: "Choose a valid client account." }, 400);
      if (!name) return respond({ error: "Enter a project name." }, 400);
      if (!["active", "pending", "on_hold"].includes(status)) {
        return respond({ error: "Project status must be active, pending, or on hold." }, 400);
      }
      if (targetStartDate && !datePattern.test(targetStartDate)) {
        return respond({ error: "Enter a valid target start date." }, 400);
      }
      if (targetLaunchDate && !datePattern.test(targetLaunchDate)) {
        return respond({ error: "Enter a valid target launch date." }, 400);
      }
      if (targetStartDate && targetLaunchDate && targetLaunchDate < targetStartDate) {
        return respond({ error: "The target launch date cannot be before the start date." }, 400);
      }

      const [websiteResult, membershipResult, projectResult] = await Promise.all([
        adminClient.from("client_websites").select("id,name,live_url,status").eq("id", websiteId).maybeSingle(),
        adminClient.from("website_members").select("id,user_id,role,status").eq("website_id", websiteId).eq("user_id", clientUserId).eq("status", "active").maybeSingle(),
        adminClient.from("website_projects").select("id,name").eq("managed_website_id", websiteId).maybeSingle(),
      ]);
      const lookupError = websiteResult.error || membershipResult.error || projectResult.error;
      if (lookupError) return respond({ error: lookupError.message }, 400);
      if (!websiteResult.data) return respond({ error: "Website not found." }, 404);
      if (!membershipResult.data) {
        return respond({ error: "The selected account must have active access to this website." }, 400);
      }
      if (projectResult.data) {
        return respond({
          error: `${projectResult.data.name} is already the project for this website.`,
          projectId: projectResult.data.id,
        }, 409);
      }

      const { data: project, error: insertError } = await adminClient
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
      if (insertError) return respond({ error: insertError.message }, 400);

      const { error: historicalError } = await adminClient
        .from("website_project_milestones")
        .update({ status: "not_applicable" })
        .eq("project_id", project.id)
        .in("stage", ["agreement", "billing", "onboarding", "production", "client_review", "launch"]);
      const { error: ongoingError } = historicalError ? { error: null } : await adminClient
        .from("website_project_milestones")
        .update({ status: "available", client_note: "The website is active and ready for ongoing N3XRA work." })
        .eq("project_id", project.id)
        .eq("stage", "ongoing");
      if (historicalError || ongoingError) {
        await adminClient.from("website_projects").delete().eq("id", project.id);
        return respond({ error: historicalError?.message || ongoingError?.message || "Unable to initialize project progress." }, 400);
      }

      let proposal = null;
      let onboarding = null;
      const warnings: string[] = [];
      if (payload.createProposal) {
        try {
          proposal = await createProposal(
            adminClient,
            project,
            websiteResult.data,
            user.id,
            text(payload.proposalTitle || `New work for ${name}`, 160),
          );
        } catch (error) {
          warnings.push(`The project was created, but the proposal draft could not be created: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
      if (payload.openOnboarding) {
        try {
          onboarding = await openOnboarding(adminClient, project, user.id);
        } catch (error) {
          warnings.push(`The project was created, but onboarding could not be opened: ${error instanceof Error ? error.message : "Unknown error"}`);
        }
      }
      return respond({ ok: true, project, proposal, onboarding, warnings });
    }

    if (action === "create-existing-website-proposal") {
      const projectId = String(payload.projectId || "").trim();
      const proposalTitle = text(payload.proposalTitle, 160);
      if (!isUuid(projectId)) return respond({ error: "A valid projectId is required." }, 400);
      if (!proposalTitle) return respond({ error: "Enter a proposal title." }, 400);

      const { data: project, error } = await adminClient
        .from("website_projects")
        .select("id,client_user_id,managed_website_id,name,source,client_websites(id,name,live_url)")
        .eq("id", projectId)
        .maybeSingle();
      if (error) return respond({ error: error.message }, 400);
      if (!project || project.source !== "existing_website") return respond({ error: "Existing website project not found." }, 404);
      if (!project.client_user_id) return respond({ error: "Connect a client account before creating a proposal." }, 400);
      const website = Array.isArray(project.client_websites) ? project.client_websites[0] : project.client_websites;
      if (!website) return respond({ error: "This project is not linked to a managed website." }, 400);

      try {
        const proposal = await createProposal(adminClient, project, website, user.id, proposalTitle);
        return respond({ ok: true, proposal });
      } catch (proposalError) {
        return respond({ error: proposalError instanceof Error ? proposalError.message : "Unable to create proposal." }, 400);
      }
    }

    if (action === "open-existing-website-onboarding") {
      const projectId = String(payload.projectId || "").trim();
      if (!isUuid(projectId)) return respond({ error: "A valid projectId is required." }, 400);
      const { data: project, error } = await adminClient
        .from("website_projects")
        .select("id,client_user_id,source")
        .eq("id", projectId)
        .maybeSingle();
      if (error) return respond({ error: error.message }, 400);
      if (!project || project.source !== "existing_website") return respond({ error: "Existing website project not found." }, 404);
      if (!project.client_user_id) return respond({ error: "Connect a client account before opening onboarding." }, 400);

      try {
        const onboarding = await openOnboarding(adminClient, project, user.id);
        return respond({ ok: true, onboarding });
      } catch (onboardingError) {
        return respond({ error: onboardingError instanceof Error ? onboardingError.message : "Unable to open onboarding." }, 400);
      }
    }

    if (action === "provision-website-github") {
      const projectId = String(payload.projectId || "").trim();
      if (!isUuid(projectId)) return respond({ error: "A valid projectId is required." }, 400);

      const { data: project, error: projectError } = await adminClient
        .from("website_projects")
        .select("id,name,managed_website_id,client_websites(id,name,slug,organization_id,repository_full_name,portal_enabled,portal_slug)")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return respond({ error: projectError.message }, 400);
      if (!project) return respond({ error: "Website project not found." }, 404);
      const website = Array.isArray(project.client_websites) ? project.client_websites[0] : project.client_websites;
      const targetRepositoryName = githubRepositoryName(
        website?.repository_full_name?.split("/").pop() || website?.slug || website?.name || project.name,
      );
      if (!targetRepositoryName) return respond({ error: "The website needs a valid repository name before provisioning." }, 400);

      const { data: claimed, error: claimError } = await adminClient.rpc("claim_website_github_provisioning", {
        input_project_id: project.id,
        input_actor_user_id: user.id,
        input_target_repository_name: targetRepositoryName,
      });
      if (claimError) return respond({ error: claimError.message }, 400);
      if (!claimed?.acquired) {
        return respond({
          ok: true,
          provisioning: claimed,
          message: claimed?.status === "github_ready"
            ? "The private GitHub repository is already ready."
            : "Repository provisioning is already in progress.",
        }, claimed?.status === "github_ready" ? 200 : 202);
      }

      const runId = String(claimed.id || "");
      const leaseToken = String(claimed.lease_token || "");
      try {
        const configuration = githubConfiguration();
        const expectedFullName = `${configuration.organization}/${targetRepositoryName}`;
        if (website?.repository_full_name && website.repository_full_name !== expectedFullName) {
          throw new Error(`This website already records a different repository: ${website.repository_full_name}.`);
        }

        const installationToken = await githubInstallationToken(configuration);
        const repositoryPath = `/repos/${encodeURIComponent(configuration.organization)}/${encodeURIComponent(targetRepositoryName)}`;
        const existingResult = await githubRequest(configuration, repositoryPath, installationToken);
        let repository = null;

        if (existingResult.response.ok) {
          const isRetryRecovery = Number(claimed.attempt_count || 0) > 1
            || website?.repository_full_name === expectedFullName;
          if (!isRetryRecovery) {
            throw new Error(`The GitHub repository ${expectedFullName} already exists and was not created by this provisioning run.`);
          }
          repository = existingResult.data;
        } else if (existingResult.response.status === 404) {
          const generatedResult = await githubRequest(
            configuration,
            `/repos/${encodeURIComponent(configuration.templateOwner)}/${encodeURIComponent(configuration.templateRepository)}/generate`,
            installationToken,
            {
              method: "POST",
              body: JSON.stringify({
                owner: configuration.organization,
                name: targetRepositoryName,
                description: `Private website source for ${text(website?.name || project.name, 180)}`,
                include_all_branches: false,
                private: true,
              }),
            },
          );
          if (!generatedResult.response.ok) {
            throw new Error(`GitHub could not create the repository${generatedResult.data?.message ? `: ${text(generatedResult.data.message, 300)}` : "."}`);
          }
          repository = generatedResult.data;
        } else {
          throw new Error(`GitHub could not check the repository name${existingResult.data?.message ? `: ${text(existingResult.data.message, 300)}` : "."}`);
        }

        if (!repository?.id || repository?.full_name !== expectedFullName || repository?.private !== true
          || !text(repository?.default_branch, 255)
          || !String(repository?.html_url || "").startsWith("https://github.com/")) {
          throw new Error("GitHub returned repository details that did not match the requested private workspace.");
        }

        const { data: completed, error: finishError } = await adminClient.rpc("finish_website_github_provisioning", {
          input_run_id: runId,
          input_lease_token: leaseToken,
          input_succeeded: true,
          input_repository_provider_id: repository.id,
          input_repository_full_name: repository.full_name,
          input_repository_url: repository.html_url,
          input_repository_default_branch: repository.default_branch,
        });
        if (finishError) throw new Error(finishError.message);
        return respond({ ok: true, provisioning: completed, message: "Private GitHub repository ready." });
      } catch (provisioningError) {
        const message = provisioningError instanceof Error ? provisioningError.message : "GitHub repository provisioning failed.";
        const { error: failureError } = await adminClient.rpc("finish_website_github_provisioning", {
          input_run_id: runId,
          input_lease_token: leaseToken,
          input_succeeded: false,
          input_repository_provider_id: null,
          input_repository_full_name: null,
          input_repository_url: null,
          input_repository_default_branch: null,
        });
        if (failureError) console.error("Unable to record GitHub provisioning failure:", failureError.message);
        console.error("Website GitHub provisioning failed:", message);
        return respond({ error: message }, 502);
      }
    }

    if (action === "provision-website-vercel") {
      const projectId = String(payload.projectId || "").trim();
      if (!isUuid(projectId)) return respond({ error: "A valid projectId is required." }, 400);

      const { data: project, error: projectError } = await adminClient
        .from("website_projects")
        .select("id,name,managed_website_id,client_websites(id,name,slug,organization_id,repository_full_name)")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return respond({ error: projectError.message }, 400);
      if (!project) return respond({ error: "Website project not found." }, 404);
      const website = Array.isArray(project.client_websites) ? project.client_websites[0] : project.client_websites;
      if (!website?.repository_full_name) {
        return respond({ error: "Create the private GitHub repository before provisioning Vercel." }, 400);
      }
      const targetProjectName = githubRepositoryName(
        website.repository_full_name.split("/").pop() || website.slug || website.name || project.name,
      );
      if (!targetProjectName) return respond({ error: "The website needs a valid Vercel project name." }, 400);

      const { data: claimed, error: claimError } = await adminClient.rpc("claim_website_vercel_provisioning", {
        input_project_id: project.id,
        input_actor_user_id: user.id,
        input_target_project_name: targetProjectName,
      });
      if (claimError) return respond({ error: claimError.message }, 400);
      if (!claimed?.acquired) {
        return respond({
          ok: true,
          provisioning: claimed,
          message: claimed?.status === "vercel_ready"
            ? "The Vercel preview is already ready."
            : "Vercel preview setup is already in progress.",
        }, claimed?.status === "vercel_ready" ? 200 : 202);
      }

      const runId = String(claimed.id || "");
      const leaseToken = String(claimed.vercel_lease_token || "");
      try {
        const configuration = vercelConfiguration();
        const projectPath = `/v9/projects/${encodeURIComponent(targetProjectName)}`;
        const existingResult = await vercelRequest(configuration, projectPath);
        let vercelProject: Record<string, any> | null = null;

        if (existingResult.response.ok) {
          const isRetryRecovery = Number(claimed.vercel_attempt_count || 0) > 1
            || claimed.vercel_project_id === existingResult.data?.id;
          if (!isRetryRecovery) {
            throw new Error(`The Vercel project ${targetProjectName} already exists and is not recorded for this website.`);
          }
          vercelProject = existingResult.data;
        } else if (existingResult.response.status === 404) {
          const createdResult = await vercelRequest(configuration, "/v11/projects", {
            method: "POST",
            body: JSON.stringify({
              name: targetProjectName,
              gitRepository: {
                type: "github",
                repo: website.repository_full_name,
              },
            }),
          });
          if (!createdResult.response.ok) {
            throw new Error(`Vercel could not create the project${createdResult.data?.error?.message ? `: ${text(createdResult.data.error.message, 300)}` : "."}`);
          }
          vercelProject = createdResult.data;
        } else {
          throw new Error(`Vercel could not check the project name${existingResult.data?.error?.message ? `: ${text(existingResult.data.error.message, 300)}` : "."}`);
        }

        if (!vercelProject?.id || vercelProject?.name !== targetProjectName) {
          throw new Error("Vercel returned project details that did not match the requested website workspace.");
        }

        const stagingEnvironment = await ensureVercelStagingEnvironment(configuration, String(vercelProject.id));
        const previewEnvironment = await websitePreviewEnvironment(adminClient, website);
        await configureVercelPreviewEnvironment(configuration, String(vercelProject.id), String(stagingEnvironment.id), previewEnvironment);

        const deploymentResult = await vercelRequest(configuration, "/v13/deployments?forceNew=1", {
          method: "POST",
          body: JSON.stringify({
            name: targetProjectName,
            project: vercelProject.id,
            target: "staging",
            projectSettings: {
              framework: "astro",
              installCommand: "npm install",
              buildCommand: "npm run build",
              outputDirectory: "dist",
            },
            gitSource: {
              type: "github",
              repoId: claimed.repository_provider_id,
              ref: claimed.repository_default_branch || "main",
            },
          }),
        });
        if (!deploymentResult.response.ok || !deploymentResult.data?.id) {
          throw new Error(`Vercel could not start the preview deployment${deploymentResult.data?.error?.message ? `: ${text(deploymentResult.data.error.message, 300)}` : "."}`);
        }

        const deployment = await waitForVercelDeployment(configuration, String(deploymentResult.data.id));
        const previewHost = text(deployment.url, 300).replace(/^https?:\/\//, "").replace(/\/$/, "");
        const previewUrl = previewHost ? `https://${previewHost}` : "";
        const projectUrl = `https://vercel.com/${configuration.teamSlug}/${encodeURIComponent(targetProjectName)}`;
        if (!/^https:\/\/[^/\s]+[.]vercel[.]app\/?$/.test(previewUrl)) {
          throw new Error("Vercel returned an invalid preview URL.");
        }

        const { data: completed, error: finishError } = await adminClient.rpc("finish_website_vercel_provisioning", {
          input_run_id: runId,
          input_lease_token: leaseToken,
          input_succeeded: true,
          input_vercel_project_id: vercelProject.id,
          input_vercel_project_name: vercelProject.name,
          input_vercel_project_url: projectUrl,
          input_preview_deployment_id: deployment.id,
          input_preview_url: previewUrl,
          input_preview_state: text(deployment.readyState || deployment.status || "READY", 40).toUpperCase(),
          input_error: null,
        });
        if (finishError) throw new Error(finishError.message);
        return respond({ ok: true, provisioning: completed, message: "Vercel preview ready." });
      } catch (provisioningError) {
        const message = provisioningError instanceof Error ? provisioningError.message : "Vercel preview setup failed.";
        const { error: failureError } = await adminClient.rpc("finish_website_vercel_provisioning", {
          input_run_id: runId,
          input_lease_token: leaseToken,
          input_succeeded: false,
          input_vercel_project_id: null,
          input_vercel_project_name: null,
          input_vercel_project_url: null,
          input_preview_deployment_id: null,
          input_preview_url: null,
          input_preview_state: null,
          input_error: message,
        });
        if (failureError) console.error("Unable to record Vercel provisioning failure:", failureError.message);
        console.error("Website Vercel provisioning failed:", message);
        return respond({ error: message }, 502);
      }
    }

    if (["complete-website-project", "close-website-project", "delete-website-project"].includes(action)) {
      const projectId = String(payload.projectId || "").trim();
      if (!isUuid(projectId)) return respond({ error: "A valid projectId is required." }, 400);

      const { data: project, error: projectError } = await adminClient
        .from("website_projects")
        .select("id,name,status,managed_website_id")
        .eq("id", projectId)
        .maybeSingle();
      if (projectError) return respond({ error: projectError.message }, 400);
      if (!project) return respond({ error: "Website project not found." }, 404);

      if (action === "complete-website-project") {
        const { data: completedProject, error: completionError } = await adminClient
          .rpc("complete_website_project", { input_project_id: project.id });
        if (completionError) return respond({ error: completionError.message }, 400);
        return respond({ ok: true, project: completedProject });
      }

      if (action === "close-website-project") {
        const { data: closedProject, error: closeError } = await adminClient
          .from("website_projects")
          .update({
            status: "archived",
            admin_next_step: "This project has been closed.",
          })
          .eq("id", project.id)
          .select("*")
          .single();
        if (closeError) return respond({ error: closeError.message }, 400);
        return respond({ ok: true, project: closedProject });
      }

      const { error: deleteError } = await adminClient
        .from("website_projects")
        .delete()
        .eq("id", project.id);
      if (deleteError) return respond({ error: deleteError.message }, 400);
      return respond({
        ok: true,
        deletedProject: {
          id: project.id,
          name: project.name,
          managedWebsiteId: project.managed_website_id,
        },
      });
    }

    return respond({ error: "Unknown website project admin action." }, 400);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Unexpected website project admin error." }, 500);
  }
});
