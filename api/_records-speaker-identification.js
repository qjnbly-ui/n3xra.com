const { randomUUID } = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").trim();
const SUPABASE_SERVICE_ROLE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || "").trim();
const PYANNOTE_API_KEY = String(process.env.PYANNOTE_API_KEY || "").trim();
const PYANNOTE_API_URL = "https://api.pyannote.ai/v1";
const PYANNOTE_MODEL = "precision-2";
// Prefer an unnamed speaker to a wrong name. A deployment may make this stricter,
// but it may never lower the minimum confidence required for an automatic name.
const MATCH_THRESHOLD = Math.max(80, Math.min(100, Number(process.env.PYANNOTE_MATCH_THRESHOLD || 80) || 80));
const MATCH_CONFIDENCE_MARGIN = Math.max(15, Math.min(100, Number(process.env.PYANNOTE_MATCH_CONFIDENCE_MARGIN || 15) || 15));
const MIN_MATCH_SPEECH_SECONDS = Math.max(8, Number(process.env.PYANNOTE_MIN_MATCH_SPEECH_SECONDS || 8) || 8);
const MAX_VOICEPRINTS = 50;

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

async function readJsonResponse(response, fallback) {
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch (_error) {
      data = text;
    }
  }
  if (!response.ok) {
    throw new Error(String(data?.message || data?.error || data?.msg || fallback || `Request failed (${response.status}).`));
  }
  return data;
}

async function serviceRequest(path, options = {}) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error("Missing Supabase service configuration.");
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: serviceHeaders(options.headers || {}),
  });
  return readJsonResponse(response, "Unable to update meeting speaker identification.");
}

