import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { contextCanAccessAdminOnly } = require("../../api/_records-support-access.js");
const migrationPath = new URL("../../supabase/migrations/20260812043254_admin_only_meeting_records_restrictive.sql", import.meta.url);
const scopeMigrationPath = new URL("../../supabase/migrations/20260812053322_scope_admin_only_meeting_content_after_document_enforced.sql", import.meta.url);
const accountPath = new URL("../../n3xra-records/account/index.html", import.meta.url);
const dashboardPath = new URL("../../n3xra-records/dashboard.js", import.meta.url);
const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const allRecordingsPath = new URL("../../n3xra-records/all-recordings.js", import.meta.url);
const transcriptionPath = new URL("../../api/transcribe-recording.js", import.meta.url);

test("admin-only meeting access permits account admins and explicitly authorized support", () => {
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "account_owner" }, "can_view_recordings"), true);
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "account_admin" }, "can_view_recordings"), true);
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "editor" }, "can_view_recordings"), false);
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "viewer" }, "can_view_recordings"), false);
  assert.equal(contextCanAccessAdminOnly({ isMember: false, isPlatformAdmin: true, grant: { can_view_recordings: true } }, "can_view_recordings"), true);
  assert.equal(contextCanAccessAdminOnly({ isMember: false, isPlatformAdmin: true, grant: null }, "can_view_recordings"), false);
});

test("meeting privacy protects content while preserving meeting-note detail rows", async () => {
  const [migration, scopeMigration] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(scopeMigrationPath, "utf8"),
  ]);

  assert.match(migration, /records_admin_only_meetings_enabled boolean not null default false/);
  assert.match(migration, /meeting_recordings[\s\S]*admin_only boolean not null default false/);
  assert.match(migration, /documents[\s\S]*admin_only boolean not null default false/);
  assert.match(migration, /before insert on public\.meeting_recordings/);
  assert.match(migration, /private\.can_read_admin_only_records_storage_object/);
  assert.match(migration, /document\.storage_path = input_name/);
  assert.match(migration, /recording\.id::text = split_part\(input_name, '\/', 2\)/);
  assert.match(scopeMigration, /drop policy if exists "meeting_recordings_admin_only_select"/);
  assert.match(scopeMigration, /sync_organization_meeting_content_privacy/);
  assert.match(scopeMigration, /set admin_only = \(new\.records_admin_only_meetings_enabled and document_id is not null\)/);
  assert.match(scopeMigration, /before update of organization_id, document_id/);
  assert.match(scopeMigration, /get_meeting_recording_private_content/);
  assert.match(scopeMigration, /revoke select on public\.meeting_recordings from anon, authenticated/);
  const browserSelectGrant = scopeMigration.match(/grant select \(([\s\S]*?)\) on public\.meeting_recordings to anon, authenticated/)?.[1] || "";
  assert.doesNotMatch(browserSelectGrant, /transcript_text|transcript_timing_json|speaker_transcript_text|speaker_identification_json/);
  assert.match(scopeMigration, /can_read_admin_only_records_storage_object/);
  assert.match(scopeMigration, /recording\.document_id is null and recording\.created_by_user_id/);
});

test("account settings and transcript creation carry the admin-only choice", async () => {
  const [account, dashboard, recordings, allRecordings, transcription] = await Promise.all([
    readFile(accountPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(recordingsPath, "utf8"),
    readFile(allRecordingsPath, "utf8"),
    readFile(transcriptionPath, "utf8"),
  ]);

  assert.match(account, /Keep recordings and transcripts admin-only/);
  assert.match(account, /privacy activates after the transcript document is created/);
  assert.match(account, /still open the Meeting note details/);
  assert.match(dashboard, /records_admin_only_meetings_enabled/);
  assert.match(recordings, /get_meeting_recording_private_content/);
  assert.match(recordings, /Transcript hidden by the account's meeting privacy setting/);
  assert.match(recordings, /show\(recordingDetailPlay, canPlayRecording\)/);
  assert.match(allRecordings, /show\(recordingDetailPlay, canPlayRecording\)/);
  assert.doesNotMatch(recordings, /privacyAllowsRecording/);
  assert.match(transcription, /admin_only: recording\.admin_only === true/);
  assert.match(transcription, /contextCanAccessAdminOnly/);
});
