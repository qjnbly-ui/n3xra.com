import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const voiceProfileApi = require("../../api/records-voice-profile.js");
const accountPath = new URL("../../n3xra-records/account/index.html", import.meta.url);
const dashboardPath = new URL("../../n3xra-records/dashboard.js", import.meta.url);
const desktopShellPath = new URL("../../n3xra-records/lib/desktop-shell.js", import.meta.url);
const migrationPath = new URL(
  "../../supabase/migrations/20260805144642_records_voice_profiles.sql",
  import.meta.url,
);

test("voice enrollment validates the supported recording envelope", () => {
  const { decodeAudio, MIN_AUDIO_BYTES, MAX_AUDIO_BYTES } = voiceProfileApi._test;
  const valid = Buffer.alloc(MIN_AUDIO_BYTES, 1);
  const decoded = decodeAudio({
    audioType: "audio/webm;codecs=opus",
    audioBase64: valid.toString("base64"),
  });

  assert.equal(decoded.mimeType, "audio/webm");
  assert.equal(decoded.extension, "webm");
  assert.equal(decoded.audio.length, MIN_AUDIO_BYTES);
  assert.throws(
    () => decodeAudio({ audioType: "text/plain", audioBase64: valid.toString("base64") }),
    /WebM, M4A, MP3, WAV, or OGG/,
  );
  assert.throws(
    () => decodeAudio({ audioType: "audio/webm", audioBase64: Buffer.alloc(MIN_AUDIO_BYTES - 1).toString("base64") }),
    /too short/,
  );
  assert.throws(
    () => decodeAudio({ audioType: "audio/webm", audioBase64: Buffer.alloc(MAX_AUDIO_BYTES + 1).toString("base64") }),
    /too large/,
  );
});

test("voice enrollment is self-service and explicitly consent based", async () => {
  const [account, dashboard, desktopShell] = await Promise.all([
    readFile(accountPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(desktopShellPath, "utf8"),
  ]);

  assert.match(account, /id="voice-profile-consent"/);
  assert.match(account, /I consent to N3XRA creating and storing a biometric voice profile/);
  assert.match(account, /will not be retained by N3XRA/);
  assert.match(dashboard, /audioBase64/);
  assert.match(dashboard, /consent: true/);
  assert.match(dashboard, /method: "DELETE"/);
  assert.match(dashboard, /voice: canSeeVoiceProfiles/);
  assert.match(desktopShell, /\{ label: "Voice profiles", view: "voice" \}/);
  assert.match(desktopShell, /account\.voice.*view=voice.*admin-voice-panel/);
});

test("voiceprints are isolated behind the server role", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.records_voice_profiles from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete on table public\.records_voice_profiles to service_role/);
  assert.match(migration, /Raw enrollment audio is not stored here/);
});
