import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const recordingsPath = new URL("../../n3xra-records/recordings.js", import.meta.url);
const recordingsHtmlPath = new URL("../../n3xra-records/recordings.html", import.meta.url);
const allRecordingsHtmlPath = new URL("../../n3xra-records/all-recordings.html", import.meta.url);
const migrationPath = new URL("../../supabase/migrations/20260805043224_transfer_record_packets.sql", import.meta.url);

test("record packets expose an administrator-only destination workflow", async () => {
  const [recordings, recordingsHtml, allRecordingsHtml] = await Promise.all([
    readFile(recordingsPath, "utf8"),
    readFile(recordingsHtmlPath, "utf8"),
    readFile(allRecordingsHtmlPath, "utf8"),
  ]);

  assert.match(recordingsHtml, /id="recording-detail-transfer"[^>]*>Move record packet</);
  assert.match(recordingsHtml, /id="recording-transfer-destination"/);
  assert.match(allRecordingsHtml, /id="recording-detail-transfer-link"/);
  assert.match(recordings, /getMembershipRole\(activeMembership\) !== "account_admin"/);
  assert.match(recordings, /getMembershipRole\(membership\) === "account_admin"/);
  assert.match(recordings, /subscription_tier === "organization"/);
});

test("record packet transfer copies storage before the atomic ownership move and rolls back copies on failure", async () => {
  const recordings = await readFile(recordingsPath, "utf8");

  const copyIndex = recordings.indexOf("copyRecordPacketObject(RECORDINGS_BUCKET");
  const rpcIndex = recordings.indexOf('supabase.rpc("transfer_record_packet"');
  assert.ok(copyIndex >= 0 && rpcIndex > copyIndex);
  assert.match(recordings, /catch \(error\) \{\s*await removeRecordPacketObjects\(copiedObjects\)/);
  assert.match(recordings, /recording\.metadata\?\.phoneMeeting\?\.storagePath/);
  assert.match(recordings, /if \(recordingDetailNotesSaveTimer\)[\s\S]*await saveRecordingDetailNotes\(\)/);
});

test("record packet transfer enforces cross-workspace admin access and keeps an audit trail", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /public\.organization_role\(source_recording\.organization_id\) <> 'account_admin'/);
  assert.match(migration, /public\.organization_role\(input_target_organization_id\) <> 'account_admin'/);
  assert.match(migration, /Finish active recording and processing before moving this record packet/);
  assert.match(migration, /'record_transfer'/);
  assert.match(migration, /revoke all on function public\.transfer_record_packet[\s\S]*from public, anon/);
  assert.match(migration, /grant execute on function public\.transfer_record_packet[\s\S]*to authenticated/);
  assert.match(migration, /update public\.phone_meeting_sessions\s+set meeting_recording_id = null/);
});
