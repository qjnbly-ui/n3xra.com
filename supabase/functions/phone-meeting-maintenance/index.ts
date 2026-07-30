import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type RetentionJob = {
  id: string;
  organization_id: string;
  phone_meeting_session_id: string;
  meeting_recording_id: string | null;
  status: "pending" | "failed";
  attempts: number;
  scheduled_for: string;
};

type MeetingRecording = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  transcript_status: string;
  metadata: Record<string, unknown> | null;
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8" };
const MAX_ATTEMPTS = 5;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function getServiceRoleKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
}

function getMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function completeJob(
  admin: ReturnType<typeof createClient>,
  job: RetentionJob,
  status: "completed" | "skipped",
  metadata: Record<string, unknown> = {}
) {
  const { error } = await admin
    .from("phone_meeting_retention_jobs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      locked_at: null,
      last_error: null,
      metadata,
    })
    .eq("id", job.id);
  if (error) throw new Error(error.message);
}

async function failJob(admin: ReturnType<typeof createClient>, job: RetentionJob, error: unknown) {
  const message = error instanceof Error ? error.message : "Phone meeting retention cleanup failed.";
  const { error: updateError } = await admin
    .from("phone_meeting_retention_jobs")
    .update({
      status: "failed",
      locked_at: null,
      last_error: message.slice(0, 500),
    })
    .eq("id", job.id);
  if (updateError) console.error("Unable to record retention failure", updateError.message);
  return message;
}

