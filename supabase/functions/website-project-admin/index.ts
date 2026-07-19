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

      try {
        const onboarding = await openOnboarding(adminClient, project, user.id);
        return respond({ ok: true, onboarding });
      } catch (onboardingError) {
        return respond({ error: onboardingError instanceof Error ? onboardingError.message : "Unable to open onboarding." }, 400);
      }
    }

    return respond({ error: "Unknown website project admin action." }, 400);
  } catch (error) {
    return respond({ error: error instanceof Error ? error.message : "Unexpected website project admin error." }, 500);
  }
});
