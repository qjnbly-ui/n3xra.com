const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_ANON_KEY = String(
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ""
).trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();

const GROQ_TRANSCRIPTION_MODEL = String(process.env.GROQ_RECORDS_TRANSCRIPTION_MODEL || "whisper-large-v3-turbo").trim();
const RECORDINGS_BUCKET = "meeting-recordings";
const DOCUMENTS_BUCKET = "documents";
const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

function parseJson(req) {
  if (req.body && typeof req.body === "object") return Promise.resolve(req.body);
  if (typeof req.body === "string") {
    try {
      return Promise.resolve(JSON.parse(req.body || "{}"));
    } catch (_error) {
      return Promise.resolve({});
    }
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function getBearerToken(req) {
  const header = req.headers.authorization || req.headers.Authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : "";
}

function serviceHeaders(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function encodeFilter(value) {
  return encodeURIComponent(String(value || ""));
}

function encodeStoragePath(bucket, path) {
  return `${encodeURIComponent(bucket)}/${String(path || "").split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchSupabaseJson(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const message = String(data?.message || data?.error || data?.msg || `Supabase request failed with status ${response.status}.`);
    throw new Error(message);
  }

  return data;
}

function isLegacyDocumentUserColumnError(error) {
  const message = String(error?.message || "").toLowerCase();
  return (
    (message.includes("user_id") && message.includes("not-null")) ||
    message.includes('null value in column "user_id"') ||
    (message.includes("uploaded_by_user_id") && message.includes("does not exist")) ||
    (message.includes("uploaded_by_user_id") && message.includes("schema cache"))
  );
}

async function writeDocumentWithUserFallback(url, options, payload, userId) {
  try {
    return await fetchSupabaseJson(url, {
      ...options,
      body: JSON.stringify({
        ...payload,
        uploaded_by_user_id: userId,
      }),
    });
  } catch (error) {
    if (!isLegacyDocumentUserColumnError(error)) throw error;
    return fetchSupabaseJson(url, {
      ...options,
      body: JSON.stringify({
        ...payload,
        user_id: userId,
      }),
    });
  }
}

async function verifyUser(token) {
  if (!token) throw new Error("Authentication required.");
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) throw new Error("Missing Supabase auth config.");

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.id) throw new Error("Invalid session.");
  return data;
}

async function loadRecording(recordingId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/meeting_recordings?select=*&id=eq.${encodeFilter(recordingId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadOrganization(organizationId) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/organizations?select=id,name,owner_user_id,subscription_tier&id=eq.${encodeFilter(organizationId)}&limit=1`,
    { headers: serviceHeaders() }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function userCanTranscribeRecording(organization, user) {
  if (!organization?.id || !user?.id) return false;

  const [membershipRows, adminRows] = await Promise.all([
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/organization_memberships?select=role&organization_id=eq.${encodeFilter(organization.id)}&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    ),
    fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/platform_admins?select=user_id&user_id=eq.${encodeFilter(user.id)}&limit=1`,
      { headers: serviceHeaders() }
    ),
  ]);

  const isPlatformAdmin = Array.isArray(adminRows) && adminRows.length > 0;
  if (isPlatformAdmin) return true;

  const role = String(Array.isArray(membershipRows) ? membershipRows[0]?.role || "" : "").trim();
  const hasRole = ["account_owner", "account_admin", "editor"].includes(role) || organization.owner_user_id === user.id;
  return hasRole && organization.subscription_tier === "organization";
}

function monthName(date) {
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "long", timeZone: "UTC" }).format(date);
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "recording-transcript";
}

async function updateRecording(recordingId, patch) {
  const rows = await fetchSupabaseJson(
    `${SUPABASE_URL}/rest/v1/meeting_recordings?id=eq.${encodeFilter(recordingId)}`,
    {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    }
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function downloadRecordingAudio(recording) {
  if (!recording?.storage_path) throw new Error("No audio file is stored for this recording.");
  const url = `${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(RECORDINGS_BUCKET, recording.storage_path)}`;
  const response = await fetch(url, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || "Unable to download recording audio.");
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_AUDIO_BYTES) {
    throw new Error("This audio file is larger than the transcription limit.");
  }
  return arrayBuffer;
}

async function transcribeAudio(arrayBuffer, recording) {
  const groqApiKey = String(process.env.GROQ_RECORDS_API_KEY || "").trim();
  if (!groqApiKey) throw new Error("Missing GROQ_RECORDS_API_KEY.");

  const fileName = String(recording.storage_path || "recording.webm").split("/").pop() || "recording.webm";
  const form = new FormData();
  form.append("model", GROQ_TRANSCRIPTION_MODEL);
  form.append("temperature", "0");
  form.append("response_format", "json");
  form.append("file", new Blob([arrayBuffer], { type: recording.audio_mime_type || "audio/webm" }), fileName);

  const response = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${groqApiKey}`,
    },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(data?.error?.message || data?.message || "Unable to transcribe recording."));
  }
  const text = String(data?.text || "").trim();
  if (!text) throw new Error("Transcription returned no text.");
  return text;
}

async function uploadTranscriptDocument(recording, user, transcriptText) {
  const startedAt = recording.started_at || recording.created_at;
  const date = startedAt ? new Date(startedAt) : null;
  const year = date && !Number.isNaN(date.getTime()) ? String(date.getUTCFullYear()) : "";
  const month = monthName(date);
  const title = `${recording.title || "Untitled recording"} Transcript`;
  const fileName = `${slugify(recording.title)}-transcript.txt`;
  const storagePath = `${recording.organization_id}/recording-transcripts/${recording.id}.txt`;
  const textBody = [
    title,
    startedAt ? `Recorded: ${new Date(startedAt).toISOString()}` : "",
    "",
    transcriptText,
  ].filter((line, index) => index > 1 || line).join("\n");
  const fileSize = Buffer.byteLength(textBody, "utf8");

  const uploadResponse = await fetch(`${SUPABASE_URL}/storage/v1/object/${encodeStoragePath(DOCUMENTS_BUCKET, storagePath)}`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "text/plain; charset=utf-8",
      "x-upsert": "true",
    },
    body: textBody,
  });
  if (!uploadResponse.ok) {
    const text = await uploadResponse.text().catch(() => "");
    throw new Error(text || "Unable to save transcript file.");
  }

  const documentPayload = {
    organization_id: recording.organization_id,
    title,
    original_filename: fileName,
    storage_path: storagePath,
    mime_type: "text/plain",
    file_size: fileSize,
    year,
    month,
    is_public: false,
    status: "ready",
    processing_error: null,
    extracted_text: transcriptText,
  };

  let existingDocumentId = recording.document_id || "";
  if (!existingDocumentId) {
    const existingRows = await fetchSupabaseJson(
      `${SUPABASE_URL}/rest/v1/documents?select=id&storage_path=eq.${encodeFilter(storagePath)}&limit=1`,
      { headers: serviceHeaders() }
    );
    existingDocumentId = Array.isArray(existingRows) ? existingRows[0]?.id || "" : "";
  }

  if (existingDocumentId) {
    const rows = await writeDocumentWithUserFallback(
      `${SUPABASE_URL}/rest/v1/documents?id=eq.${encodeFilter(existingDocumentId)}`,
      {
        method: "PATCH",
        headers: serviceHeaders({ Prefer: "return=representation" }),
      },
      documentPayload,
      user.id
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  }

  const rows = await writeDocumentWithUserFallback(
    `${SUPABASE_URL}/rest/v1/documents`,
    {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=representation" }),
    },
    documentPayload,
    user.id
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: "Missing Supabase service config." });
  }

  let user = null;
  try {
    user = await verifyUser(getBearerToken(req));
  } catch (error) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication required." });
  }

  let recording = null;
  try {
    const body = await parseJson(req);
    const recordingId = String(body.recordingId || "").trim();
    if (!recordingId) return res.status(400).json({ error: "recordingId is required." });

    recording = await loadRecording(recordingId);
    if (!recording) return res.status(404).json({ error: "Recording not found." });

    const organization = await loadOrganization(recording.organization_id);
    if (!organization) return res.status(404).json({ error: "Recording library not found." });
    if (!(await userCanTranscribeRecording(organization, user))) {
      return res.status(403).json({ error: "You do not have access to transcribe this recording." });
    }

    await updateRecording(recording.id, {
      status: "transcribing",
      transcript_status: "processing",
      processing_error: null,
    });

    const audio = await downloadRecordingAudio(recording);
    const transcriptText = await transcribeAudio(audio, recording);
    const document = await uploadTranscriptDocument(recording, user, transcriptText);
    const updatedRecording = await updateRecording(recording.id, {
      document_id: document?.id || recording.document_id || null,
      status: "ready",
      transcript_status: "ready",
      transcript_text: transcriptText,
      transcript_generated_at: new Date().toISOString(),
      processing_error: null,
    });

    return res.status(200).json({
      recording: updatedRecording,
      document,
      transcriptLength: transcriptText.length,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to transcribe recording.";
    if (recording?.id) {
      await updateRecording(recording.id, {
        status: recording.storage_path ? "uploaded" : "failed",
        transcript_status: "failed",
        processing_error: message,
      }).catch(() => null);
    }
    return res.status(500).json({ error: message });
  }
}

module.exports = handler;
module.exports.config = {
  maxDuration: 60,
};
