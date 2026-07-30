import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";

type PhoneMeetingSession = {
  id: string;
  organization_id: string;
  meeting_recording_id: string | null;
  twilio_call_sid: string | null;
  twilio_recording_sid: string | null;
  status: string;
  duration_seconds?: number | null;
  metadata: Record<string, unknown> | null;
};

type PhoneMeetingSettings = {
  organization_id: string;
  feature_enabled: boolean;
  activation_status: string;
  primary_phone_number: string | null;
  allowed_start_roles?: string[] | null;
};

type EnabledPhoneMeetingSettings = PhoneMeetingSettings & {
  recording_notice_enabled: boolean;
  recording_notice_text: string;
  default_retention_days: number;
};

const TWIML_HEADERS = { "Content-Type": "text/xml; charset=utf-8" };
// The browser starts a phone session through supabase-js, while Twilio posts
// server-to-server callbacks. Session creation is still authorized inside the
// function; these headers simply let the Records app receive that response.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ACTIVE_STATUSES = new Set(["ready_for_internal_test", "active"]);
const PHONE_MEETING_STATUSES = new Set(["not_configured", "pending_compliance", "ready_for_internal_test", "active", "suspended", "disabled"]);
const PUBLIC_FUNCTION_PATH = "/functions/v1/twilio-phone-meetings";

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

function publicFunctionUrl(request?: Request) {
  const configuredUrl = Deno.env.get("TWILIO_PHONE_MEETINGS_PUBLIC_URL")?.trim();
  if (configuredUrl) return new URL(configuredUrl);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  if (supabaseUrl) return new URL(PUBLIC_FUNCTION_PATH, supabaseUrl);
  if (request) return new URL(request.url);
  throw new Error("The public Twilio Phone Meetings URL is not configured.");
}