async function pyannoteRequest(path, options = {}) {
  if (!PYANNOTE_API_KEY) throw new Error("Speaker identification is not configured yet.");
  const response = await fetch(`${PYANNOTE_API_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${PYANNOTE_API_KEY}`,
      ...(options.body && typeof options.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  return readJsonResponse(response, "pyannoteAI could not identify the meeting speakers.");
}

async function updateRecording(recordingId, patch) {
  const rows = await serviceRequest(`meeting_recordings?id=eq.${encodeFilter(recordingId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(patch),
  });
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function loadEnrolledVoiceprints(organizationId) {
  const organizations = await serviceRequest(
    `organizations?select=id,owner_user_id&id=eq.${encodeFilter(organizationId)}&limit=1`,
  );
  const organization = Array.isArray(organizations) ? organizations[0] || null : null;
  if (!organization) return [];
  const memberships = await serviceRequest(
    `organization_memberships?select=user_id&organization_id=eq.${encodeFilter(organizationId)}`,
  );
  const memberIds = Array.from(new Set([
    organization.owner_user_id,
    ...(Array.isArray(memberships) ? memberships.map((row) => row.user_id) : []),
  ].filter(Boolean))).slice(0, MAX_VOICEPRINTS);
  if (!memberIds.length) return [];

  const [profiles, voiceProfiles] = await Promise.all([
    serviceRequest(`profiles?select=id,full_name,email&id=in.(${memberIds.join(",")})`),
    serviceRequest(
      `records_voice_profiles?select=user_id,voiceprint&status=eq.enrolled&user_id=in.(${memberIds.join(",")})`,
    ),
  ]);
  const profileMap = new Map((Array.isArray(profiles) ? profiles : []).map((profile) => [profile.id, profile]));
  return (Array.isArray(voiceProfiles) ? voiceProfiles : [])
    .filter((profile) => profile.user_id && profile.voiceprint)
    .slice(0, MAX_VOICEPRINTS)
    .map((profile) => ({
      userId: profile.user_id,
      displayName: String(
        profileMap.get(profile.user_id)?.full_name
        || profileMap.get(profile.user_id)?.email
        || "Workspace member",
      ).trim(),
      voiceprint: profile.voiceprint,
    }));
}

async function speakerDetectionIsEnabled(organizationId) {
  const organizations = await serviceRequest(
    `organizations?select=records_speaker_detection_enabled&id=eq.${encodeFilter(organizationId)}&limit=1`,
  );
  const organization = Array.isArray(organizations) ? organizations[0] || null : null;
  return organization?.records_speaker_detection_enabled !== false;
}

function audioExtension(recording) {
  const source = `${recording?.audio_mime_type || ""} ${recording?.storage_path || ""}`.toLowerCase();
  if (source.includes("mpeg") || source.includes("mp3")) return "mp3";
  if (source.includes("m4a")) return "m4a";
  if (source.includes("mp4")) return "mp4";
  if (source.includes("wav")) return "wav";
  if (source.includes("ogg")) return "ogg";
  return "webm";
}

async function submitSpeakerDetection(recording, audio, directory) {
  const objectKey = `records-meeting-identification/${recording.organization_id}/${recording.id}/${Date.now()}-${randomUUID()}.${audioExtension(recording)}`;
  const mediaKey = `media://${objectKey}`;
  const upload = await pyannoteRequest("/media/input", {
    method: "POST",
    body: JSON.stringify({ url: mediaKey }),
  });
  if (!upload?.url) throw new Error("pyannoteAI did not provide an upload location.");
  const uploadResponse = await fetch(upload.url, {
    method: "PUT",
    headers: { "Content-Type": "application/octet-stream" },
    body: audio,
  });
  if (!uploadResponse.ok) throw new Error("The temporary meeting-audio upload failed.");

  const hasVoiceprints = directory.length > 0;
  const job = await pyannoteRequest(hasVoiceprints ? "/identify" : "/diarize", {
    method: "POST",
    body: JSON.stringify({
      url: mediaKey,
      model: PYANNOTE_MODEL,
      exclusive: true,
      turnLevelConfidence: true,
      confidence: true,
      ...(hasVoiceprints ? {
        voiceprints: directory.map((entry) => ({ label: entry.userId, voiceprint: entry.voiceprint })),
        matching: { exclusive: true, threshold: MATCH_THRESHOLD },
      } : {}),
    }),
  });
  if (!job?.jobId) throw new Error("pyannoteAI did not start the speaker-detection job.");
  return { jobId: String(job.jobId), mode: hasVoiceprints ? "identification" : "diarization" };
}

async function waitForJob(jobId, maxWaitMs = 60000) {
  const deadline = Date.now() + Math.max(0, maxWaitMs);
  while (true) {
    const job = await pyannoteRequest(`/jobs/${encodeURIComponent(jobId)}`);
    if (["succeeded", "failed", "canceled"].includes(String(job?.status || ""))) return job;
    if (Date.now() >= deadline) return job;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

function numberValue(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function diarizationKey(turn) {
  return String(turn?.diarizationSpeaker || turn?.diarization_speaker || turn?.speaker || "SPEAKER_UNKNOWN");
}

function confidenceByDiarizationSpeaker(output) {
  const map = new Map();
  (Array.isArray(output?.voiceprints) ? output.voiceprints : []).forEach((entry) => {
    const key = String(entry?.speaker || entry?.diarizationSpeaker || "");
    if (!key) return;
    const scores = Object.entries(entry?.confidence || {})
      .map(([label, score]) => ({ label, score: numberValue(score) }))
      .filter(({ label }) => label)
      .sort((a, b) => b.score - a.score);
    map.set(key, scores);
  });
  return map;
}

function speechSecondsByDiarizationSpeaker(turns) {
  const intervalsBySpeaker = new Map();
  turns.forEach((turn) => {
    const start = numberValue(turn?.start);
    const end = numberValue(turn?.end);
    if (end <= start) return;
    const key = diarizationKey(turn);
    const intervals = intervalsBySpeaker.get(key) || [];
    intervals.push([start, end]);
    intervalsBySpeaker.set(key, intervals);
  });
  return new Map(Array.from(intervalsBySpeaker.entries()).map(([key, intervals]) => {
    const sorted = intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let total = 0;
    let [rangeStart, rangeEnd] = sorted[0];
    sorted.slice(1).forEach(([start, end]) => {
      if (start <= rangeEnd) {
        rangeEnd = Math.max(rangeEnd, end);
        return;
      }
      total += rangeEnd - rangeStart;
      rangeStart = start;
      rangeEnd = end;
    });
    total += rangeEnd - rangeStart;
    return [key, total];
  }));
}

function matchDecision(matchedUserId, sourceSpeaker, directoryMap, confidenceMap, speechSecondsMap) {
  const speechSeconds = speechSecondsMap.get(sourceSpeaker) || 0;
  const scores = confidenceMap.get(sourceSpeaker) || [];
  const matchedConfidence = scores.find(({ label }) => label === matchedUserId)?.score ?? null;
  const runnerUpConfidence = scores.find(({ label }) => label !== matchedUserId)?.score ?? null;
  const evidence = { matchedConfidence, runnerUpConfidence, speechSeconds };
  if (!matchedUserId || !directoryMap.has(matchedUserId)) return { ...evidence, accepted: false, reason: "unmatched" };
  if (matchedConfidence === null) return { ...evidence, accepted: false, reason: "missing_confidence" };
  if (speechSeconds < MIN_MATCH_SPEECH_SECONDS) return { ...evidence, accepted: false, reason: "insufficient_speech" };
  if (matchedConfidence < MATCH_THRESHOLD) return { ...evidence, accepted: false, reason: "low_confidence" };
  if (runnerUpConfidence !== null && matchedConfidence - runnerUpConfidence < MATCH_CONFIDENCE_MARGIN) {
    return { ...evidence, accepted: false, reason: "ambiguous" };
  }
  return { ...evidence, accepted: true, reason: "matched" };
}

function normalizeIdentificationTurns(output, directory) {
  const directoryMap = new Map(directory.map((entry) => [entry.userId, entry.displayName]));
  const confidenceMap = confidenceByDiarizationSpeaker(output);
  const unknownNames = new Map();
  let unknownCount = 0;
  const rawTurns = [output?.identification, output?.exclusiveDiarization, output?.exclusive_diarization, output?.diarization]
    .find((turns) => Array.isArray(turns)) || [];
  const speechSecondsMap = speechSecondsByDiarizationSpeaker(rawTurns);
  return rawTurns
    .map((turn) => {
      const start = numberValue(turn?.start);
      const end = numberValue(turn?.end);
      if (end <= start) return null;
      const sourceSpeaker = diarizationKey(turn);
      const matchedUserId = String(turn?.match || "");
      const decision = matchDecision(matchedUserId, sourceSpeaker, directoryMap, confidenceMap, speechSecondsMap);
      const userId = decision.accepted ? matchedUserId : null;
      if (!userId && !unknownNames.has(sourceSpeaker)) {
        unknownCount += 1;
        unknownNames.set(sourceSpeaker, `Speaker ${unknownCount}`);
      }
      return {
        start,
        end,
        speakerKey: userId ? `user:${userId}` : `unknown:${sourceSpeaker}`,
        displayName: userId ? directoryMap.get(userId) : unknownNames.get(sourceSpeaker),
        userId,
        candidateUserId: directoryMap.has(matchedUserId) ? matchedUserId : null,
        confidence: userId ? decision.matchedConfidence : null,
        matchDecision: decision.reason,
        candidateConfidence: decision.matchedConfidence,
        runnerUpConfidence: decision.runnerUpConfidence,
        speechSeconds: decision.speechSeconds,
        sourceSpeaker,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function bestTurnForRange(start, end, turns) {
  const midpoint = start + Math.max(end - start, 0) / 2;
  let best = null;
  let bestOverlap = 0;
  turns.forEach((turn) => {
    const overlap = Math.max(0, Math.min(end, turn.end) - Math.max(start, turn.start));
    if (overlap > bestOverlap || (!best && midpoint >= turn.start && midpoint <= turn.end)) {
      best = turn;
      bestOverlap = overlap;
    }
  });
  return best;
}

function joinWords(words) {
  return words
    .map((word) => String(word || "").trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?%])/g, "$1")
    .replace(/([([{])\s+/g, "$1")
    .trim();
}

function formatTimestamp(seconds) {
  const total = Math.max(0, Math.floor(numberValue(seconds)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function speakerTranscriptFromUtterances(utterances) {
  return (Array.isArray(utterances) ? utterances : [])
    .filter((utterance) => utterance?.text)
    .map((utterance) => `${utterance.displayName || "Unknown speaker"} [${formatTimestamp(utterance.start)}]\n${utterance.text}`)
    .join("\n\n");
}

function buildSpeakerTranscript(timing, output, directory) {
  const turns = normalizeIdentificationTurns(output, directory);
  if (!turns.length) return { text: "", utterances: [], speakerTurns: [] };
  const words = Array.isArray(timing?.words) ? timing.words : [];
  const segments = Array.isArray(timing?.segments) ? timing.segments : [];
  const units = words.length
    ? words.map((word) => ({ start: numberValue(word.start), end: numberValue(word.end), text: word.word || word.text || "" }))
    : segments.map((segment) => ({ start: numberValue(segment.start), end: numberValue(segment.end), text: segment.text || "" }));
  const utterances = [];
  units.forEach((unit) => {
    const speaker = bestTurnForRange(unit.start, unit.end, turns);
    const speakerKey = speaker?.speakerKey || "unknown:unassigned";
    const displayName = speaker?.displayName || "Unknown speaker";
    const previous = utterances[utterances.length - 1];
    const shouldAppend = previous
      && previous.speakerKey === speakerKey
      && unit.start - previous.end < 2.5
      && unit.end - previous.start < 30;
    if (shouldAppend) {
      previous.tokens.push(unit.text);
      previous.end = Math.max(previous.end, unit.end);
      return;
    }
    utterances.push({
      speakerKey,
      displayName,
      userId: speaker?.userId || null,
      confidence: speaker?.confidence || null,
      start: unit.start,
      end: unit.end,
      tokens: [unit.text],
    });
  });
  const normalizedUtterances = utterances
    .map((utterance) => ({ ...utterance, text: joinWords(utterance.tokens) }))
    .filter((utterance) => utterance.text)
    .map(({ tokens: _tokens, ...utterance }) => utterance);
  return {
    text: speakerTranscriptFromUtterances(normalizedUtterances),
    utterances: normalizedUtterances,
    speakerTurns: turns,
  };
}

function jobFailureMessage(job) {
  return String(job?.output?.error || job?.error || "Speaker identification failed.").slice(0, 500);
}

async function finalizeIdentificationJob(recording, job, directory, timing) {
  if (job?.status !== "succeeded") {
    if (["failed", "canceled"].includes(String(job?.status || ""))) {
      return updateRecording(recording.id, {
        speaker_identification_status: "failed",
        speaker_identification_error: jobFailureMessage(job),
        speaker_identification_updated_at: new Date().toISOString(),
      });
    }
    return updateRecording(recording.id, {
      speaker_identification_status: "processing",
      speaker_identification_updated_at: new Date().toISOString(),
    });
  }

  const result = buildSpeakerTranscript(timing, job.output || {}, directory);
  if (!result.text) {
    return updateRecording(recording.id, {
      speaker_identification_status: "failed",
      speaker_identification_error: "No identifiable speech turns were returned.",
      speaker_identification_updated_at: new Date().toISOString(),
    });
  }
  const completedAt = new Date().toISOString();
  return updateRecording(recording.id, {
    speaker_identification_status: "ready",
    speaker_transcript_text: result.text,
    speaker_identification_json: {
      provider: "pyannote",
      model: PYANNOTE_MODEL,
      mode: directory.length ? "identification" : "diarization",
      threshold: directory.length ? MATCH_THRESHOLD : null,
      confidenceMargin: directory.length ? MATCH_CONFIDENCE_MARGIN : null,
      minimumMatchSpeechSeconds: directory.length ? MIN_MATCH_SPEECH_SECONDS : null,
      candidateProfileCount: directory.length,
      speakers: Array.from(new Map(result.speakerTurns.map((turn) => [turn.speakerKey, {
        speakerKey: turn.speakerKey,
        displayName: turn.displayName,
        userId: turn.userId,
        candidateUserId: turn.candidateUserId,
        confidence: turn.confidence,
        matchDecision: turn.matchDecision,
        candidateConfidence: turn.candidateConfidence,
        runnerUpConfidence: turn.runnerUpConfidence,
        speechSeconds: turn.speechSeconds,
      }])).values()),
      utterances: result.utterances,
    },
    speaker_identification_error: null,
    speaker_identified_at: completedAt,
    speaker_identification_updated_at: completedAt,
  });
}

async function identifyRecordingSpeakers(recording, audio, timing, { maxWaitMs = 60000 } = {}) {
  const now = new Date().toISOString();
  if (!PYANNOTE_API_KEY) {
    return updateRecording(recording.id, {
      speaker_identification_status: "skipped",
      speaker_identification_error: "Speaker identification is not configured.",
      speaker_identification_updated_at: now,
    });
  }
  if (!(await speakerDetectionIsEnabled(recording.organization_id))) {
    return updateRecording(recording.id, {
      speaker_identification_status: "skipped",
      speaker_identification_error: "Speaker detection is disabled in AI settings.",
      speaker_identification_updated_at: now,
    });
  }
  const directory = await loadEnrolledVoiceprints(recording.organization_id);

  try {
    const { jobId, mode } = await submitSpeakerDetection(recording, audio, directory);
    await updateRecording(recording.id, {
      speaker_identification_status: "processing",
      speaker_identification_job_id: jobId,
      speaker_identification_model: PYANNOTE_MODEL,
      speaker_identification_threshold: mode === "identification" ? MATCH_THRESHOLD : null,
      speaker_identification_error: null,
      speaker_identification_updated_at: new Date().toISOString(),
    });
    const job = await waitForJob(jobId, maxWaitMs);
    return finalizeIdentificationJob(recording, job, directory, timing);
  } catch (error) {
    return updateRecording(recording.id, {
      speaker_identification_status: "failed",
      speaker_identification_error: String(error?.message || "Speaker identification failed.").slice(0, 500),
      speaker_identification_updated_at: new Date().toISOString(),
    });
  }
}

async function refreshIdentification(recording, { maxWaitMs = 20000 } = {}) {
  if (!recording?.speaker_identification_job_id || recording.speaker_identification_status !== "processing") return recording;
  const directory = await loadEnrolledVoiceprints(recording.organization_id);
  const job = await waitForJob(recording.speaker_identification_job_id, maxWaitMs);
  return finalizeIdentificationJob(recording, job, directory, recording.transcript_timing_json || {});
}

module.exports = {
  identifyRecordingSpeakers,
  refreshIdentification,
  buildSpeakerTranscript,
  normalizeIdentificationTurns,
  speakerTranscriptFromUtterances,
  speakerDetectionIsEnabled,
  MATCH_THRESHOLD,
  MATCH_CONFIDENCE_MARGIN,
  MIN_MATCH_SPEECH_SECONDS,
};
