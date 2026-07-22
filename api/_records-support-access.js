const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const ANON_KEY = String(process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function serviceHeaders() {
  return {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
}

async function fetchRows(path) {
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing Supabase service configuration.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: serviceHeaders() });
  const data = await response.json().catch(() => []);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Unable to verify Records access."));
  return Array.isArray(data) ? data : [];
}

async function getRecordsAccessContext(organization, user) {
  if (!organization?.id || !user?.id) return { isMember: false, isPlatformAdmin: false, grant: null };
  if (organization.owner_user_id === user.id) {
    return { isMember: true, membershipRole: "account_owner", isPlatformAdmin: false, grant: null };
  }

  const now = new Date().toISOString();
  const [memberships, admins, grants, emergencies] = await Promise.all([
    fetchRows(`organization_memberships?select=role&organization_id=eq.${encodeFilter(organization.id)}&user_id=eq.${encodeFilter(user.id)}&limit=1`),
    fetchRows(`platform_admins?select=user_id,role,status&user_id=eq.${encodeFilter(user.id)}&status=eq.active&limit=1`),
    fetchRows(`records_support_grants?select=id,can_view_documents,can_view_recordings,can_download_files,can_change_content,expires_at&organization_id=eq.${encodeFilter(organization.id)}&revoked_at=is.null&expires_at=gt.${encodeFilter(now)}&order=created_at.desc&limit=1`),
    fetchRows(`records_emergency_access?select=id,expires_at&organization_id=eq.${encodeFilter(organization.id)}&admin_user_id=eq.${encodeFilter(user.id)}&ended_at=is.null&expires_at=gt.${encodeFilter(now)}&order=created_at.desc&limit=1`),
  ]);

  return {
    isMember: memberships.length > 0,
    membershipRole: String(memberships[0]?.role || ""),
    isPlatformAdmin: admins.length > 0,
    isPlatformOwner: admins.some((row) => row.role === "owner"),
    grant: grants[0] || null,
    emergency: emergencies[0] || null,
  };
}

function contextAllows(context, scope) {
  if (context?.isMember) return true;
  if (!context?.isPlatformAdmin) return false;
  if (context?.emergency && context?.isPlatformOwner) return true;
  if (!context?.grant) return false;
  return Boolean(context.grant[scope]);
}

async function recordRecordsSupportEvent(token, organizationId, eventType, resourceType, resourceId) {
  if (!token || !organizationId || !ANON_KEY) return;
  await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_records_support_event`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      input_organization_id: organizationId,
      input_event_type: eventType,
      input_resource_type: resourceType || null,
      input_resource_id: resourceId ? String(resourceId) : null,
      input_reason: null,
      input_metadata: { source: "records_api" },
    }),
  }).catch(() => null);
}

module.exports = { contextAllows, getRecordsAccessContext, recordRecordsSupportEvent };
