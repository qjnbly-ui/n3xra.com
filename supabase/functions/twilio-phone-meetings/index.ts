import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type PhoneMeetingSession = {
  id: string;
  organization_id: string;
  meeting_recording_id: string | null;
  twilio_call_sid: string | null;
  twilio_recording_sid: string | null;
  status: string;
  metadata: Record<string, unknown> | null;
};

type PhoneMeetingSettings = {
  organization_id: string;
  feature_enabled: boolean;
  activation_status: string;
  primary_phone_number: string | null;
};

type EnabledPhoneMeetingSettings = PhoneMeetingSettings & {
  recording_notice_enabled: boolean;
  recording_notice_text: string;
  default_retention_days: number;
};

const TWIML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };
const ACTIVE_STATUSES = new Set(["ready_for_internal_test", "active"]);

function getServiceRoleKey() {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
}

function escapeXml(value: string) {
  return String(value || "").replace(/[&<>\"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&apos;",
  })[character] || character);
}

function xmlResponse(message?: string) {
  const escaped = escapeXml(message || "");
  const body = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escaped}</Say><Hangup/></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;
  return new Response(body, { status: 200, headers: TWIML_HEADERS });
}

function xmlGather(message: string, actionUrl: string, options: { numDigits?: number; timeout?: number } = {}) {
  const numDigits = options.numDigits || 6;
  const timeout = options.timeout || 12;
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Gather input="dtmf" numDigits="${numDigits}" timeout="${timeout}" action="${escapeXml(actionUrl)}" method="POST"><Say>${escapeXml(message)}</Say></Gather><Say>We did not receive a response. Goodbye.</Say><Hangup/></Response>`,
    { status: 200, headers: TWIML_HEADERS }
  );
}

function xmlRecord(notice: string, actionUrl: string, recordingStatusCallback: string) {
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(notice)}</Say><Record action="${escapeXml(actionUrl)}" method="POST" timeout="0" maxLength="14400" playBeep="true" trim="do-not-trim" recordingStatusCallback="${escapeXml(recordingStatusCallback)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed"/><Say>Thank you. Goodbye.</Say><Hangup/></Response>`,
    { status: 200, headers: TWIML_HEADERS }
  );
}

function callbackUrl(request: Request, mode: string, sessionId?: string) {
  const url = new URL(request.url);
  url.search = "";
  url.searchParams.set("mode", mode);
  if (sessionId) url.searchParams.set("session", sessionId);
  return url.toString();
}

function sixDigitCode() {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + (bytes[0] % 900000));
}

function base64Encode(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function secureEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function verifyTwilioSignature(url: string, parameters: URLSearchParams, receivedSignature: string, authToken: string) {
  const names = [...new Set([...parameters.keys()])].sort();
  let payload = url;
  for (const name of names) {
    for (const value of parameters.getAll(name)) {
      payload += `${name}${value}`;
    }
  }

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return secureEqual(base64Encode(new Uint8Array(signature)), receivedSignature);
}

function normalizePhoneNumber(value: string | null) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function isAllowedRecordingUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "api.twilio.com" && url.pathname.includes("/Recordings/");
  } catch {
    return false;
  }
}

function basicAuthorization(user: string, password: string) {
  return `Basic ${btoa(`${user}:${password}`)}`;
}

