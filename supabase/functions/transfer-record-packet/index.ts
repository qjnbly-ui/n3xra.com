import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function escapeHtml(input: unknown) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeEmail(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function isEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function hashToken(token: string) {
  const bytes = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function createToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function destinationPath(sourcePath: unknown, targetOrganizationId: string) {
  const parts = String(sourcePath || "").split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return [targetOrganizationId, ...parts.slice(1)].join("/");
}

function isStableRecording(recording: Record<string, unknown>) {
  const status = String(recording.status || "").toLowerCase();
  const transcriptStatus = String(recording.transcript_status || "").toLowerCase();
  const reviewStatus = String(recording.ai_review_status || "").toLowerCase();
  return !["recording", "interrupted", "uploading", "finalizing", "transcribing"].includes(status)
    && !["queued", "processing"].includes(transcriptStatus)
    && reviewStatus !== "processing";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY");
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const fromEmail = Deno.env.get("RECORDS_INVITE_FROM_EMAIL") || "N3XRA Records <noreply@n3xra.com>";
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return jsonResponse({ error: "Supabase environment variables are missing." }, 500);
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return jsonResponse({ error: "Sign in to continue." }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return jsonResponse({ error: "Your session is invalid or expired." }, 401);

  try {
    const payload = await request.json().catch(() => ({}));
    const action = String(payload.action || "").trim().toLowerCase();

    if (action === "list") {
      const recordingId = String(payload.recordingId || "").trim();
      const { data: recording } = await adminClient.from("meeting_recordings")
        .select("id,organization_id")
        .eq("id", recordingId)
        .maybeSingle();
      if (!recording) return jsonResponse({ error: "Record packet not found." }, 404);
      const { data: membership } = await adminClient.from("organization_memberships")
        .select("role")
        .eq("organization_id", recording.organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membership?.role !== "account_admin") return jsonResponse({ error: "Account administrator access is required." }, 403);

      await adminClient.from("record_packet_transfer_requests")
        .update({ status: "expired" })
        .eq("recording_id", recording.id)
        .eq("status", "pending")
        .lte("expires_at", new Date().toISOString());
      const { data: invitations, error } = await adminClient.from("record_packet_transfer_requests")
        .select("id,recipient_email,recipient_organization_name,status,expires_at,created_at")
        .eq("recording_id", recording.id)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return jsonResponse({ invitations: invitations || [] });
    }

    if (action === "create") {
      if (!resendApiKey) return jsonResponse({ error: "Transfer email service is not configured." }, 503);
      const recordingId = String(payload.recordingId || "").trim();
      const recipientEmail = normalizeEmail(payload.recipientEmail);
      const recipientOrganizationName = String(payload.recipientOrganizationName || "").trim().slice(0, 160);
      if (!recordingId || !isEmail(recipientEmail)) return jsonResponse({ error: "A valid recipient email is required." }, 400);
      if (recipientEmail === normalizeEmail(user.email)) return jsonResponse({ error: "Use ‘Move to your workspace’ for an account you already control." }, 400);

      const { data: recording } = await adminClient.from("meeting_recordings")
        .select("id,organization_id,title,status,transcript_status,ai_review_status")
        .eq("id", recordingId)
        .maybeSingle();
      if (!recording) return jsonResponse({ error: "Record packet not found." }, 404);
      if (!isStableRecording(recording)) return jsonResponse({ error: "Finish active recording and processing before transferring this packet." }, 400);

      const [{ data: membership }, { data: organization }, { data: profile }] = await Promise.all([
        adminClient.from("organization_memberships").select("role").eq("organization_id", recording.organization_id).eq("user_id", user.id).maybeSingle(),
        adminClient.from("organizations").select("id,name").eq("id", recording.organization_id).maybeSingle(),
        adminClient.from("profiles").select("full_name").eq("id", user.id).maybeSingle(),
      ]);
      if (membership?.role !== "account_admin") return jsonResponse({ error: "Account administrator access is required." }, 403);

      const token = createToken();
      const tokenHash = await hashToken(token);
      const { data: invitation, error: insertError } = await adminClient.from("record_packet_transfer_requests")
        .insert({
          recording_id: recording.id,
          source_organization_id: recording.organization_id,
          recipient_email: recipientEmail,
          recipient_organization_name: recipientOrganizationName || null,
          token_hash: tokenHash,
          created_by_user_id: user.id,
        })
        .select("id,recipient_email,recipient_organization_name,status,expires_at,created_at")
        .single();
      if (insertError) {
        if (String(insertError.code) === "23505") return jsonResponse({ error: "This packet already has a pending transfer invitation. Cancel it before sending another." }, 409);
        throw insertError;
      }

      const link = `https://n3xra.com/n3xra-records/record-transfer?token=${encodeURIComponent(token)}`;
      const senderName = String(profile?.full_name || user.email || "A N3XRA Records administrator").trim();
      const safeTitle = escapeHtml(recording.title || "Untitled meeting note");
      const safeSource = escapeHtml(organization?.name || "the sending organization");
      const safeSender = escapeHtml(senderName);
      const safeTarget = recipientOrganizationName ? ` for <strong>${escapeHtml(recipientOrganizationName)}</strong>` : "";
      const html = `
        <div style="margin:0;padding:28px;background:#f5f7fb;font-family:Manrope,Trebuchet MS,sans-serif;color:#121924;">
          <div style="max-width:620px;margin:0 auto;background:#fff;border:1px solid rgba(15,22,32,.08);border-radius:18px;overflow:hidden;">
            <div style="padding:26px 28px;background:linear-gradient(135deg,#0c1218 0%,#123a33 100%);color:#fff;">
              <div style="font-size:12px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;opacity:.82;">N3XRA Record Transfer</div>
              <h1 style="margin:10px 0 0;font-size:30px;line-height:1.1;">A record packet is ready for you</h1>
            </div>
            <div style="padding:28px;">
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#2f3d4d;">${safeSender} is transferring <strong>${safeTitle}</strong> from <strong>${safeSource}</strong>${safeTarget}.</p>
              <p style="margin:0 0 18px;font-size:16px;line-height:1.6;color:#2f3d4d;">Sign in with this email address, review the packet, and choose the Organization workspace that should receive it.</p>
              <a href="${escapeHtml(link)}" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#123a33;color:#fff;text-decoration:none;font-size:15px;font-weight:700;">Review record packet</a>
              <p style="margin:16px 0 0;font-size:13px;line-height:1.5;color:#5b6678;">This invitation expires in 7 days. Nothing moves until you accept it.</p>
            </div>
          </div>
        </div>`;
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendApiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: fromEmail, to: [recipientEmail], subject: `${senderName} sent you a N3XRA record packet`, html }),
      });
      if (!emailResponse.ok) {
        const emailPayload = await emailResponse.json().catch(() => ({}));
        await adminClient.from("record_packet_transfer_requests").delete().eq("id", invitation.id);
        return jsonResponse({ error: emailPayload?.message || "The transfer email could not be sent." }, 400);
      }

      await adminClient.from("records_activity_log").insert({
        organization_id: recording.organization_id,
        actor_user_id: user.id,
        action_type: "record_transfer",
        target_type: "record_packet",
        target_id: recording.id,
        target_label: recording.title,
        summary: `Sent a record packet transfer invitation to ${recipientEmail}.`,
        metadata: { direction: "out", phase: "invited", transferRequestId: invitation.id, recipientEmail },
      });
      return jsonResponse({ invitation });
    }

    if (action === "cancel") {
      const requestId = String(payload.requestId || "").trim();
      const { data: invitation } = await adminClient.from("record_packet_transfer_requests")
        .select("id,recording_id,source_organization_id,status")
        .eq("id", requestId)
        .maybeSingle();
      if (!invitation) return jsonResponse({ error: "Transfer invitation not found." }, 404);
      const { data: membership } = await adminClient.from("organization_memberships")
        .select("role")
        .eq("organization_id", invitation.source_organization_id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membership?.role !== "account_admin") return jsonResponse({ error: "Account administrator access is required." }, 403);
      if (invitation.status !== "pending") return jsonResponse({ error: `This transfer invitation is already ${invitation.status}.` }, 409);
      const { error } = await adminClient.from("record_packet_transfer_requests")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("id", invitation.id)
        .eq("status", "pending");
      if (error) throw error;
      return jsonResponse({ ok: true });
    }

    const token = String(payload.token || "").trim();
    if (!token) return jsonResponse({ error: "The transfer token is missing." }, 400);
    const tokenHash = await hashToken(token);
    const { data: invitation } = await adminClient.from("record_packet_transfer_requests")
      .select("*")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (!invitation) return jsonResponse({ error: "This transfer invitation is invalid." }, 404);
    if (normalizeEmail(user.email) !== invitation.recipient_email) {
      return jsonResponse({ error: `Sign in as ${invitation.recipient_email} to open this transfer.` }, 403);
    }
    if (invitation.status === "pending" && new Date(invitation.expires_at).getTime() <= Date.now()) {
      await adminClient.from("record_packet_transfer_requests").update({ status: "expired" }).eq("id", invitation.id);
      invitation.status = "expired";
    }

    const [{ data: recording }, { data: sourceOrganization }, { data: destinationMemberships }] = await Promise.all([
      adminClient.from("meeting_recordings").select("id,organization_id,title,status,transcript_status,ai_review_status,storage_path,storage_bucket,document_id,metadata").eq("id", invitation.recording_id).maybeSingle(),
      adminClient.from("organizations").select("id,name").eq("id", invitation.source_organization_id).maybeSingle(),
      adminClient.from("organization_memberships").select("organization_id,role,organization:organizations(id,name,subscription_tier,account_status)").eq("user_id", user.id).eq("role", "account_admin"),
    ]);
    const destinations = (destinationMemberships || []).filter((membership) => {
      const organization = Array.isArray(membership.organization) ? membership.organization[0] : membership.organization;
      return organization?.subscription_tier === "organization" && ["active", "trialing"].includes(String(organization?.account_status || "active"));
    }).map((membership) => Array.isArray(membership.organization) ? membership.organization[0] : membership.organization);

    if (action === "get") {
      return jsonResponse({
        invitation: {
          id: invitation.id,
          recipientEmail: invitation.recipient_email,
          recipientOrganizationName: invitation.recipient_organization_name,
          status: invitation.status,
          expiresAt: invitation.expires_at,
          sourceOrganizationName: sourceOrganization?.name || "Sending organization",
          recordingTitle: recording?.title || "Record packet",
        },
        destinations,
      });
    }

    if (action !== "accept") return jsonResponse({ error: "Unknown action." }, 400);
    if (invitation.status !== "pending") return jsonResponse({ error: `This transfer invitation is ${invitation.status}.` }, 409);
    if (!recording || recording.organization_id !== invitation.source_organization_id) return jsonResponse({ error: "The record packet is no longer available." }, 409);
    if (!isStableRecording(recording)) return jsonResponse({ error: "The packet is still processing. Try again after the sender finishes it." }, 409);

    const targetOrganizationId = String(payload.targetOrganizationId || "").trim();
    if (!destinations.some((organization) => organization?.id === targetOrganizationId)) {
      return jsonResponse({ error: "Choose an active Organization workspace where you are an Account Admin." }, 403);
    }

    let transcript: Record<string, unknown> | null = null;
    if (recording.document_id) {
      const { data } = await adminClient.from("documents").select("id,storage_path").eq("id", recording.document_id).maybeSingle();
      transcript = data;
      if (!transcript?.storage_path) return jsonResponse({ error: "The transcript file could not be loaded." }, 409);
    }

    const recordingPaths = [recording.storage_path, recording.metadata?.phoneMeeting?.storagePath]
      .map((value) => String(value || "").trim())
      .filter((value, index, values) => value && values.indexOf(value) === index);
    const moves: Array<{ bucket: string; source: string; target: string }> = recordingPaths.map((source) => ({
      bucket: "meeting-recordings",
      source,
      target: destinationPath(source, targetOrganizationId),
    }));
    if (transcript?.storage_path) {
      moves.push({ bucket: "documents", source: String(transcript.storage_path), target: destinationPath(transcript.storage_path, targetOrganizationId) });
    }

    const completedMoves: typeof moves = [];
    try {
      for (const move of moves) {
        const { error } = await adminClient.storage.from(move.bucket).move(move.source, move.target);
        if (error) throw error;
        completedMoves.push(move);
      }
      const primaryRecordingMove = moves.find((move) => move.bucket === "meeting-recordings" && move.source === recording.storage_path);
      const transcriptMove = moves.find((move) => move.bucket === "documents");
      const { data: result, error } = await adminClient.rpc("complete_external_record_packet_transfer", {
        input_transfer_request_id: invitation.id,
        input_target_organization_id: targetOrganizationId,
        input_accepting_user_id: user.id,
        input_recording_storage_path: primaryRecordingMove?.target || null,
        input_transcript_storage_path: transcriptMove?.target || null,
      });
      if (error) throw error;
      return jsonResponse({ result });
    } catch (error) {
      for (const move of completedMoves.reverse()) {
        await adminClient.storage.from(move.bucket).move(move.target, move.source).catch(() => null);
      }
      throw error;
    }
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Unable to transfer the record packet." }, 500);
  }
});
