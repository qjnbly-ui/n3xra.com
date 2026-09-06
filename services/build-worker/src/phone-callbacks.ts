import { createHmac } from "node:crypto";
type Store = (path: string, options?: RequestInit) => Promise<any>;
/** Callback consent belongs to one accepted phone request, never an arbitrary recipient. */
export async function setPhoneCallback(store: Store, sessionId: string, userId: string, callId: string, requestId: unknown, mode: unknown) {
  if (!/^\d+$/.test(String(requestId)) || !["wait", "callback"].includes(String(mode))) throw Error("Choose wait or callback for an accepted request.");
  const path = `/rest/v1/website_build_events?id=eq.${requestId}&session_id=eq.${sessionId}&actor_user_id=eq.${userId}&event_type=eq.user_message&metadata->>source=eq.phone&metadata->>callId=eq.${callId}`;
  const row = (await store(`${path}&limit=1`))?.[0];
  if (!row) throw Error("That phone request is unavailable.");
  const prior = row.metadata.callback;
  if (prior && !["pending", "cancelled"].includes(prior.state)) throw Error("The callback has already been dispatched. Check your phone.");
  const callback = { state: mode === "callback" ? "pending" : "cancelled", requestedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 6 * 60 * 60_000).toISOString() };
  const rows = await store(`${path}&${prior ? `metadata->callback->>state=eq.${prior.state}` : 'metadata->callback=is.null'}`, { method: "PATCH", body: JSON.stringify({ metadata: { ...row.metadata, callback } }) });
  if (!rows?.length) throw Error("Callback choice changed. Check status before trying again.");
  return { mode, saved: true };
}
/** Durable requests live in Supabase. Restarting this lightweight poller loses no consent. */
export function startPhoneCallbackPoller() {
  let running = false;
  const timer = setInterval(async () => {
    const secret = process.env.N3XRA_PHONE_BUILD_SECRET || "";
    if (running || secret.length < 32 || process.env.N3XRA_PHONE_BUILD_ENABLED !== "true") return;
    running = true;
    try {
      const time = String(Date.now());
      const signature = createHmac("sha256", secret).update(`phone-callback-dispatch:${time}`).digest("hex");
      const response = await fetch("https://www.n3xra.com/api/phone-build-callback", { method: "POST", headers: { "x-n3xra-callback-time": time, "x-n3xra-callback-signature": signature }, signal: AbortSignal.timeout(25_000) });
      if (!response.ok) console.warn("Phone callback dispatch unavailable", response.status);
    } catch { console.warn("Phone callback dispatch unavailable"); }
    finally { running = false; }
  }, 15_000);
  timer.unref();
  return timer;
}
