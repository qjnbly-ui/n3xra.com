const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

function clean(value, limit = 10000) {
  return String(value || "").trim().slice(0, limit);
}

async function createAdminNotification(input = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const payload = {
    event_type: clean(input.eventType || input.event_type, 160) || "system.event",
    product: clean(input.product, 80) || "platform",
    priority: ["important", "activity", "system"].includes(input.priority) ? input.priority : "activity",
    title: clean(input.title, 300) || "N3XRA activity",
    summary: clean(input.summary, 2000),
    message_text: clean(input.messageText || input.message_text, 50000) || null,
    message_html: clean(input.messageHtml || input.message_html, 100000) || null,
    actor_name: clean(input.actorName || input.actor_name, 240) || null,
    actor_email: clean(input.actorEmail || input.actor_email, 320).toLowerCase() || null,
    source_table: clean(input.sourceTable || input.source_table, 160) || null,
    source_id: clean(input.sourceId || input.source_id, 240) || null,
    action_url: clean(input.actionUrl || input.action_url, 1000) || null,
    metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
  };
  const response = await fetch(`${SUPABASE_URL}/rest/v1/admin_notifications`, {
    method: "POST",
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(String(data?.message || data?.error || "Unable to save admin notification."));
  return Array.isArray(data) ? data[0] || null : data;
}

module.exports = { createAdminNotification };