async function loadSession(
  admin: ReturnType<typeof createClient>,
  callSid: string | null,
  recordingSid: string | null
): Promise<PhoneMeetingSession | null> {
  if (recordingSid) {
    const { data, error } = await admin
      .from("phone_meeting_sessions")
      .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, metadata")
      .eq("twilio_recording_sid", recordingSid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as PhoneMeetingSession;
  }

  if (!callSid) return null;
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, metadata")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PhoneMeetingSession | null) || null;
}

async function loadSessionById(admin: ReturnType<typeof createClient>, sessionId: string | null) {
  if (!sessionId) return null;
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, metadata")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PhoneMeetingSession | null) || null;
}

async function loadEnabledSettings(admin: ReturnType<typeof createClient>, organizationId: string) {
  const { data, error } = await admin
    .from("organization_phone_meeting_settings")
    .select("organization_id, feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const settings = data as PhoneMeetingSettings | null;
  if (!settings || !settings.feature_enabled || !ACTIVE_STATUSES.has(settings.activation_status)) return null;
  return settings as EnabledPhoneMeetingSettings;
}

async function loadEnabledSettingsByNumber(admin: ReturnType<typeof createClient>, number: string | null) {
  if (!number) return null;
  const { data, error } = await admin
    .from("organization_phone_meeting_settings")
    .select("organization_id, feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days")
    .eq("primary_phone_number", number)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const settings = data as EnabledPhoneMeetingSettings | null;
  if (!settings || !settings.feature_enabled || !ACTIVE_STATUSES.has(settings.activation_status)) return null;
  return settings;
}

async function loadSessionByCode(admin: ReturnType<typeof createClient>, organizationId: string, code: string) {
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, metadata")
    .eq("organization_id", organizationId)
    .in("status", ["draft", "connecting"])
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  const now = Date.now();
  return ((data || []) as PhoneMeetingSession[]).find((session) => {
    const metadata = session.metadata || {};
    const expiresAt = Date.parse(String(metadata.dial_in_expires_at || ""));
    return metadata.dial_in_code === code && Number.isFinite(expiresAt) && expiresAt > now;
  }) || null;
}

async function hasActiveDialInSession(admin: ReturnType<typeof createClient>, organizationId: string) {
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("metadata")
    .eq("organization_id", organizationId)
    .in("status", ["draft", "connecting"])
    .order("created_at", { ascending: false })
    .limit(25);
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data || []).some((session) => {
    const expiresAt = Date.parse(String((session.metadata || {}).dial_in_expires_at || ""));
    return Number.isFinite(expiresAt) && expiresAt > now;
  });
}

async function assertControlAccess(
  request: Request,
  admin: ReturnType<typeof createClient>,
  organizationId: string
) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Sign in is required.");
  const { data: authData, error: authError } = await admin.auth.getUser(token);
  if (authError || !authData.user) throw new Error("Your sign-in session has expired.");
  const user = authData.user;
  const email = String(user.email || "").toLowerCase();
  const [{ data: organization, error: organizationError }, { data: membership, error: membershipError }, { data: platformAdmin, error: platformAdminError }] = await Promise.all([
    admin.from("organizations").select("owner_user_id, subscription_tier").eq("id", organizationId).maybeSingle(),
    admin.from("organization_memberships").select("role").eq("organization_id", organizationId).eq("user_id", user.id).maybeSingle(),
    admin.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);
  if (organizationError || membershipError || platformAdminError || !organization) throw new Error("Unable to confirm meeting access.");
  const platformAccess = ["quentin@n3xra.com", "quentin@quentinnichols.com"].includes(email) || Boolean(platformAdmin);
  const canManage = platformAccess || organization.owner_user_id === user.id || ["account_admin", "editor"].includes(String(membership?.role || ""));
  if (!canManage || organization.subscription_tier !== "organization") throw new Error("You do not have access to start phone meetings for this library.");
  return user;
}

async function startPhoneMeetingSession(
  request: Request,
  admin: ReturnType<typeof createClient>,
  input: { organization_id?: string; meeting_recording_id?: string }
) {
  const organizationId = String(input.organization_id || "");
  const meetingRecordingId = String(input.meeting_recording_id || "");
  if (!organizationId || !meetingRecordingId) throw new Error("A library and meeting note are required.");
  const user = await assertControlAccess(request, admin, organizationId);
  const settings = await loadEnabledSettings(admin, organizationId);
  if (!settings?.primary_phone_number) throw new Error("Phone Meetings is not enabled for internal testing in this library.");
  const { data: recording, error: recordingError } = await admin
    .from("meeting_recordings")
    .select("id, metadata")
    .eq("id", meetingRecordingId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (recordingError || !recording) throw new Error("The meeting note was not found.");
  const { data: previous, error: previousError } = await admin
    .from("phone_meeting_sessions")
    .select("id, status, metadata")
    .eq("meeting_recording_id", meetingRecordingId)
    .maybeSingle();
  if (previousError) throw new Error(previousError.message);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const dialInCode = sixDigitCode();
  const retentionUntil = new Date(now.getTime() + Number(settings.default_retention_days || 30) * 86400000).toISOString();
  const recordingMetadata = (recording.metadata || {}) as Record<string, unknown>;
  const metadata = {
    ...recordingMetadata,
    meeting_sources: { ...((recordingMetadata.meeting_sources || {}) as Record<string, unknown>), phone_call: true },
  };
  await admin.from("meeting_recordings").update({ metadata }).eq("id", meetingRecordingId).eq("organization_id", organizationId);
  if (previous && ["draft", "connecting"].includes(previous.status)) {
    const { data, error } = await admin
      .from("phone_meeting_sessions")
      .update({
        requested_by_user_id: user.id,
        status: "draft",
        retention_until: retentionUntil,
        metadata: { ...(previous.metadata || {}), dial_in_code: dialInCode, dial_in_expires_at: expiresAt },
      })
      .eq("id", previous.id)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { session_id: data.id, dial_in_number: settings.primary_phone_number, meeting_code: dialInCode, expires_at: expiresAt, recording_notice: settings.recording_notice_text };
  }
  if (previous) throw new Error("This meeting already has a completed or active phone call.");
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .insert({
      organization_id: organizationId,
      meeting_recording_id: meetingRecordingId,
      requested_by_user_id: user.id,
      connection_method: "dial_in",
      status: "draft",
      retention_until: retentionUntil,
      metadata: { dial_in_code: dialInCode, dial_in_expires_at: expiresAt, internal_test: true },
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return { session_id: data.id, dial_in_number: settings.primary_phone_number, meeting_code: dialInCode, expires_at: expiresAt, recording_notice: settings.recording_notice_text };
}

async function updateSession(
  admin: ReturnType<typeof createClient>,
  sessionId: string,
  changes: Record<string, unknown>
) {
  const { error } = await admin.from("phone_meeting_sessions").update(changes).eq("id", sessionId);
  if (error) throw new Error(error.message);
}

async function storeCompletedRecording(
  admin: ReturnType<typeof createClient>,
  session: PhoneMeetingSession,
  recordingUrl: string,
  recordingSid: string,
  durationSeconds: number | null
) {
  if (!session.meeting_recording_id) {
    throw new Error("Phone meeting session is not linked to a meeting recording.");
  }

  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
  const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
  if (!accountSid || !apiKeySid || !apiKeySecret) {
    throw new Error("Twilio recording transfer credentials are missing.");
  }
  if (!isAllowedRecordingUrl(recordingUrl)) {
    throw new Error("Twilio supplied an unsupported recording URL.");
  }

  const { data: meetingRecording, error: meetingRecordingError } = await admin
    .from("meeting_recordings")
    .select("id, storage_path, metadata")
    .eq("id", session.meeting_recording_id)
    .eq("organization_id", session.organization_id)
    .maybeSingle();
  if (meetingRecordingError) throw new Error(meetingRecordingError.message);
  if (!meetingRecording) throw new Error("The linked meeting recording was not found.");

  const metadata = (meetingRecording.metadata || {}) as Record<string, unknown>;
  const savedPhoneMeeting = (metadata.phoneMeeting || {}) as Record<string, unknown>;
  const isPrimaryAudio = !meetingRecording.storage_path;
  const storagePath = isPrimaryAudio
    ? `${session.organization_id}/${meetingRecording.id}/twilio-${recordingSid}.wav`
    : `${session.organization_id}/${meetingRecording.id}/sources/twilio-${recordingSid}.wav`;

  await updateSession(admin, session.id, {
    status: "copying_to_storage",
    twilio_recording_sid: recordingSid,
    duration_seconds: durationSeconds,
    billed_minutes: durationSeconds ? Math.ceil(durationSeconds / 60) : session.metadata?.billed_minutes || 0,
  });

  if (!savedPhoneMeeting.storagePath) {
    const source = new URL(recordingUrl);
    if (!source.pathname.endsWith(".wav")) source.pathname = `${source.pathname}.wav`;
    const recordingResponse = await fetch(source, {
      headers: { Authorization: basicAuthorization(apiKeySid, apiKeySecret) },
    });
    if (!recordingResponse.ok) {
      throw new Error(`Twilio recording download failed with status ${recordingResponse.status}.`);
    }

    const audio = await recordingResponse.blob();
    const { error: uploadError } = await admin.storage.from("meeting-recordings").upload(storagePath, audio, {
      contentType: recordingResponse.headers.get("content-type") || "audio/wav",
      upsert: false,
    });
    if (uploadError && !/already exists/i.test(uploadError.message)) throw new Error(uploadError.message);

    const updatePayload: Record<string, unknown> = {
      processing_error: null,
      metadata: {
        ...metadata,
        meeting_sources: {
          ...((metadata.meeting_sources || {}) as Record<string, unknown>),
          phone_call: true,
        },
        phoneMeeting: {
          ...savedPhoneMeeting,
          source: "twilio",
          recordingSid,
          storagePath,
          storageBucket: "meeting-recordings",
          mimeType: recordingResponse.headers.get("content-type") || "audio/wav",
          fileSize: audio.size,
          durationSeconds,
          sourceDeletedAt: null,
        },
      },
    };

    if (isPrimaryAudio) {
      Object.assign(updatePayload, {
        status: "uploaded",
        transcript_status: "queued",
        storage_bucket: "meeting-recordings",
        storage_path: storagePath,
        audio_mime_type: recordingResponse.headers.get("content-type") || "audio/wav",
        file_size: audio.size,
        duration_seconds: durationSeconds,
      });
    }

    const { error: updateRecordingError } = await admin
      .from("meeting_recordings")
      .update(updatePayload)
      .eq("id", meetingRecording.id)
      .eq("organization_id", session.organization_id);
    if (updateRecordingError) throw new Error(updateRecordingError.message);
  }

  const deleteResponse = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.json`,
    { method: "DELETE", headers: { Authorization: basicAuthorization(apiKeySid, apiKeySecret) } }
  );
  if (!deleteResponse.ok && deleteResponse.status !== 404) {
    throw new Error(`Twilio recording deletion failed with status ${deleteResponse.status}.`);
  }

  const { error: finalizedRecordingError } = await admin
    .from("meeting_recordings")
    .update({
      metadata: {
        ...metadata,
        meeting_sources: {
          ...((metadata.meeting_sources || {}) as Record<string, unknown>),
          phone_call: true,
        },
        phoneMeeting: {
          ...savedPhoneMeeting,
          source: "twilio",
          recordingSid,
          storagePath,
          storageBucket: "meeting-recordings",
          sourceDeletedAt: new Date().toISOString(),
        },
      },
    })
    .eq("id", meetingRecording.id)
    .eq("organization_id", session.organization_id);
  if (finalizedRecordingError) throw new Error(finalizedRecordingError.message);

  await updateSession(admin, session.id, {
    status: "recording_ready",
    twilio_recording_sid: recordingSid,
    duration_seconds: durationSeconds,
    metadata: {
      ...(session.metadata || {}),
      twilioRecordingDeletedAt: new Date().toISOString(),
      transcriptionStatus: "queued",
    },
  });

  if (durationSeconds) {
    const { data: priorUsage, error: priorUsageError } = await admin
      .from("phone_meeting_usage_events")
      .select("id")
      .eq("phone_meeting_session_id", session.id)
      .eq("event_type", "call_minute")
      .maybeSingle();
    if (priorUsageError) throw new Error(priorUsageError.message);
    if (!priorUsage) {
      const { error: usageError } = await admin.from("phone_meeting_usage_events").insert({
        organization_id: session.organization_id,
        phone_meeting_session_id: session.id,
        event_type: "call_minute",
        quantity: Math.ceil(durationSeconds / 60),
        unit: "minute",
        source: "internal",
        metadata: { recording_sid: recordingSid, duration_seconds: durationSeconds, internal_test: true },
      });
      if (usageError) throw new Error(usageError.message);
    }
  }
}

Deno.serve(async (request) => {
  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  try {
    const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = getServiceRoleKey();
    if (!authToken || !supabaseUrl || !serviceRoleKey) {
      console.error("Twilio Phone Meetings callback is missing required server configuration.");
      return new Response("Configuration error", { status: 500 });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

    const isControlRequest = request.headers.get("content-type")?.includes("application/json") && !request.headers.get("x-twilio-signature");
    if (isControlRequest) {
      const body = await request.json().catch(() => null) as { action?: string; organization_id?: string; meeting_recording_id?: string } | null;
      if (body?.action !== "start_session") return new Response("Unsupported action", { status: 400 });
      const result = await startPhoneMeetingSession(request, admin, body);
      return Response.json(result);
    }

    const signature = request.headers.get("x-twilio-signature");
    const rawBody = await request.text();
    const parameters = new URLSearchParams(rawBody);
    if (!signature || !(await verifyTwilioSignature(request.url, parameters, signature, authToken))) {
      return new Response("Invalid signature", { status: 403 });
    }

    const requestUrl = new URL(request.url);
    const mode = requestUrl.searchParams.get("mode") || "";
    const sessionId = requestUrl.searchParams.get("session");
    const callSid = parameters.get("CallSid");
    const recordingSid = parameters.get("RecordingSid");
    const dialedNumber = normalizePhoneNumber(parameters.get("To"));

    if (mode === "join") {
      const settings = await loadEnabledSettingsByNumber(admin, dialedNumber);
      const code = String(parameters.get("Digits") || "").trim();
      const session = settings && /^\d{6}$/.test(code) ? await loadSessionByCode(admin, settings.organization_id, code) : null;
      if (!settings || !session) return xmlResponse("That meeting code is not active. Goodbye.");
      if (session.twilio_call_sid && session.twilio_call_sid !== callSid) return xmlResponse("That meeting code is already in use. Goodbye.");
      await updateSession(admin, session.id, { twilio_call_sid: callSid, status: "connecting" });
      const notice = settings.recording_notice_enabled
        ? `${settings.recording_notice_text} Press 1 to agree and begin recording. Press 2 to decline.`
        : "Press 1 to begin recording. Press 2 to decline.";
      return xmlGather(notice, callbackUrl(request, "consent", session.id), { numDigits: 1, timeout: 15 });
    }

    if (mode === "consent") {
      const session = await loadSessionById(admin, sessionId);
      if (!session || !callSid || session.twilio_call_sid !== callSid) return xmlResponse("This phone meeting is no longer active.");
      const settings = await loadEnabledSettings(admin, session.organization_id);
      if (!settings || (dialedNumber && settings.primary_phone_number && dialedNumber !== settings.primary_phone_number)) {
        return xmlResponse("Phone meetings are not available for this organization.");
      }
      if (parameters.get("Digits") !== "1") {
        await updateSession(admin, session.id, { status: "canceled", ended_at: new Date().toISOString(), failure_code: "recording_consent_declined" });
        return xmlResponse("Recording consent was not provided. Goodbye.");
      }
      await updateSession(admin, session.id, { status: "in_progress", started_at: new Date().toISOString() });
      return xmlRecord(
        "Recording will begin after the tone. Hang up when the meeting is complete.",
        callbackUrl(request, "recording_finished", session.id),
        callbackUrl(request, "recording_status", session.id)
      );
    }

    if (mode === "recording_finished") {
      return xmlResponse("Thank you. Your recording is being transferred securely to N3XRA Records.");
    }

    if (!mode) {
      const settings = await loadEnabledSettingsByNumber(admin, dialedNumber);
      if (!settings || !(await hasActiveDialInSession(admin, settings.organization_id))) {
        return xmlResponse("There is no active N3XRA meeting for this call.");
      }
      return xmlGather("Welcome to N3XRA Records. Enter your six digit meeting code.", callbackUrl(request, "join"));
    }

    const session = await loadSessionById(admin, sessionId) || await loadSession(admin, callSid, recordingSid);

    // This is deliberate: an inbound call cannot create a session, enable an org,
    // or invoke any paid service. A server-created, enabled session must exist first.
    if (!session) return xmlResponse("There is no active N3XRA meeting for this call.");

    const settings = await loadEnabledSettings(admin, session.organization_id);
    if (!settings || (dialedNumber && settings.primary_phone_number && dialedNumber !== settings.primary_phone_number)) {
      return xmlResponse("Phone meetings are not available for this organization.");
    }

    const callStatus = String(parameters.get("CallStatus") || "").toLowerCase();
    const recordingStatus = String(parameters.get("RecordingStatus") || "").toLowerCase();
    const rawDuration = Number(parameters.get("RecordingDuration") || parameters.get("CallDuration") || 0);
    const durationSeconds = Number.isFinite(rawDuration) && rawDuration >= 0 ? Math.round(rawDuration) : null;

    if (recordingSid && recordingStatus === "completed") {
      const recordingUrl = String(parameters.get("RecordingUrl") || "").trim();
      if (!recordingUrl) throw new Error("Recording completion callback did not contain a recording URL.");
      await storeCompletedRecording(admin, session, recordingUrl, recordingSid, durationSeconds);
      return xmlResponse();
    }

    if (callStatus === "in-progress") {
      await updateSession(admin, session.id, { status: "in_progress", started_at: new Date().toISOString() });
    } else if (["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus)) {
      await updateSession(admin, session.id, {
        status: ["busy", "failed", "no-answer"].includes(callStatus) ? "failed" : "recording_ready",
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        failure_code: ["busy", "failed", "no-answer"].includes(callStatus) ? callStatus : null,
      });
    }

    return xmlResponse();
  } catch (error) {
    console.error("Twilio Phone Meetings callback failed", error instanceof Error ? error.message : error);
    // A non-2xx response tells Twilio to retry. This is essential if the copy
    // succeeded but Twilio deletion did not, so the source cannot be left behind.
    return new Response("Temporary processing error", { status: 500 });
  }
});
