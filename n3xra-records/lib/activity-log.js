export const RECORDS_ACTIVITY_TYPES = [
  "upload",
  "delete",
  "visibility_change",
  "invite_sent",
  "invite_redeemed",
  "ai_search_used",
  "billing_change",
  "record_transfer",
];

export function cleanActivityMetadata(metadata = {}) {
  return Object.fromEntries(
    Object.entries(metadata || {}).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

export async function recordActivity(supabase, session, activity = {}) {
  const organizationId = String(activity.organizationId || activity.organization_id || "").trim();
  const actionType = String(activity.actionType || activity.action_type || "").trim();
  const summary = String(activity.summary || "").trim();
  if (!supabase || !session?.user?.id || !organizationId || !actionType || !summary) return null;

  const payload = {
    organization_id: organizationId,
    actor_user_id: session.user.id,
    actor_email: session.user.email || null,
    actor_name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || session.user.email || null,
    action_type: actionType,
    target_type: String(activity.targetType || activity.target_type || "").trim() || null,
    target_id: String(activity.targetId || activity.target_id || "").trim() || null,
    target_label: String(activity.targetLabel || activity.target_label || "").trim() || null,
    summary,
    metadata: cleanActivityMetadata(activity.metadata || {}),
  };

  const { data, error } = await supabase
    .from("records_activity_log")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    console.warn("Unable to record Records activity.", error);
    return null;
  }

  return data;
}

export async function loadActivityLog(supabase, organizationId, options = {}) {
  if (!supabase || !organizationId) return [];
  let query = supabase
    .from("records_activity_log")
    .select("id, actor_email, actor_name, action_type, target_type, target_id, target_label, summary, metadata, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, Number(options.limit || 80))));

  if (options.actionType && options.actionType !== "all") {
    query = query.eq("action_type", options.actionType);
  }

  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}
