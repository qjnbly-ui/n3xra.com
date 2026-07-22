export function getSupportOrganizationId() {
  return new URLSearchParams(window.location.search).get("support_org") || "";
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (event) => {
    const organizationId = getSupportOrganizationId();
    const anchor = event.target?.closest?.("a[href]");
    if (!organizationId || !anchor) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/n3xra-records/")) return;
    url.searchParams.set("support_org", organizationId);
    anchor.href = url.href;
  }, true);
}

export async function loadSupportGrant(supabase, organizationId) {
  if (!supabase || !organizationId || getSupportOrganizationId() !== organizationId) return null;
  const { data, error } = await supabase.from("records_support_grants").select("*")
    .eq("organization_id", organizationId).is("revoked_at", null)
    .gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return null;
  const { data: emergency, error: emergencyError } = await supabase.from("records_emergency_access")
    .select("id,expires_at,reason").eq("organization_id", organizationId).eq("admin_user_id", userId)
    .is("ended_at", null).gt("expires_at", new Date().toISOString()).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (emergencyError) throw emergencyError;
  return emergency ? {
    ...emergency,
    emergency_access: true,
    can_view_documents: true,
    can_view_recordings: true,
    can_download_files: true,
    can_change_content: true,
  } : null;
}

export async function loadSupportMembership(supabase, currentUser) {
  const organizationId = getSupportOrganizationId();
  if (!supabase || !currentUser?.id || !organizationId) return null;
  const [{ data: organization, error: organizationError }, grant] = await Promise.all([
    supabase.from("organizations").select("id,name,slug,owner_user_id,subscription_tier,account_status,document_limit,storage_limit_mb,user_limit,public_embed_enabled,keyword_search_enabled,file_preview_cards_enabled,hosted_public_portal_enabled").eq("id", organizationId).maybeSingle(),
    loadSupportGrant(supabase, organizationId),
  ]);
  if (organizationError) throw organizationError;
  if (!organization) return null;
  if (grant) {
    await recordSupportEvent(supabase, organization.id, "session_started", "records_page", window.location.pathname);
    window.addEventListener("pagehide", () => {
      recordSupportEvent(supabase, organization.id, "session_ended", "records_page", window.location.pathname);
    }, { once: true });
  }
  return {
    id: `support-${organization.id}`,
    organization_id: organization.id,
    user_id: currentUser.id,
    role: grant?.can_change_content ? "editor" : "viewer",
    permissions: { support_view: true },
    organization,
    isSupportView: true,
    supportGrant: grant,
  };
}

export function hasSupportGrantScope(grant, scope) {
  if (!grant || grant.revoked_at || new Date(grant.expires_at).getTime() <= Date.now()) return false;
  const fields = {
    documents: "can_view_documents",
    recordings: "can_view_recordings",
    downloads: "can_download_files",
    changes: "can_change_content",
  };
  return Boolean(grant[fields[scope]]);
}

export async function verifySupportScope(supabase, organizationId, scope) {
  if (getSupportOrganizationId() !== organizationId) return true;
  const { data, error } = await supabase.rpc("has_records_support_scope", {
    target_organization_id: organizationId,
    requested_scope: scope,
  });
  if (error) throw error;
  return Boolean(data);
}

export async function recordSupportEvent(supabase, organizationId, eventType, resourceType = null, resourceId = null) {
  if (!supabase || !organizationId || getSupportOrganizationId() !== organizationId) return null;
  const { data, error } = await supabase.rpc("record_records_support_event", {
    input_organization_id: organizationId,
    input_event_type: eventType,
    input_resource_type: resourceType,
    input_resource_id: resourceId,
    input_reason: null,
    input_metadata: {},
  });
  if (error) console.warn("Unable to record support access.", error);
  return data || null;
}
