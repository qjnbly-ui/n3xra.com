const {
  clean,
  requirePlatformAdmin,
  sendJson,
  supabaseJson,
} = require("./_communications");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function inFilter(values) {
  return values.map((value) => encodeURIComponent(value)).join(",");
}

function safeStatus(error) {
  const status = Number(error?.status || 500);
  return status >= 400 && status < 600 ? status : 500;
}

async function listIndex() {
  const [workspaces, organizations, websites, requests] = await Promise.all([
    supabaseJson("communications_workspaces?select=id,organization_id,slug,program_name,sender_name,status,created_at,updated_at&order=program_name.asc&limit=500"),
    supabaseJson("organizations?select=id,name,account_status&order=name.asc&limit=500"),
    supabaseJson("client_websites?select=id,organization_id,name,slug,status,live_url&order=name.asc&limit=1000"),
    supabaseJson("communications_number_requests?select=id,status,created_at&order=created_at.desc&limit=500"),
  ]);
  const organizationsById = new Map((organizations || []).map((organization) => [organization.id, organization]));
  return {
    workspaces: (workspaces || []).map((workspace) => ({
      ...workspace,
      organization: organizationsById.get(workspace.organization_id) || null,
    })),
    organizations: organizations || [],
    websites: websites || [],
    request_summary: {
      total: (requests || []).length,
      submitted: (requests || []).filter((request) => request.status === "submitted").length,
      reviewing: (requests || []).filter((request) => request.status === "reviewing").length,
    },
  };
}

async function loadWorkspace(workspaceId) {
  if (!UUID_PATTERN.test(workspaceId)) {
    const error = new Error("Choose a valid Communications workspace.");
    error.status = 400;
    throw error;
  }
  const rows = await supabaseJson(
    `communications_workspaces?select=id,organization_id,slug,program_name,sender_name,website_url,privacy_policy_url,program_terms_url,support_email,support_phone,expected_message_frequency,status,included_sms_segments,sms_overage_cents,mms_unit_cents,created_at,updated_at&id=eq.${encodeURIComponent(workspaceId)}&limit=1`,
  );
  const workspace = Array.isArray(rows) ? rows[0] || null : null;
  if (!workspace) {
    const error = new Error("Communications workspace not found.");
    error.status = 404;
    throw error;
  }

  const [
    organizationRows,
    entitlements,
    websiteLinks,
    channels,
    numbers,
    sendingDomains,
    topics,
    keywords,
    subscribers,
    topicMetrics,
    workspaceMetrics,
    forms,
    signupSources,
    consentEvents,
    messageEvents,
    adminAudit,
  ] = await Promise.all([
    supabaseJson(`organizations?select=id,name,account_status,subscription_tier&id=eq.${encodeURIComponent(workspace.organization_id)}&limit=1`),
    supabaseJson(`organization_product_entitlements?select=organization_id,product_key,status,portal_enabled,source,starts_at,ends_at,updated_at&organization_id=eq.${encodeURIComponent(workspace.organization_id)}&product_key=eq.communications&limit=1`),
    supabaseJson(`communications_workspace_websites?select=workspace_id,website_id,organization_id,status,created_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.asc`),
    supabaseJson(`communications_channels?select=id,workspace_id,channel,status,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=channel.asc`),
    supabaseJson(`communications_numbers?select=id,workspace_id,phone_e164,provider,status,carrier_registration_status,texting_activated_at,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.asc`),
    supabaseJson(`communications_sending_domains?select=id,workspace_id,domain,provider,status,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.asc`),
    supabaseJson(`communications_topics?select=id,workspace_id,slug,name,description,active,sort_order,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=sort_order.asc,name.asc`),
    supabaseJson(`communications_keywords?select=id,workspace_id,number_id,keyword,topic_id,source_id,active,welcome_message,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=keyword.asc`),
    supabaseJson(`communications_subscribers?select=id,workspace_id,full_name,phone_e164,email,sms_status,email_status,joined_at,last_interaction_at,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=joined_at.desc&limit=500`),
    supabaseJson(`communications_topic_metrics?select=workspace_id,topic_id,subscriber_count&workspace_id=eq.${encodeURIComponent(workspace.id)}`),
    supabaseJson(`communications_workspace_metrics?select=workspace_id,total_subscribers,sms_subscribers,email_subscribers,active_topics,consent_events,message_events,sms_segments_current_month&workspace_id=eq.${encodeURIComponent(workspace.id)}&limit=1`),
    supabaseJson(`website_forms?select=id,public_id,organization_id,website_id,communications_workspace_id,name,form_type,status,success_message,allowed_origins,active_consent_configuration,created_at,updated_at&communications_workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.asc`),
    supabaseJson(`communications_signup_sources?select=id,organization_id,website_id,workspace_id,form_id,source_type,name,slug,status,created_at,updated_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.asc`),
    supabaseJson(`communications_consent_events?select=id,workspace_id,subscriber_id,channel,event_type,consent_method,disclosure_version,topic_ids,source_page,created_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.desc&limit=200`),
    supabaseJson(`communications_message_events?select=id,workspace_id,subscriber_id,channel,direction,status,from_address,to_address,body_preview,sms_segment_count,billable_units,estimated_cost_cents,occurred_at,created_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=occurred_at.desc&limit=200`),
    supabaseJson(`communications_admin_audit_log?select=id,actor_user_id,workspace_id,action,entity_type,entity_id,created_at&workspace_id=eq.${encodeURIComponent(workspace.id)}&order=created_at.desc&limit=100`),
  ]);

  const websiteIds = (websiteLinks || []).map((row) => row.website_id).filter(Boolean);
  const formIds = (forms || []).map((row) => row.id).filter(Boolean);
  const subscriberIds = (subscribers || []).map((row) => row.id).filter(Boolean);
  const [websites, formFields, formActions, submissions, subscriberTopics] = await Promise.all([
    websiteIds.length
      ? supabaseJson(`client_websites?select=id,organization_id,name,slug,status,live_url,created_at,updated_at&id=in.(${inFilter(websiteIds)})&order=name.asc`)
      : [],
    formIds.length
      ? supabaseJson(`website_form_fields?select=id,form_id,field_key,field_type,label,placeholder,required,sort_order,contact_field_mapping,created_at,updated_at&form_id=in.(${inFilter(formIds)})&order=sort_order.asc`)
      : [],
    formIds.length
      ? supabaseJson(`website_form_actions?select=id,form_id,action_type,status,sort_order,created_at,updated_at&form_id=in.(${inFilter(formIds)})&order=sort_order.asc`)
      : [],
    formIds.length
      ? supabaseJson(`website_form_submissions?select=id,organization_id,website_id,form_id,workspace_id,subscriber_id,verified_signup_source_id,source_page,request_origin,processing_status,submitted_at,processed_at&form_id=in.(${inFilter(formIds)})&order=submitted_at.desc&limit=200`)
      : [],
    subscriberIds.length
      ? supabaseJson(`communications_subscriber_topics?select=subscriber_id,topic_id,selected_at&subscriber_id=in.(${inFilter(subscriberIds)})`)
      : [],
  ]);
  const actionIds = (formActions || []).map((row) => row.id).filter(Boolean);
  const queue = actionIds.length
    ? await supabaseJson(`website_form_action_queue?select=id,organization_id,submission_id,form_action_id,status,attempts,available_at,processed_at,last_error,created_at,updated_at&form_action_id=in.(${inFilter(actionIds)})&order=created_at.desc&limit=200`)
    : [];

  return {
    workspace,
    organization: Array.isArray(organizationRows) ? organizationRows[0] || null : null,
    entitlement: Array.isArray(entitlements) ? entitlements[0] || null : null,
    website_links: websiteLinks || [],
    websites: websites || [],
    channels: channels || [],
    numbers: numbers || [],
    sending_domains: sendingDomains || [],
    topics: topics || [],
    keywords: keywords || [],
    subscribers: subscribers || [],
    subscriber_topics: subscriberTopics || [],
    topic_metrics: topicMetrics || [],
    metrics: Array.isArray(workspaceMetrics) ? workspaceMetrics[0] || null : null,
    forms: forms || [],
    form_fields: formFields || [],
    form_actions: formActions || [],
    signup_sources: signupSources || [],
    submissions: submissions || [],
    queue: queue || [],
    consent_events: consentEvents || [],
    message_events: messageEvents || [],
    admin_audit: adminAudit || [],
  };
}

