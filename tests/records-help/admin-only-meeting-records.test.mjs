import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import test from "node:test";

const require = createRequire(import.meta.url);
const { contextCanAccessAdminOnly } = require("../../api/_records-support-access.js");
const migrationPath = new URL("../../supabase/migrations/20260812042150_admin_only_meeting_records.sql", import.meta.url);
const accountPath = new URL("../../n3xra-records/account/index.html", import.meta.url);
const dashboardPath = new URL("../../n3xra-records/dashboard.js", import.meta.url);
const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const transcriptionPath = new URL("../../api/transcribe-recording.js", import.meta.url);

test("admin-only meeting access permits account admins and explicitly authorized support", () => {
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "account_owner" }, "can_view_recordings"), true);
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "account_admin" }, "can_view_recordings"), true);
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "editor" }, "can_view_recordings"), false);
  assert.equal(contextCanAccessAdminOnly({ isMember: true, membershipRole: "viewer" }, "can_view_recordings"), false);
  assert.equal(contextCanAccessAdminOnly({ isMember: false, isPlatformAdmin: true, grant: { can_view_recordings: true } }, "can_view_recordings"), true);
  assert.equal(contextCanAccessAdminOnly({ isMember: false, isPlatformAdmin: true, grant: null }, "can_view_recordings"), false);
});

test("new meeting privacy is snapshotted and enforced for rows and storage", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /records_admin_only_meetings_enabled boolean not null default false/);
  assert.match(migration, /meeting_recordings[\s\S]*admin_only boolean not null default false/);
  assert.match(migration, /documents[\s\S]*admin_only boolean not null default false/);
  assert.match(migration, /before insert on public\.meeting_recordings/);
  assert.match(migration, /as restrictive[\s\S]*for select/);
  assert.match(migration, /not admin_only[\s\S]*organization_role\(organization_id\) = 'account_admin'/);
  assert.match(migration, /private\.can_read_admin_only_records_storage_object/);
  assert.match(migration, /document\.storage_path = input_name/);
  assert.match(migration, /recording\.id::text = split_part\(input_name, '\/', 2\)/);
  assert.match(migration, /meeting_recording_chunks_admin_only_select/);
  assert.match(migration, /meeting_recording_interruptions_admin_only_select/);
});

test("account settings and transcript creation carry the admin-only choice", async () => {
  const [account, dashboard, recordings, transcription] = await Promise.all([
    readFile(accountPath, "utf8"),
    readFile(dashboardPath, "utf8"),
    readFile(recordingsPath, "utf8"),
    readFile(transcriptionPath, "utf8"),
  ]);

  assert.match(account, /Keep new meeting records admin-only/);
  assert.match(account, /Existing meeting records are unchanged/);
  assert.match(dashboard, /records_admin_only_meetings_enabled/);
  assert.match(recordings, /privacyAllowsRecording/);
  assert.match(transcription, /admin_only: recording\.admin_only === true/);
  assert.match(transcription, /contextCanAccessAdminOnly/);
});
