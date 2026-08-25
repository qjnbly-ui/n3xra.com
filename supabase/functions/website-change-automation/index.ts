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
const base64 = (value: Uint8Array) => { let output = ""; for (let offset = 0; offset < value.length; offset += 32768) output += String.fromCharCode(...value.subarray(offset, offset + 32768)); return btoa(output); };
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
async function removePreviewPrefix(admin: any, prefix: string) {
  if (!/^runs\/[0-9a-f-]{36}(?:\/revisions\/\d+)?$/i.test(prefix)) return;
  const paths: string[] = [];
  const visit = async (folder: string) => {
    const result = await admin.storage.from("website-change-previews").list(folder, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (result.error) throw result.error;
    for (const entry of result.data || []) {
      const child = `${folder}/${entry.name}`;
      if (entry.id) paths.push(child); else await visit(child);
    }
  };
  await visit(prefix);
  for (let offset = 0; offset < paths.length; offset += 100) {
    const removed = await admin.storage.from("website-change-previews").remove(paths.slice(offset, offset + 100));
    if (removed.error) throw removed.error;
  }
}
async function createLivePreviewCommit(admin: any, run: Record<string, any>, token: string, owner: string, repo: string, base: string) {
  if (!/^[0-9a-f]{40}$/.test(String(run.base_sha || "")) || !run.source_manifest_path) throw new Error("The reviewed live preview is missing its source snapshot.");
  const refResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(base)}`, token);
  const refData = await refResponse.json();
  if (!refResponse.ok || refData?.object?.sha !== run.base_sha) throw new Error("The website changed after this live preview was created. Start a new preview before publishing.");
  const baseCommitResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${run.base_sha}`, token);
  const baseCommitData = await baseCommitResponse.json();
  if (!baseCommitResponse.ok || !baseCommitData?.tree?.sha) throw new Error("GitHub could not verify the reviewed website snapshot.");
  const manifestDownload = await admin.storage.from("website-change-previews").download(run.source_manifest_path);
  if (manifestDownload.error || !manifestDownload.data) throw new Error("The reviewed live preview snapshot could not be loaded.");
  const manifest = JSON.parse(await manifestDownload.data.text());
  const changes = Array.isArray(manifest?.changes) ? manifest.changes : [];
  if (!changes.length || changes.length > 100 || manifest.baseSha !== run.base_sha) throw new Error("The reviewed live preview snapshot is invalid.");
  const tree: Record<string, unknown>[] = [];
  for (const change of changes) {
    const filePath = String(change?.path || "");
    if (!filePath || filePath.startsWith("/") || filePath.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("The live preview contains an invalid file path.");
    if (change.status === "D") { tree.push({ path: filePath, mode: "100644", type: "blob", sha: null }); continue; }
    if (!['A','M'].includes(change.status) || !['100644','100755','120000'].includes(change.mode)) throw new Error("The live preview contains an unsupported source change.");
    const sourcePrefix = String(run.source_manifest_path).replace(/\/manifest[.]json$/, "");
    const source = await admin.storage.from("website-change-previews").download(`${sourcePrefix}/${filePath}`);
    if (source.error || !source.data) throw new Error(`The reviewed source file ${filePath} is unavailable.`);
    const blobResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`, token, { method: "POST", body: JSON.stringify({ content: base64(new Uint8Array(await source.data.arrayBuffer())), encoding: "base64" }) });
    const blobData = await blobResponse.json();
    if (!blobResponse.ok || !blobData?.sha) throw new Error(`GitHub could not store ${filePath}.`);
    tree.push({ path: filePath, mode: change.mode, type: "blob", sha: blobData.sha });
  }
  const treeResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`, token, { method: "POST", body: JSON.stringify({ base_tree: baseCommitData.tree.sha, tree }) });
  const treeData = await treeResponse.json();
  if (!treeResponse.ok || !treeData?.sha) throw new Error("GitHub could not assemble the reviewed live preview.");
  const commitResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`, token, { method: "POST", body: JSON.stringify({ message: `Approve website change: ${run.request_id}`, tree: treeData.sha, parents: [run.base_sha] }) });
  const commitData = await commitResponse.json();
  if (!commitResponse.ok || !commitData?.sha) throw new Error("GitHub could not create the approved website commit.");
  const updateResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(base)}`, token, { method: "PATCH", body: JSON.stringify({ sha: commitData.sha, force: false }) });
  if (!updateResponse.ok) throw new Error("GitHub could not publish the approved commit to the main branch.");
  return commitData.sha;
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
    if (["revise-preview", "undo-revision", "submit-approval", "request-vercel-fallback", "abandon-preview"].includes(action)) {
      const runId = clean(body.runId, 80); if (!uuid(runId)) return reply({ error: "A valid Fast Preview session is required." }, 400);
      const runResult = await admin.from("website_change_runs").select("id,request_id,website_id,state,branch_name,target_repository,preview_mode,preview_url,preview_expires_at,revision_count,storage_prefix,pending_storage_prefix").eq("id", runId).single();
      if (runResult.error || !runResult.data) return reply({ error: "Fast Preview session not found." }, 404);
      const run = runResult.data;
      if (run.preview_mode !== "n3xra_live") return reply({ error: "These editing controls are only available for Fast Preview sessions." }, 409);
      const requestResult = await admin.from("platform_support_requests").select("website_id,requester_user_id,origin,subject,message,assistant_summary").eq("id", run.request_id).single();
      if (requestResult.error || !requestResult.data) return reply({ error: "The website request is no longer available." }, 404);
      const platformAdmin = await admin.from("platform_admins").select("user_id").eq("user_id", user.id).eq("status", "active").maybeSingle();
      const membership = platformAdmin.data || requestResult.data.requester_user_id !== user.id || requestResult.data.origin !== "client"
        ? null
        : await admin.from("website_members").select("user_id").eq("website_id", run.website_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
      if (!platformAdmin.data && !membership?.data) return reply({ error: "Only this website's client or an active N3XRA administrator can update the Fast Preview." }, 403);
      if (action === "abandon-preview") {
        if (["merge_queued", "merged"].includes(run.state)) return reply({ error: "This preview can no longer be abandoned because final publishing has already started." }, 409);
        if (run.state === "abandoned") return reply({ ok: true, message: "This Fast Preview was already abandoned and its private link was revoked." });
        const now = new Date().toISOString();
        const abandoned = await admin.from("website_change_runs").update({ state: "abandoned", progress_stage: "abandoned", progress_message: "The client abandoned this Fast Preview session. Its private link and temporary files were deleted.", progress_updated_at: now, preview_url: null, preview_token_hash: null, preview_expires_at: null, callback_token_hash: "0".repeat(64), callback_expires_at: now, head_sha: null, base_sha: null, source_manifest_path: null, storage_prefix: null, pending_storage_prefix: null, pending_source_manifest_path: null, approval_submitted_at: null, abandoned_at: now, abandoned_by_user_id: user.id, updated_at: now }).eq("id", run.id).not("state", "in", "(merge_queued,merged,abandoned)").select("id").maybeSingle();
        if (abandoned.error || !abandoned.data) return reply({ error: "This session changed before it could be abandoned. Refresh and try again." }, 409);
        let storageWarning = "";
        try {
          const prefixes = [...new Set([run.storage_prefix, run.pending_storage_prefix].filter(Boolean))];
          for (const prefix of prefixes) await removePreviewPrefix(admin, String(prefix));
        } catch (storageError) {
          storageWarning = clean(storageError instanceof Error ? storageError.message : "Temporary preview cleanup needs attention.", 500);
        }
        await admin.from("platform_support_requests").update({ status: "closed", automation_status: "completed", resolved_at: now, updated_at: now }).eq("id", run.request_id);
        return reply({ ok: true, warning: storageWarning || null, message: storageWarning ? "The Fast Preview was abandoned and its link was revoked. N3XRA will finish cleaning up its temporary files." : "The Fast Preview was abandoned. Its private link and temporary files were deleted; the live website was not changed." });
      }
      if (!["preview_ready", "client_ready"].includes(run.state)) return reply({ error: "Wait for the current Fast Preview update to finish before making another change." }, 409);
      const now = new Date().toISOString();
      if (action === "submit-approval") {
        const submitted = await admin.from("website_change_runs").update({ state: "client_ready", approval_submitted_at: now, progress_stage: "preview_ready", progress_message: "The client finished refining this Fast Preview and submitted it to N3XRA for final approval.", progress_updated_at: now, updated_at: now }).eq("id", run.id).in("state", ["preview_ready", "client_ready"]).select("id,state").maybeSingle();
        if (submitted.error || !submitted.data) return reply({ error: "This preview could not be submitted because its status changed." }, 409);
        await admin.from("platform_support_requests").update({ automation_status: "preview_ready", updated_at: now }).eq("id", run.request_id);
        return reply({ ok: true, run: submitted.data, message: "This version was submitted to N3XRA for final approval. The live website has not changed." });
      }
      if (action === "request-vercel-fallback") {
        const fallback = await admin.from("website_change_runs").update({ vercel_fallback_requested_at: now, updated_at: now }).eq("id", run.id).select("id").single();
        if (fallback.error) return reply({ error: fallback.error.message }, 400);
        await admin.from("platform_support_requests").update({ automation_status: "awaiting_review", updated_at: now }).eq("id", run.request_id);
        return reply({ ok: true, message: "N3XRA was asked to switch this session to a Vercel Preview. No deployment has been started yet." });
      }

      const nextSequence = Number(run.revision_count || 0) + 1;
      let insertedRevisionId = "";
      if (action === "revise-preview") {
        const instruction = clean(body.instruction, 4000);
        if (instruction.length < 3) return reply({ error: "Describe the next change you want Codex to make." }, 400);
        if (nextSequence > 50) return reply({ error: "This editing session has reached its revision limit. Submit it or start a new request." }, 409);
        const inserted = await admin.from("website_change_revisions").insert({ run_id: run.id, request_id: run.request_id, website_id: run.website_id, sequence_number: nextSequence, instruction, created_by_user_id: user.id }).select("id").single();
        if (inserted.error) return reply({ error: inserted.error.message }, 400);
        insertedRevisionId = inserted.data.id;
      } else {
        const latest = await admin.from("website_change_revisions").select("id").eq("run_id", run.id).eq("status", "active").order("sequence_number", { ascending: false }).limit(1).maybeSingle();
        if (latest.error) return reply({ error: latest.error.message }, 400);
        if (!latest.data) return reply({ error: "There is no additional change to undo yet." }, 409);
        const undone = await admin.from("website_change_revisions").update({ status: "undone", undone_at: now }).eq("id", latest.data.id).eq("status", "active").select("id").maybeSingle();
        if (undone.error || !undone.data) return reply({ error: "That change was already undone." }, 409);
      }
      const revisionsResult = await admin.from("website_change_revisions").select("sequence_number,instruction").eq("run_id", run.id).eq("status", "active").order("sequence_number", { ascending: true });
      if (revisionsResult.error) return reply({ error: revisionsResult.error.message }, 400);
      const revisionHistory = (revisionsResult.data || []).map((item: Record<string, unknown>) => `${item.sequence_number}. ${clean(item.instruction, 4000)}`).join("\n");
      const callbackToken = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const pendingPrefix = `runs/${run.id}/revisions/${nextSequence}`;
      const queued = await admin.from("website_change_runs").update({ state: "queued", revision_count: nextSequence, approval_submitted_at: null, pending_storage_prefix: pendingPrefix, pending_source_manifest_path: `${pendingPrefix}/source/manifest.json`, callback_token_hash: await sha256(callbackToken), callback_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(), progress_stage: "queued", progress_message: action === "undo-revision" ? "Codex is rebuilding the same Fast Preview without the last requested adjustment." : "Codex is applying another change to the same Fast Preview session.", progress_updated_at: now, error_message: null, updated_at: now }).eq("id", run.id).in("state", ["preview_ready", "client_ready"]).select("id").maybeSingle();
      if (queued.error || !queued.data) {
        if (insertedRevisionId) await admin.from("website_change_revisions").update({ status: "failed" }).eq("id", insertedRevisionId);
        return reply({ error: "Another update started first. Wait for it to finish and try again." }, 409);
      }
      const websiteResult = await admin.from("client_websites").select("repository_full_name").eq("id", run.website_id).single();
      const repositoryName = clean(run.target_repository || websiteResult.data?.repository_full_name, 200);
      if (!/^[^/\s]+\/[^/\s]+$/.test(repositoryName)) throw new Error("The website repository is not connected.");
      const automationRepo = clean(Deno.env.get("GITHUB_AUTOMATION_REPOSITORY") || "qjnbly-ui/n3xra.com", 200);
      const token = await githubToken();
      const [owner, repository] = automationRepo.split("/"), targetName = repositoryName.split("/")[1];
      const dispatch = await githubRequest(`/repos/${owner}/${repository}/dispatches`, token, { method: "POST", body: JSON.stringify({ event_type: "n3xra-website-change", client_payload: { run_id: run.id, target_repository: repositoryName, target_repository_name: targetName, branch: run.branch_name, preview: { mode: "n3xra_live", url: run.preview_url, upload_url: "https://www.n3xra.com/api/website-change-preview-upload" }, request_data: { title: clean(requestResult.data.subject, 100), request: clean(requestResult.data.message, 4000), summary: clean(requestResult.data.assistant_summary, 500), revisions: revisionHistory }, callback_url: "https://www.n3xra.com/api/website-change-run-callback", callback_token: callbackToken } }) });
      if (!dispatch.ok) {
        const dispatchError = await dispatch.json().catch(() => ({}));
        const message = clean(dispatchError?.message || `GitHub could not queue Codex (${dispatch.status}).`, 500);
        await admin.from("website_change_runs").update({ state: "preview_ready", pending_storage_prefix: null, pending_source_manifest_path: null, progress_stage: "preview_ready", progress_message: "The existing Fast Preview is still available. The latest adjustment could not be queued.", error_message: message, callback_token_hash: "0".repeat(64), updated_at: new Date().toISOString() }).eq("id", run.id);
        if (insertedRevisionId) await admin.from("website_change_revisions").update({ status: "failed" }).eq("id", insertedRevisionId);
        return reply({ error: message }, 502);
      }
      await admin.from("platform_support_requests").update({ automation_status: "queued", updated_at: now }).eq("id", run.request_id);
      return reply({ ok: true, run: { id: run.id, state: "queued", preview_url: run.preview_url }, message: "Codex is updating the same Fast Preview. The link will stay the same." }, 202);
    }
    if (action === "approve-merge") {
      const runId = clean(body.runId, 80); if (!uuid(runId)) return reply({ error: "A valid preview run is required." }, 400);
      const platformAdmin = await admin.from("platform_admins").select("user_id,status").eq("user_id", user.id).eq("status", "active").maybeSingle();
      if (platformAdmin.error) return reply({ error: platformAdmin.error.message }, 400);
      if (!platformAdmin.data) return reply({ error: "Only an active N3XRA platform administrator can approve a merge." }, 403);
      const runResult = await admin.from("website_change_runs").select("id,request_id,website_id,state,branch_name,head_sha,target_repository,preview_mode,preview_expires_at,base_sha,source_manifest_path").eq("id", runId).single();
      if (runResult.error || !runResult.data) return reply({ error: "Preview run not found." }, 404);
      const run = runResult.data;
      if (run.state === "merged") return reply({ ok: true, run: { id: run.id, state: "merged" }, message: "This preview is already on the live branch." });
      if (!['preview_ready','client_ready'].includes(run.state) || !run.head_sha) return reply({ error: "This preview is not ready to merge." }, 409);
      if (run.preview_mode === "n3xra_live" && run.state !== "client_ready") return reply({ error: "The client is still refining this Fast Preview. Wait until they submit the finished version for approval." }, 409);
      const previewExpiresAt = Date.parse(run.preview_expires_at || "");
      if (run.preview_mode === "n3xra_live" && (!Number.isFinite(previewExpiresAt) || previewExpiresAt <= Date.now())) return reply({ error: "This live preview expired. Start and review a new preview before publishing." }, 409);
      const websiteResult = await admin.from("client_websites").select("repository_full_name").eq("id", run.website_id).single();
      const connectedRepositoryResult = await admin.from("website_repositories").select("full_name").eq("website_id", run.website_id).eq("provider", "github").neq("access_status", "transferred").order("updated_at", { ascending: false }).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const provisionResult = await admin.from("website_provisioning_runs").select("repository_default_branch").eq("website_id", run.website_id).not("repository_default_branch", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const repository = clean(run.target_repository || websiteResult.data?.repository_full_name || connectedRepositoryResult.data?.full_name, 200), base = clean(provisionResult.data?.repository_default_branch || "main", 255);
      if (!/^[^/\s]+\/[^/\s]+$/.test(repository) || !base) return reply({ error: "The website repository is not ready for approval." }, 409);
      const token = await githubToken();
      const [owner, repo] = repository.split("/");
      if (run.preview_mode === "vercel") {
        const branchResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches/${encodeURIComponent(run.branch_name)}`, token);
        const branchData = await branchResponse.json();
        if (!branchResponse.ok || branchData?.commit?.sha !== run.head_sha) return reply({ error: "The preview branch changed after review. Generate and review a new preview before merging." }, 409);
      }
      const mergeClaim = await admin.from("website_change_runs").update({ state: "merge_queued", approved_by_user_id: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", run.id).in("state", ["preview_ready", "client_ready"]).select("id").maybeSingle();
      if (mergeClaim.error || !mergeClaim.data) return reply({ error: "This preview is already being approved." }, 409);
      mergeRunId = run.id;
      let mergeSha = "";
      if (run.preview_mode === "n3xra_live") mergeSha = await createLivePreviewCommit(admin, run, token, owner, repo, base);
      else {
        const mergeResponse = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/merges`, token, { method: "POST", body: JSON.stringify({ base, head: run.branch_name, commit_message: `Approve website change: ${run.request_id}` }) });
        const mergeData = await mergeResponse.json();
        if (!mergeResponse.ok || !mergeData?.sha) {
          await admin.from("website_change_runs").update({ state: "preview_ready", error_message: clean(mergeData?.message || "GitHub could not merge the reviewed preview.", 2000), updated_at: new Date().toISOString() }).eq("id", run.id).eq("state", "merge_queued");
          mergeRunId = "";
          return reply({ error: clean(mergeData?.message || "GitHub could not merge the reviewed preview.", 500) }, mergeResponse.status === 409 ? 409 : 502);
        }
        mergeSha = mergeData.sha;
      }
      const now = new Date().toISOString();
      const productionCallbackToken = base64Url(crypto.getRandomValues(new Uint8Array(32)));
      const mergedUpdate: Record<string, unknown> = { state: "merged", merge_sha: mergeSha, progress_stage: "production_deploying", progress_message: "The approved change is on the main branch. Vercel is building the production website now.", progress_updated_at: now, error_message: null, approved_by_user_id: user.id, approved_at: now, merged_at: now, callback_token_hash: await sha256(productionCallbackToken), callback_expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(), updated_at: now };
      if (run.preview_mode === "n3xra_live") mergedUpdate.preview_token_hash = null;
      await admin.from("website_change_runs").update(mergedUpdate).eq("id", run.id);
      await admin.from("platform_support_requests").update({ status: "in_progress", automation_status: "running", resolved_at: null, updated_at: now }).eq("id", run.request_id);

      const automationRepository = clean(Deno.env.get("GITHUB_AUTOMATION_REPOSITORY") || "qjnbly-ui/n3xra.com", 200);
      const [automationOwner, automationName] = automationRepository.split("/");
      const productionDispatch = await githubRequest(`/repos/${encodeURIComponent(automationOwner)}/${encodeURIComponent(automationName)}/dispatches`, token, {
        method: "POST",
        body: JSON.stringify({ event_type: "n3xra-website-publish", client_payload: { run_id: run.id, target_repository: repository, target_repository_name: repo, target_branch: base, merge_sha: mergeSha, callback_url: "https://www.n3xra.com/api/website-change-run-callback", callback_token: productionCallbackToken } }),
      });
      if (!productionDispatch.ok) {
        const dispatchError = `GitHub could not start production verification (${productionDispatch.status}).`;
        await admin.from("website_change_runs").update({ progress_stage: "production_failed", progress_message: dispatchError, error_message: dispatchError, callback_token_hash: "0".repeat(64), updated_at: now }).eq("id", run.id);
        await admin.from("platform_support_requests").update({ automation_status: "failed", updated_at: now }).eq("id", run.request_id);
        mergeRunId = "";
        return reply({ ok: true, warning: dispatchError, run: { id: run.id, state: "merged", merge_sha: mergeSha }, message: "The change was merged, but production verification needs attention." });
      }
      mergeRunId = "";
      return reply({ ok: true, run: { id: run.id, state: "merged", merge_sha: mergeSha, progress_stage: "production_deploying" }, message: `The reviewed change was published to ${base}. Vercel is building production now.` });
    }
    if (action !== "start-preview") return reply({ error: "Choose a valid website automation action." }, 400);
    const requestId = clean(body.requestId, 80); if (!uuid(requestId)) return reply({ error: "A valid request is required." }, 400);
    const previewMode = clean(body.previewMode || "vercel", 40);
    if (!['vercel','n3xra_live'].includes(previewMode)) return reply({ error: "Choose a valid preview method." }, 400);
    const requestWebsite = await admin.from("platform_support_requests").select("website_id,requester_user_id,origin,subject,message,assistant_summary").eq("id", requestId).single();
    if (requestWebsite.error || !requestWebsite.data?.website_id) return reply({ error: "This website request is not available." }, 404);
    const previewAdmin = await admin.from("platform_admins").select("user_id,status").eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (previewAdmin.error) return reply({ error: previewAdmin.error.message }, 400);
    const previewWebsite = await admin.from("client_websites").select("live_preview_enabled").eq("id", requestWebsite.data.website_id).single();
    if (previewWebsite.error) return reply({ error: previewWebsite.error.message }, 400);
    if (previewMode === "n3xra_live" && !previewWebsite.data?.live_preview_enabled) return reply({ error: "Fast Live Preview is not enabled for this website yet. Use the Vercel preview or enable the website beta setting first." }, 409);
    const clientMembership = previewAdmin.data || previewMode !== "n3xra_live" || requestWebsite.data.requester_user_id !== user.id || requestWebsite.data.origin !== "client"
      ? null
      : await admin.from("website_members").select("user_id").eq("website_id", requestWebsite.data.website_id).eq("user_id", user.id).eq("status", "active").maybeSingle();
    if (clientMembership?.error) return reply({ error: clientMembership.error.message }, 400);
    const canStartFastPreview = previewMode === "n3xra_live" && Boolean(clientMembership?.data);
    if (!previewAdmin.data && !canStartFastPreview) return reply({ error: previewMode === "n3xra_live" ? "Only the client who submitted this request or an active N3XRA administrator can start its Fast Preview." : "Only an active N3XRA platform administrator can start a Vercel preview." }, 403);
    const staleBefore = new Date().toISOString();
    await admin.from("website_change_runs").update({ state: "failed", error_message: "The previous preview run timed out and can be retried safely.", callback_token_hash: "0".repeat(64), updated_at: new Date().toISOString() }).eq("request_id", requestId).in("state", ["queued", "coding"]).lt("callback_expires_at", staleBefore);
    const callbackToken = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const result = await admin.rpc("claim_website_change_run", { input_request_id: requestId, input_actor_user_id: user.id, input_callback_token_hash: await sha256(callbackToken), input_preview_mode: previewMode });
    if (result.error) return reply({ error: result.error.message }, 400); claimed = result.data;
    if (!claimed?.acquired) return reply({ ok: true, run: { id: claimed.id, request_id: claimed.request_id, state: claimed.state, branch_name: claimed.branch_name, preview_mode: claimed.preview_mode }, message: "This request already has an active preview." });
    const previewToken = previewMode === "n3xra_live" ? base64Url(crypto.getRandomValues(new Uint8Array(36))) : "";
    const previewUrl = previewMode === "n3xra_live" ? `https://www.n3xra.com/website-preview/${claimed.id}/${previewToken}/` : null;
    const previewExpiry = previewMode === "n3xra_live" ? new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString() : null;
    const modeUpdate = await admin.from("website_change_runs").update({ preview_mode: previewMode, preview_token_hash: previewToken ? await sha256(previewToken) : null, preview_expires_at: previewExpiry, preview_url: null, storage_prefix: previewMode === "n3xra_live" ? `runs/${claimed.id}` : null, source_manifest_path: previewMode === "n3xra_live" ? `runs/${claimed.id}/source/manifest.json` : null, updated_at: new Date().toISOString() }).eq("id", claimed.id).select("id").single();
    if (modeUpdate.error) throw new Error(modeUpdate.error.message);
    const automationRepo = clean(Deno.env.get("GITHUB_AUTOMATION_REPOSITORY") || "qjnbly-ui/n3xra.com", 200);
    if (!/^[^/\s]+\/[^/\s]+$/.test(automationRepo)) throw new Error("GitHub automation is not configured.");
    const token = await githubToken();
    const [owner, repository] = automationRepo.split("/"), targetRepository = String(claimed.repository_full_name), targetName = targetRepository.split("/")[1];
    const dispatch = await githubRequest(`/repos/${owner}/${repository}/dispatches`, token, { method: "POST", body: JSON.stringify({ event_type: "n3xra-website-change", client_payload: { run_id: claimed.id, target_repository: targetRepository, target_repository_name: targetName, branch: claimed.branch_name, preview: { mode: previewMode, url: previewUrl, upload_url: "https://www.n3xra.com/api/website-change-preview-upload" }, request_data: { title: clean(requestWebsite.data?.subject, 100), request: clean(requestWebsite.data?.message, 4000), summary: clean(requestWebsite.data?.assistant_summary, 500), revisions: "" }, callback_url: "https://www.n3xra.com/api/website-change-run-callback", callback_token: callbackToken } }) });
    if (!dispatch.ok) {
      const dispatchError = await dispatch.json().catch(() => ({}));
      throw new Error(clean(dispatchError?.message || `GitHub could not queue Codex (${dispatch.status}).`, 500));
    }
    const now = new Date().toISOString(); await admin.from("website_change_runs").update({ state: "queued", progress_stage: "queued", progress_message: previewMode === "n3xra_live" ? "The request was accepted. Codex will prepare an N3XRA-hosted live preview without starting a Vercel preview deployment." : "The request was accepted and queued in the isolated GitHub workflow.", progress_updated_at: now, updated_at: now }).eq("id", claimed.id); await admin.from("platform_support_requests").update({ automation_status: "queued", updated_at: now }).eq("id", requestId);
    return reply({ ok: true, run: { id: claimed.id, request_id: requestId, state: "queued", branch_name: claimed.branch_name, target_repository: claimed.repository_full_name, preview_mode: previewMode }, message: previewMode === "n3xra_live" ? "The N3XRA live preview is queued. No Vercel preview deployment will be created." : "The private Vercel preview is queued in GitHub. Status will update automatically." }, 202);
  } catch (error) {
    if (claimed?.id && admin) { const message = error instanceof Error ? error.message : "Unable to start the preview."; const now = new Date().toISOString(); await admin.from("website_change_runs").update({ state: "failed", progress_stage: "failed", progress_message: message, failure_stage: "queued", progress_updated_at: now, error_message: message, callback_token_hash: "0".repeat(64), updated_at: now }).eq("id", claimed.id); }
    if (mergeRunId && admin) { const message = error instanceof Error ? error.message : "Unable to merge the preview."; await admin.from("website_change_runs").update({ state: "preview_ready", error_message: clean(message, 2000), updated_at: new Date().toISOString() }).eq("id", mergeRunId).eq("state", "merge_queued"); }
    return reply({ error: error instanceof Error ? error.message : "Unable to start the preview." }, 500);
  }
});