async function listRequests() {
  return supabaseJson(
    "communications_number_requests?select=id,organization_id,website_id,requester_user_id,organization_name,website_url,primary_contact_name,primary_contact_email,primary_contact_phone,preferred_area_code,intended_use,estimated_subscriber_count,estimated_monthly_message_volume,requested_topics,requested_keyword,requested_channels,example_messages,privacy_policy_url,terms_url,status,reviewed_by,reviewed_at,created_at,updated_at&order=created_at.desc&limit=500",
  );
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return sendJson(res, 405, { error: "Method not allowed." });
  }
  res.setHeader("Cache-Control", "private, no-store");
  try {
    await requirePlatformAdmin(req);
    const scope = clean(req.query?.scope, 30).toLowerCase() || "index";
    if (scope === "index") return sendJson(res, 200, await listIndex());
    if (scope === "workspace") {
      return sendJson(res, 200, await loadWorkspace(clean(req.query?.workspaceId, 80)));
    }
    if (scope === "requests") return sendJson(res, 200, { requests: await listRequests() });
    return sendJson(res, 400, { error: "Unknown Communications Admin scope." });
  } catch (error) {
    const status = safeStatus(error);
    if (status >= 500) console.error("Communications Admin read failed:", error);
    return sendJson(res, status, {
      error: status >= 500 ? "Communications Admin is temporarily unavailable." : error.message,
    });
  }
};

module.exports.UUID_PATTERN = UUID_PATTERN;
module.exports.loadWorkspace = loadWorkspace;
