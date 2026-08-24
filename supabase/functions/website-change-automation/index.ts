import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const reply = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
const clean = (value: unknown, limit = 1000) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const join = (...parts: Uint8Array[]) => { const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; };
const derLength = (length: number) => { if (length < 128) return new Uint8Array([length]); const result: number[] = []; for (let value = length; value; value >>>= 8) result.unshift(value & 255); return new Uint8Array([128 | result.length, ...result]); };
const der = (tag: number, value: Uint8Array) => join(new Uint8Array([tag]), derLength(value.length), value);
const pem = (value: string) => Uint8Array.from(atob(value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "")), (character) => character.charCodeAt(0));
const privateKey = (value: string) => value.includes("BEGIN RSA PRIVATE KEY") ? der(0x30, join(new Uint8Array([2,1,0]), new Uint8Array([0x30,0x0d,0x06,0x09,0x2a,0x86,0x48,0x86,0xf7,0x0d,0x01,0x01,0x01,0x05,0]), der(0x04, pem(value)))) : pem(value);
const base64Url = (value: string | Uint8Array) => { const input = typeof value === "string" ? new TextEncoder().encode(value) : value; let binary = ""; input.forEach((byte) => binary += String.fromCharCode(byte)); return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_"); };
const hex = (value: Uint8Array) => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
async function sha256(value: string) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))); }
async function appJwt(id: string, keyText: string) {
  const now = Math.floor(Date.now() / 1000), header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" })), payload = base64Url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: id })), message = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("pkcs8", privateKey(keyText), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  return `${message}.${base64Url(new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(message))))}`;
}
async function githubToken() {
  const appId = clean(Deno.env.get("GITHUB_APP_CLIENT_ID") || Deno.env.get("GITHUB_APP_ID"), 200);
  const appKey = String(Deno.env.get("GITHUB_APP_PRIVATE_KEY") || "").replace(/\\n/g, "\n").trim();
  const installation = clean(Deno.env.get("GITHUB_APP_INSTALLATION_ID"), 100);
  if (!appId || !appKey || !/^\d+$/.test(installation)) throw new Error("GitHub automation is not configured.");
  const jwt = await appJwt(appId, appKey);
  const response = await fetch(`https://api.github.com/app/installations/${installation}/access_tokens`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
    body: JSON.stringify({ permissions: { contents: "write", metadata: "read" } }),
  });
  const data = await response.json();
  if (!response.ok || !data.token) throw new Error("GitHub App authentication failed. Confirm Contents: Read and write permission.");
  return String(data.token);
}
async function githubRequest(path: string, token: string, init: RequestInit = {}) {
  return fetch(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28", ...(init.headers || {}) } });
}
const emailEscape = (value: unknown) => String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
async function sendPublishedEmail(admin: any, run: Record<string, any>) {
  const resendKey = String(Deno.env.get("RESEND_API_KEY") || "").trim();
  if (!resendKey) throw new Error("RESEND_API_KEY is missing.");
  const [supportResult, websiteResult] = await Promise.all([
    admin.from("platform_support_requests").select("requester_name,requester_email,subject").eq("id", run.request_id).single(),
    admin.from("client_websites").select("name,portal_slug,live_url").eq("id", run.website_id).single(),
  ]);
  if (supportResult.error || websiteResult.error) throw new Error("The client email details could not be loaded.");
  const support = supportResult.data, website = websiteResult.data;
  const recipient = clean(support?.requester_email, 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("The support request does not have a valid client email address.");
  const firstName = clean(support?.requester_name, 120).split(/\s+/)[0], site = clean(website?.name || "your website", 160), change = clean(support?.subject || "Website update", 160);
  const actionUrl = /^https:\/\//i.test(String(website?.live_url || "")) ? String(website.live_url) : `https://${website.portal_slug}.portal.n3xra.com/`;
  const greeting = firstName ? `Hi ${firstName},` : "Hello,";
  const message = "N3XRA reviewed and approved the requested change. It has now been published to the website's main branch.";
  const emailResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json", "Idempotency-Key": `website-change/${run.id}/published` },
    body: JSON.stringify({
      from: Deno.env.get("WEBSITE_CHANGE_EMAIL_FROM") || "N3XRA Website Updates <noreply@n3xra.com>",
      to: [recipient],
      subject: `Your ${site} update is live`,
      text: `${greeting}\n\n${message}\n\nRequest: ${change}\nOpen live website: ${actionUrl}\n\nYou can also see the request status in your N3XRA client portal.`,
      html: `<div style="margin:0;padding:32px 16px;background:#edf3f5;font-family:Arial,sans-serif;color:#101820;line-height:1.6"><div style="max-width:640px;margin:0 auto"><div style="padding:28px 32px;background:#07111b;color:#fff;border-radius:22px 22px 0 0"><p style="margin:0 0 9px;color:#69c7bd;font-size:12px;font-weight:800;letter-spacing:.18em;text-transform:uppercase">N3XRA Website Management</p><h1 style="margin:0;font-family:Georgia,serif;font-size:30px;line-height:1.2">Your website update is live</h1></div><div style="padding:30px 32px;background:#fff;border:1px solid #dce4e8;border-top:0;border-radius:0 0 22px 22px"><p style="margin:0 0 16px;font-size:16px">${emailEscape(greeting)}</p><p style="margin:0 0 20px;font-size:16px">${emailEscape(message)}</p><div style="margin:0 0 22px;padding:16px 18px;background:#f4f8f8;border-left:4px solid #278b80"><p style="margin:0;color:#66727c;font-size:12px;font-weight:800;letter-spacing:.1em;text-transform:uppercase">Requested change</p><p style="margin:5px 0 0;font-weight:700">${emailEscape(change)}</p></div><a href="${emailEscape(actionUrl)}" style="display:inline-block;padding:13px 21px;background:#07111b;color:#fff;text-decoration:none;font-weight:800;border-radius:8px">Open live website</a><p style="margin:24px 0 0;color:#68757e;font-size:13px">You can also see the request status in your N3XRA client portal.</p></div></div></div>`,
    }),
  });
  const emailPayload = await emailResponse.json().catch(() => ({}));
  if (!emailResponse.ok) throw new Error(clean(emailPayload?.message || emailPayload?.error || `Resend returned ${emailResponse.status}.`, 2000));
  return emailPayload?.id || null;
}
Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (request.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  let claimed: Record<string, any> | null = null;
  let mergeRunId = "";
  let admin: any = null;
  try {
    const url = Deno.env.get("SUPABASE_URL") || "", anon = Deno.env.get("SUPABASE_ANON_KEY") || "", service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY") || "", authorization = request.headers.get("Authorization") || "";
    if (!url || !anon || !service || !authorization) return reply({ error: "Authentication is required." }, 401);
    const userClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } }); admin = createClient(url, service);
    const { data: userData } = await userClient.auth.getUser(); const user = userData?.user; if (!user) return reply({ error: "Your session is no longer valid." }, 401);
    const body = await request.json().catch(() => ({})), action = clean(body.action, 40);
    if (action === "approve-merge") {
      const runId = clean(body.runId, 80); if (!uuid(runId)) return reply({ error: "A valid preview run is required." }, 400);
      const platformAdmin = await admin.from("platform_admins").select("user_id,status").eq("user_id", user.id).eq("status", "active").maybeSingle();
      if (platformAdmin.error) return reply({ error: platformAdmin.error.message }, 400);
      if (!platformAdmin.data) return reply({ error: "Only an active N3XRA platform administrator can approve a merge." }, 403);
      const runResult = await admin.from("website_change_runs").select("id,request_id,website_id,state,branch_name,head_sha").eq("id", runId).single();
      if (runResult.error || !runResult.data) return reply({ error: "Preview run not found." }, 404);
      const run = runResult.data;
      if (run.state === "merged") return reply({ ok: true, run: { id: run.id, state: "merged" }, message: "This preview is already on the live branch." });
      if (!['preview_ready','client_ready'].includes(run.state) || !run.head_sha) return reply({ error: "This preview is not ready to merge." }, 409);
      const websiteResult = await admin.from("client_websites").select("repository_full_name").eq("id", run.website_id).single();
      const connectedRepositoryResult = await admin.from("website_repositories").select("repository_full_name").eq("website_id", run.website_id).eq("provider", "github").order("created_at", { ascending: false }).limit(1).maybeSingle();
      const provisionResult = await admin.from("website_provisioning_runs").select("repository_default_branch").eq("website_id", run.website_id).not("repository_default_branch", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const repository = clean(websiteResult.data?.repository_full_name || connectedRepositoryResult.data?.repository_full_name, 200), base = clean(provisionResult.data?.repository_default_branch || "main", 255);
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !base) return reply({ error: "The website repository is not ready for approval." }, 409);
      const token = await githubToken();
      const [owner, repo] = repository.split("/");
      const branchResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(run.branch_name)}`, token);
      const branchData = await branchResponse.json();
      if (!branchResponse.ok || branchData?.commit?.sha !== run.head_sha) return reply({ error: "The preview branch changed after review. Generate and review a new preview before merging." }, 409);
      const mergeClaim = await admin.from("website_change_runs").update({ state: "merge_queued", approved_by_user_id: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id).in("state", ["preview_ready", "client_ready"]).select("id").maybeSingle();
      if (mergeClaim.error || !mergeClaim.data) return reply({ error: "This preview is already being approved." }, 409);
      mergeRunId = run.id;
      const mergeResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merges`, token, { method: "POST", body: JSON.stringify({ base, head: run.branch_name, commit_message: `Approve website change: ${run.request_id}` }) });
      const mergeData = await mergeResponse.json();
      if (!mergeResponse.ok || !mergeData?.sha) {
        await admin.from("website_change_runs").update({ state: "preview_ready", error_message: clean(mergeData?.message || "GitHub could not merge the reviewed preview.", 2000), updated_at: new Date().toISOString() }).eq("id", run.id).eq("state", "merge_queued");
        mergeRunId = "";
        return reply({ error: clean(mergeData?.message || "GitHub could not merge the reviewed preview.", 500) }, mergeResponse.status === 409 ? 409 : 502);
      }
      const now = new Date().toISOString();
      await admin.from("website_change_runs").update({ state: "merged", progress_stage: "merged", progress_message: "The reviewed change was merged into the website main branch.", progress_updated_at: now, error_message: null, approved_by_user_id: user.id, approved_at: now, merged_at: now, updated_at: now }).eq("id", run.id);
      await admin.from("platform_support_requests").update({ status: "resolved", automation_status: "completed", resolved_at: now, updated_at: now }).eq("id", run.request_id);
      try {
        await sendPublishedEmail(admin, run);
        await admin.from("website_change_runs").update({ published_email_sent_at: now, client_email_delivery_error: null, updated_at: now }).eq("id", run.id);
      } catch (emailError) {
        const deliveryError = clean(emailError instanceof Error ? emailError.message : "The published email could not be sent.", 2000);
        await admin.from("website_change_runs").update({ client_email_delivery_error: deliveryError, updated_at: now }).eq("id", run.id);
        console.error("Published website email failed:", deliveryError);
      }
      mergeRunId = "";
      return reply({ ok: true, run: { id: run.id, state: "merged", merge_sha: mergeData.sha }, message: `The reviewed change was merged into ${base}.` });
    }
    if (action !== "start-preview") return reply({ error: "Choose a valid website automation action." }, 400);
    const previewAdmin = await admin.from("platform_admins").select("user_id,status").eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (previewAdmin.error) return reply({ error: previewAdmin.error.message }, 400);
    if (!previewAdmin.data) return reply({ error: "Only an active N3XRA platform administrator can start an AI preview." }, 403);
    const requestId = clean(body.requestId, 80); if (!uuid(requestId)) return reply({ error: "A valid request is required." }, 400);
    const staleBefore = new Date().toISOString();
    await admin.from("website_change_runs").update({ state: "failed", error_message: "The previous preview run timed out and can be retried safely.", callback_token_hash: "0".repeat(64), updated_at: new Date().toISOString() }).eq("request_id", requestId).in("state", ["queued", "coding"]).lt("callback_expires_at", staleBefore);
    const callbackToken = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const result = await admin.rpc("claim_website_change_run", { input_request_id: requestId, input_actor_user_id: user.id, input_callback_token_hash: await sha256(callbackToken) });
    if (result.error) return reply({ error: result.error.message }, 400); claimed = result.data;
    if (!claimed?.acquired) return reply({ ok: true, run: { id: claimed.id, request_id: claimed.request_id, state: claimed.state, branch_name: claimed.branch_name }, message: "This request already has an active preview." });
    const automationRepo = clean(Deno.env.get("GITHUB_AUTOMATION_REPOSITORY") || "qjnbly-ui/n3xra.com", 200);
    if (!/^[^/\s]+\/[^/\s]+$/.test(automationRepo)) throw new Error("GitHub automation is not configured.");
    const token = await githubToken();
    const support = await admin.from("platform_support_requests").select("subject,message,assistant_summary").eq("id", requestId).single();
    const [owner, repository] = automationRepo.split("/"), targetRepository = String(claimed.repository_full_name), targetName = targetRepository.split("/")[1];
    const dispatch = await githubRequest(`/repos/${owner}/${repository}/dispatches`, token, { method: "POST", body: JSON.stringify({ event_type: "n3xra-website-change", client_payload: { run_id: claimed.id, target_repository: targetRepository, target_repository_name: targetName, branch: claimed.branch_name, title: clean(support.data?.subject, 100), request: clean(support.data?.message, 4000), summary: clean(support.data?.assistant_summary, 500), callback_url: "https://www.n3xra.com/api/website-change-run-callback", callback_token: callbackToken } }) });
    if (!dispatch.ok) throw new Error(`GitHub could not queue Codex (${dispatch.status}).`);
    const now = new Date().toISOString(); await admin.from("website_change_runs").update({ state: "queued", progress_stage: "queued", progress_message: "The request was accepted and queued in the isolated GitHub workflow.", progress_updated_at: now, updated_at: now }).eq("id", claimed.id); await admin.from("platform_support_requests").update({ automation_status: "queued", updated_at: now }).eq("id", requestId);
    return reply({ ok: true, run: { id: claimed.id, request_id: requestId, state: "queued", branch_name: claimed.branch_name, target_repository: claimed.repository_full_name }, message: "The private preview request is queued in GitHub. Status will update automatically." }, 202);
  } catch (error) {
    if (claimed?.id && admin) { const message = error instanceof Error ? error.message : "Unable to start the preview."; const now = new Date().toISOString(); await admin.from("website_change_runs").update({ state: "failed", progress_stage: "failed", progress_message: message, failure_stage: "queued", progress_updated_at: now, error_message: message, callback_token_hash: "0".repeat(64), updated_at: now }).eq("id", claimed.id); }
    if (mergeRunId && admin) { const message = error instanceof Error ? error.message : "Unable to merge the preview."; await admin.from("website_change_runs").update({ state: "preview_ready", error_message: clean(message, 2000), updated_at: new Date().toISOString() }).eq("id", mergeRunId).eq("state", "merge_queued"); }
    return reply({ error: error instanceof Error ? error.message : "Unable to start the preview." }, 500);
  }
});
