import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const registry = JSON.parse(
  await readFile(new URL("../../api/records-guide-registry.json", import.meta.url), "utf8")
);

test("Records guide behavior is versioned and fail-closed", () => {
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.behaviorVersion, 1);
  assert.deepEqual(registry.safety.allowedEffects, [
    "navigate",
    "highlight",
    "reveal_disclosure",
    "select_tab",
    "select_radio",
  ]);
  assert.ok(registry.safety.prohibitedEffects.includes("submit"));
  assert.ok(registry.safety.prohibitedEffects.includes("delete"));
  assert.ok(registry.safety.prohibitedEffects.includes("start_call"));
});

test("stable target IDs are registered on their canonical pages", () => {
  const meetingNotes = registry.pages.find((page) => page.route === "/n3xra-records/meeting-notes");
  const targetById = new Map(meetingNotes.targets.map((target) => [target.id, target]));

  assert.equal(targetById.get("record-panel-toggle")?.label, "New meeting note");
  assert.equal(targetById.get("meeting-source-browser")?.label, "App recording");
  assert.equal(targetById.get("meeting-source-phone")?.label, "Phone call");
  assert.equal(targetById.get("start-phone-meeting-button")?.label, "Start phone meeting");
});