function callbackUrl(request: Request, mode: string, sessionId?: string) {
  // Edge gateways can expose an internal runtime URL to the function. Twilio
  // must always receive the public endpoint configured in its Console.
  const url = publicFunctionUrl(request);
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
    for (const value of parameters.getAll(name).sort()) {
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

async function verifyTwilioRequestSignature(request: Request, parameters: URLSearchParams, receivedSignature: string, authToken: string) {
  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const candidateBases = new Set<string>([
    requestUrl.toString(),
    publicFunctionUrl(request).toString(),
  ]);
  if (forwardedHost) {
    const forwardedUrl = new URL(requestUrl.toString());
    forwardedUrl.protocol = "https:";
    forwardedUrl.host = forwardedHost;
    candidateBases.add(forwardedUrl.toString());
  }

  // Twilio signs the literal webhook URL saved in its Console. Supabase may
  // expose an internal runtime URL to the function or normalize the trailing
  // slash. Validate the exact configured public endpoint and those gateway
  // representations without weakening signature verification.
  const candidateUrls = new Set<string>();
  for (const base of candidateBases) {
    const url = new URL(base);
    url.search = requestUrl.search;
    const path = url.pathname.replace(/\/$/, "");
    candidateUrls.add(`${url.origin}${path}${url.search}`);
    candidateUrls.add(`${url.origin}${path}/${url.search}`);
  }

  for (const candidateUrl of candidateUrls) {
    if (await verifyTwilioSignature(candidateUrl, parameters, receivedSignature, authToken)) return true;
  }
  return false;
}

async function assertTwilioPrimaryAuthToken() {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim();
  if (!accountSid || !authToken) throw new Error("Twilio server credentials are incomplete.");

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}.json`, {
    method: "GET",
    headers: { Authorization: basicAuthorization(accountSid, authToken) },
  });
  if (!response.ok) {
    throw new Error("Twilio rejected the primary Auth Token. Update TWILIO_AUTH_TOKEN in Supabase Edge Function secrets.");
  }
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
      .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, duration_seconds, metadata")
      .eq("twilio_recording_sid", recordingSid)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as PhoneMeetingSession;
  }

  if (!callSid) return null;
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, duration_seconds, metadata")
    .eq("twilio_call_sid", callSid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PhoneMeetingSession | null) || null;
}

async function loadSessionById(admin: ReturnType<typeof createClient>, sessionId: string | null) {
  if (!sessionId) return null;
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, duration_seconds, metadata")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as PhoneMeetingSession | null) || null;
}

async function loadEnabledSettings(admin: ReturnType<typeof createClient>, organizationId: string) {
  const { data, error } = await admin
    .from("organization_phone_meeting_settings")
    .select("organization_id, feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days, allowed_start_roles")
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
    .select("organization_id, feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days, allowed_start_roles")
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
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, duration_seconds, metadata")
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
  organizationId: string,
  allowedStartRoles: string[] = ["account_admin", "editor"]
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
  const configuredRoles = Array.isArray(allowedStartRoles)
    ? allowedStartRoles.filter((role) => ["account_admin", "editor"].includes(role))
    : ["account_admin", "editor"];
  const canManage = platformAccess || organization.owner_user_id === user.id || configuredRoles.includes(String(membership?.role || ""));
  if (!canManage || organization.subscription_tier !== "organization") throw new Error("You do not have access to start phone meetings for this library.");
  return user;
}

async function assertPhoneMeetingSettingsAccess(
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
  if (organizationError || membershipError || platformAdminError || !organization) throw new Error("Unable to confirm Phone Meetings settings access.");

  const isPlatformAdmin = ["quentin@n3xra.com", "quentin@quentinnichols.com"].includes(email) || Boolean(platformAdmin);
  const canManage = isPlatformAdmin || organization.owner_user_id === user.id || membership?.role === "account_admin";
  if (!canManage || organization.subscription_tier !== "organization") {
    throw new Error("You do not have access to change Phone Meetings settings for this library.");
  }
  return { isPlatformAdmin };
}

function normalizePhoneMeetingRoles(value: unknown) {
  if (!Array.isArray(value)) throw new Error("Choose which library roles can start phone meetings.");
  const roles = [...new Set(value.map((role) => String(role || "")).filter(Boolean))];
  if (roles.some((role) => !["account_admin", "editor"].includes(role))) {
    throw new Error("Phone Meeting access roles are invalid.");
  }
  return roles;
}

async function updatePhoneMeetingSettings(
  request: Request,
  admin: ReturnType<typeof createClient>,
  input: {
    organization_id?: string;
    feature_enabled?: boolean;
    activation_status?: string;
    primary_phone_number?: string | null;
    allowed_start_roles?: string[];
    recording_notice_enabled?: boolean;
    recording_notice_text?: string;
    default_retention_days?: number;
    monthly_minutes_limit?: number | null;
  }
) {
  const organizationId = String(input.organization_id || "");
  if (!organizationId) throw new Error("A library is required.");
  const access = await assertPhoneMeetingSettingsAccess(request, admin, organizationId);
  const { data: current, error: currentError } = await admin
    .from("organization_phone_meeting_settings")
    .select("feature_enabled, activation_status, primary_phone_number, allowed_start_roles, recording_notice_enabled, recording_notice_text, default_retention_days, monthly_minutes_limit, usage_billing_status")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (currentError) throw new Error(currentError.message);
  if (!current && !access.isPlatformAdmin) {
    throw new Error("N3XRA must configure this library’s phone number before its managers can edit call settings.");
  }

  const allowedStartRoles = normalizePhoneMeetingRoles(input.allowed_start_roles);
  const noticeText = String(input.recording_notice_text || "").trim();
  const retentionDays = Number(input.default_retention_days);
  const monthlyMinutesLimit = input.monthly_minutes_limit === null ? null : Number(input.monthly_minutes_limit);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error("Retention target must be between 1 and 3,650 days.");
  }
  if (!Number.isInteger(monthlyMinutesLimit) && monthlyMinutesLimit !== null) {
    throw new Error("Monthly minute limit must be a whole number or empty.");
  }
  if (monthlyMinutesLimit !== null && monthlyMinutesLimit < 0) {
    throw new Error("Monthly minute limit cannot be negative.");
  }
  if (input.recording_notice_enabled && !noticeText) {
    throw new Error("Enter the recording notice that callers will hear.");
  }

  const libraryUpdates = {
    allowed_start_roles: allowedStartRoles,
    recording_notice_enabled: Boolean(input.recording_notice_enabled),
    recording_notice_text: noticeText || "This call may be recorded for meeting notes.",
    default_retention_days: retentionDays,
    monthly_minutes_limit: monthlyMinutesLimit,
  };

  let result;
  if (access.isPlatformAdmin) {
    const activationStatus = String(input.activation_status || current?.activation_status || "not_configured");
    if (!PHONE_MEETING_STATUSES.has(activationStatus)) throw new Error("Phone Meetings activation status is invalid.");
    const primaryPhoneNumber = normalizePhoneNumber(input.primary_phone_number ?? current?.primary_phone_number ?? null);
    if (primaryPhoneNumber && !/^\+[1-9][0-9]{7,14}$/.test(primaryPhoneNumber)) {
      throw new Error("Use a complete phone number with country code.");
    }
    result = await admin
      .from("organization_phone_meeting_settings")
      .upsert({
        organization_id: organizationId,
        feature_enabled: input.feature_enabled ?? current?.feature_enabled ?? false,
        activation_status: activationStatus,
        primary_phone_number: primaryPhoneNumber,
        ...libraryUpdates,
      }, { onConflict: "organization_id" })
      .select("feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days, allowed_start_roles, monthly_minutes_limit, usage_billing_status, updated_at")
      .single();
  } else {
    result = await admin
      .from("organization_phone_meeting_settings")
      .update(libraryUpdates)
      .eq("organization_id", organizationId)
      .select("feature_enabled, activation_status, primary_phone_number, recording_notice_enabled, recording_notice_text, default_retention_days, allowed_start_roles, monthly_minutes_limit, usage_billing_status, updated_at")
      .single();
  }
  if (result.error) throw new Error(result.error.message);
  return result.data;
}

async function startPhoneMeetingSession(
  request: Request,
  admin: ReturnType<typeof createClient>,
  input: { organization_id?: string; meeting_recording_id?: string }
) {
  const organizationId = String(input.organization_id || "");
  const meetingRecordingId = String(input.meeting_recording_id || "");
  if (!organizationId || !meetingRecordingId) throw new Error("A library and meeting note are required.");
  const settings = await loadEnabledSettings(admin, organizationId);
  if (!settings?.primary_phone_number) throw new Error("Phone Meetings is not enabled for internal testing in this library.");
  const user = await assertControlAccess(request, admin, organizationId, settings.allowed_start_roles || ["account_admin", "editor"]);
  // Session creation is the earliest authenticated point where N3XRA can
  // verify that webhook signatures will use Twilio's primary Auth Token.
  await assertTwilioPrimaryAuthToken();
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

async function loadAuthorizedControlSession(
  request: Request,
  admin: ReturnType<typeof createClient>,
  input: { organization_id?: string; meeting_recording_id?: string; session_id?: string }
) {
  const organizationId = String(input.organization_id || "");
  const meetingRecordingId = String(input.meeting_recording_id || "");
  const sessionId = String(input.session_id || "");
  if (!organizationId || !meetingRecordingId || !sessionId) {
    throw new Error("A library, meeting note, and phone meeting session are required.");
  }
  await assertControlAccess(request, admin, organizationId);
  const { data, error } = await admin
    .from("phone_meeting_sessions")
    .select("id, organization_id, meeting_recording_id, twilio_call_sid, twilio_recording_sid, status, duration_seconds, metadata")
    .eq("id", sessionId)
    .eq("organization_id", organizationId)
    .eq("meeting_recording_id", meetingRecordingId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("The phone meeting session was not found.");
  return data as PhoneMeetingSession;
}

async function completePhoneMeetingWithoutRecording(
  request: Request,
  admin: ReturnType<typeof createClient>,
  input: { organization_id?: string; meeting_recording_id?: string; session_id?: string }
) {
  const session = await loadAuthorizedControlSession(request, admin, input);
  if (session.twilio_recording_sid) {
    throw new Error("A phone recording exists for this meeting. Retry its secure transfer instead.");
  }
  const transferWaitElapsed = session.status === "copying_to_storage" &&
    Boolean((session.metadata || {}).callEndedAt) &&
    Date.now() - Date.parse(String((session.metadata || {}).callEndedAt)) > 30000;
  if (!["draft", "failed", "canceled"].includes(session.status) && !transferWaitElapsed) {
    throw new Error("End the phone call before completing this meeting without a recording.");
  }

  const { data: meetingRecording, error: meetingRecordingError } = await admin
    .from("meeting_recordings")
    .select("id, storage_path, metadata")
    .eq("id", session.meeting_recording_id)
    .eq("organization_id", session.organization_id)
    .maybeSingle();
  if (meetingRecordingError) throw new Error(meetingRecordingError.message);
  if (!meetingRecording) throw new Error("The linked meeting note was not found.");
  if (meetingRecording.storage_path) {
    throw new Error("This meeting already has a recording attached.");
  }

  const completedAt = new Date().toISOString();
  const metadata = (meetingRecording.metadata || {}) as Record<string, unknown>;
  const { error: updateRecordingError } = await admin
    .from("meeting_recordings")
    .update({
      status: "ready",
      transcript_status: "not_started",
      ai_review_status: "not_started",
      duration_seconds: 0,
      file_size: 0,
      processing_error: null,
      metadata: {
        ...metadata,
        meeting_sources: {
          ...((metadata.meeting_sources || {}) as Record<string, unknown>),
          phone_call: true,
        },
        phoneMeeting: {
          ...((metadata.phoneMeeting || {}) as Record<string, unknown>),
          completedWithoutRecordingAt: completedAt,
        },
      },
    })
    .eq("id", meetingRecording.id)
    .eq("organization_id", session.organization_id);
  if (updateRecordingError) throw new Error(updateRecordingError.message);

  await updateSession(admin, session.id, {
    status: "ready",
    ended_at: completedAt,
    duration_seconds: 0,
    failure_code: "completed_without_recording",
  });
  return {
    session_id: session.id,
    meeting_recording_id: meetingRecording.id,
    status: "ready",
  };
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
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const apiKeySid = Deno.env.get("TWILIO_API_KEY_SID");
  const apiKeySecret = Deno.env.get("TWILIO_API_KEY_SECRET");
  const transferUser = accountSid && authToken ? accountSid : apiKeySid;
  const transferPassword = accountSid && authToken ? authToken : apiKeySecret;
  if (!accountSid || !transferUser || !transferPassword) {
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
  let phoneMeetingMetadata: Record<string, unknown> = {
    ...savedPhoneMeeting,
    source: "twilio",
    recordingSid,
  };
  const isPrimaryAudio = !meetingRecording.storage_path;
  const storagePath = isPrimaryAudio
    ? `${session.organization_id}/${meetingRecording.id}/twilio-${recordingSid}.wav`
    : `${session.organization_id}/${meetingRecording.id}/sources/twilio-${recordingSid}.wav`;

  await updateSession(admin, session.id, {
    status: "copying_to_storage",
    twilio_recording_sid: recordingSid,
    duration_seconds: durationSeconds,
    billed_minutes: durationSeconds ? Math.ceil(durationSeconds / 60) : session.metadata?.billed_minutes || 0,
    failure_code: null,
  });

  if (!savedPhoneMeeting.storagePath) {
    const source = new URL(recordingUrl);
    if (!source.pathname.endsWith(".wav")) source.pathname = `${source.pathname}.wav`;
    const recordingResponse = await fetch(source, {
      headers: { Authorization: basicAuthorization(transferUser, transferPassword) },
    });
    if (!recordingResponse.ok) {
      throw new Error(`Twilio recording download failed with status ${recordingResponse.status}.`);
    }

    const audio = await recordingResponse.blob();
    phoneMeetingMetadata = {
      ...phoneMeetingMetadata,
      storagePath,
      storageBucket: "meeting-recordings",
      mimeType: recordingResponse.headers.get("content-type") || "audio/wav",
      fileSize: audio.size,
      durationSeconds,
      sourceDeletedAt: null,
    };
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
        phoneMeeting: phoneMeetingMetadata,
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
  } else {
    phoneMeetingMetadata = {
      ...phoneMeetingMetadata,
      storagePath: savedPhoneMeeting.storagePath || storagePath,
      storageBucket: savedPhoneMeeting.storageBucket || "meeting-recordings",
      durationSeconds: savedPhoneMeeting.durationSeconds ?? durationSeconds,
    };
  }

  const deleteResponse = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Recordings/${recordingSid}.json`,
    { method: "DELETE", headers: { Authorization: basicAuthorization(transferUser, transferPassword) } }
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
          ...phoneMeetingMetadata,
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
    ended_at: new Date().toISOString(),
    failure_code: null,
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

async function retryPhoneMeetingTransfer(
  request: Request,
  admin: ReturnType<typeof createClient>,
  input: { organization_id?: string; meeting_recording_id?: string; session_id?: string }
) {
  const session = await loadAuthorizedControlSession(request, admin, input);
  if (!session.twilio_recording_sid) {
    throw new Error("Twilio has not supplied a recording for this meeting.");
  }
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim();
  if (!accountSid) throw new Error("Twilio server credentials are incomplete.");
  const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Recordings/${encodeURIComponent(session.twilio_recording_sid)}`;
  await storeCompletedRecording(
    admin,
    session,
    recordingUrl,
    session.twilio_recording_sid,
    session.duration_seconds ?? null
  );
  return {
    session_id: session.id,
    meeting_recording_id: session.meeting_recording_id,
    status: "recording_ready",
  };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { ...CORS_HEADERS, Allow: "POST" } });
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
      const body = await request.json().catch(() => null) as {
        action?: string;
        organization_id?: string;
        meeting_recording_id?: string;
        session_id?: string;
        feature_enabled?: boolean;
        activation_status?: string;
        primary_phone_number?: string | null;
        allowed_start_roles?: string[];
        recording_notice_enabled?: boolean;
        recording_notice_text?: string;
        default_retention_days?: number;
        monthly_minutes_limit?: number | null;
      } | null;
      let result;
      if (body?.action === "start_session") {
        result = await startPhoneMeetingSession(request, admin, body);
      } else if (body?.action === "update_settings") {
        result = await updatePhoneMeetingSettings(request, admin, body);
      } else if (body?.action === "complete_without_recording") {
        result = await completePhoneMeetingWithoutRecording(request, admin, body);
      } else if (body?.action === "retry_recording_transfer") {
        result = await retryPhoneMeetingTransfer(request, admin, body);
      } else {
        return new Response("Unsupported action", { status: 400, headers: CORS_HEADERS });
      }
      return Response.json(result, { headers: CORS_HEADERS });
    }

    const signature = request.headers.get("x-twilio-signature");
    const rawBody = await request.text();
    const parameters = new URLSearchParams(rawBody);
    if (!signature || !(await verifyTwilioRequestSignature(request, parameters, signature, authToken))) {
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
      const session = await loadSessionById(admin, sessionId);
      if (
        session &&
        ["connecting", "in_progress", "copying_to_storage"].includes(session.status) &&
        (!callSid || !session.twilio_call_sid || session.twilio_call_sid === callSid)
      ) {
        const callEndedAt = new Date().toISOString();
        await updateSession(admin, session.id, {
          status: "copying_to_storage",
          ended_at: callEndedAt,
          metadata: {
            ...(session.metadata || {}),
            callEndedAt,
          },
        });
      }
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
      try {
        await storeCompletedRecording(admin, session, recordingUrl, recordingSid, durationSeconds);
      } catch (error) {
        const failureMessage = error instanceof Error ? error.message : "Phone recording transfer failed.";
        await updateSession(admin, session.id, {
          status: "failed",
          ended_at: new Date().toISOString(),
          twilio_recording_sid: recordingSid,
          duration_seconds: durationSeconds,
          failure_code: "recording_transfer_failed",
          failure_message: failureMessage.slice(0, 500),
        });
        if (session.meeting_recording_id) {
          await admin
            .from("meeting_recordings")
            .update({ processing_error: "Phone recording transfer failed. Retry the secure transfer from this meeting." })
            .eq("id", session.meeting_recording_id)
            .eq("organization_id", session.organization_id);
        }
        throw error;
      }
      return xmlResponse();
    }

    if (callStatus === "in-progress") {
      await updateSession(admin, session.id, { status: "in_progress", started_at: new Date().toISOString() });
    } else if (["completed", "busy", "failed", "no-answer", "canceled"].includes(callStatus)) {
      const failedCall = ["busy", "failed", "no-answer"].includes(callStatus);
      await updateSession(admin, session.id, {
        status: failedCall ? "failed" : "canceled",
        ended_at: new Date().toISOString(),
        duration_seconds: durationSeconds,
        failure_code: failedCall ? callStatus : "call_ended_without_recording",
      });
    }

    return xmlResponse();
  } catch (error) {
    console.error("Twilio Phone Meetings callback failed", error instanceof Error ? error.message : error);
    // A non-2xx response tells Twilio to retry. This is essential if the copy
    // succeeded but Twilio deletion did not, so the source cannot be left behind.
    return new Response("Temporary processing error", { status: 500, headers: CORS_HEADERS });
  }
});