async function processRetentionJob(admin: ReturnType<typeof createClient>, job: RetentionJob) {
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await admin
    .from("phone_meeting_retention_jobs")
    .update({
      status: "processing",
      locked_at: claimedAt,
      attempts: Number(job.attempts || 0) + 1,
      last_error: null,
    })
    .eq("id", job.id)
    .eq("status", job.status)
    .select("id")
    .maybeSingle();
  if (claimError) throw new Error(claimError.message);
  if (!claimed) return { id: job.id, outcome: "already_claimed" };

  try {
    if (!job.meeting_recording_id) {
      await completeJob(admin, job, "skipped", { reason: "meeting_recording_removed" });
      return { id: job.id, outcome: "skipped" };
    }

    const { data: recording, error: recordingError } = await admin
      .from("meeting_recordings")
      .select("id, storage_bucket, storage_path, transcript_status, metadata")
      .eq("id", job.meeting_recording_id)
      .eq("organization_id", job.organization_id)
      .maybeSingle();
    if (recordingError) throw new Error(recordingError.message);
    if (!recording) {
      await completeJob(admin, job, "skipped", { reason: "meeting_recording_not_found" });
      return { id: job.id, outcome: "skipped" };
    }

    const meetingRecording = recording as MeetingRecording;
    if (!["ready", "failed"].includes(meetingRecording.transcript_status || "")) {
      throw new Error("The transcript is still processing; audio retention will retry later.");
    }

    const metadata = getMetadata(meetingRecording.metadata);
    const phoneMeeting = getMetadata(metadata.phoneMeeting);
    const storagePath = String(phoneMeeting.storagePath || "").trim();
    const storageBucket = String(phoneMeeting.storageBucket || meetingRecording.storage_bucket || "meeting-recordings").trim();
    if (!storagePath) {
      await completeJob(admin, job, "skipped", { reason: "phone_audio_not_found" });
      return { id: job.id, outcome: "skipped" };
    }

    const { error: storageError } = await admin.storage.from(storageBucket).remove([storagePath]);
    if (storageError) throw new Error(storageError.message);

    const deletedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      phoneMeeting: {
        ...phoneMeeting,
        storagePath: null,
        audioDeletedAt: deletedAt,
        retentionCompletedAt: deletedAt,
      },
    };
    const recordingUpdates: Record<string, unknown> = { metadata: nextMetadata };
    if (meetingRecording.storage_path === storagePath) {
      Object.assign(recordingUpdates, {
        storage_bucket: null,
        storage_path: null,
        audio_mime_type: null,
        file_size: null,
      });
    }

    const { error: updateRecordingError } = await admin
      .from("meeting_recordings")
      .update(recordingUpdates)
      .eq("id", meetingRecording.id)
      .eq("organization_id", job.organization_id);
    if (updateRecordingError) throw new Error(updateRecordingError.message);

    const { data: session } = await admin
      .from("phone_meeting_sessions")
      .select("metadata")
      .eq("id", job.phone_meeting_session_id)
      .maybeSingle();
    const { error: updateSessionError } = await admin
      .from("phone_meeting_sessions")
      .update({
        metadata: {
          ...getMetadata(session?.metadata),
          audioDeletedAt: deletedAt,
          retentionCompletedAt: deletedAt,
        },
      })
      .eq("id", job.phone_meeting_session_id)
      .eq("organization_id", job.organization_id);
    if (updateSessionError) throw new Error(updateSessionError.message);

    await completeJob(admin, job, "completed", {
      storage_bucket: storageBucket,
      storage_path: storagePath,
      audio_deleted_at: deletedAt,
      transcript_retained: true,
    });
    return { id: job.id, outcome: "completed" };
  } catch (error) {
    return { id: job.id, outcome: "failed", error: await failJob(admin, job, error) };
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("PHONE_MEETING_MAINTENANCE_SECRET")?.trim();
  const suppliedSecret = request.headers.get("x-maintenance-secret")?.trim();
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: "Maintenance configuration is incomplete." }, 500);
  }

  const body = await request.json().catch(() => ({})) as { action?: string; limit?: number };
  const action = body.action === "run" ? "run" : "preview";
  const limit = Math.max(1, Math.min(100, Math.floor(Number(body.limit) || 25)));
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const now = new Date().toISOString();

  const { data: jobs, error: jobsError } = await admin
    .from("phone_meeting_retention_jobs")
    .select("id, organization_id, phone_meeting_session_id, meeting_recording_id, status, attempts, scheduled_for")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .lte("scheduled_for", now)
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (jobsError) return jsonResponse({ error: jobsError.message }, 500);

  const organizationIds = [...new Set((jobs || []).map((job) => job.organization_id))];
  const { data: settings, error: settingsError } = organizationIds.length
    ? await admin
      .from("organization_phone_meeting_settings")
      .select("organization_id, retention_cleanup_enabled")
      .in("organization_id", organizationIds)
    : { data: [], error: null };
  if (settingsError) return jsonResponse({ error: settingsError.message }, 500);

  const enabledOrganizations = new Set(
    (settings || [])
      .filter((setting) => setting.retention_cleanup_enabled)
      .map((setting) => setting.organization_id)
  );
  const eligibleJobs = (jobs || []).filter((job) => enabledOrganizations.has(job.organization_id)) as RetentionJob[];

  if (action === "preview") {
    return jsonResponse({
      action,
      due_jobs: (jobs || []).length,
      eligible_jobs: eligibleJobs.length,
      cleanup_enabled_organizations: enabledOrganizations.size,
      jobs: eligibleJobs.map((job) => ({
        id: job.id,
        organization_id: job.organization_id,
        scheduled_for: job.scheduled_for,
        attempts: job.attempts,
      })),
    });
  }

  const results = [];
  for (const job of eligibleJobs) {
    results.push(await processRetentionJob(admin, job));
  }

  const completedJobIds = new Set(
    results
      .filter((result) => result.outcome === "completed")
      .map((result) => result.id)
  );
  const completedOrganizations = [...new Set(
    eligibleJobs
      .filter((job) => completedJobIds.has(job.id))
      .map((job) => job.organization_id)
  )];
  if (completedOrganizations.length) {
    await admin
      .from("organization_phone_meeting_settings")
      .update({ last_retention_run_at: new Date().toISOString() })
      .in("organization_id", completedOrganizations);
  }

  return jsonResponse({
    action,
    due_jobs: (jobs || []).length,
    eligible_jobs: eligibleJobs.length,
    processed_jobs: results.length,
    results,
  });
});
