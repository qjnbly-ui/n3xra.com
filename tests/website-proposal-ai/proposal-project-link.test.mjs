import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const adminProposal = fs.readFileSync(new URL("../../n3xra-admin/proposals/proposals-admin.js", import.meta.url), "utf8");

test("admin proposals attach to one unambiguous existing client project", () => {
  assert.match(adminProposal, /const requestProjects = clientProjects\.filter\(\(project\) => project\.request_id === selectedRequest\.id\)/);
  assert.match(adminProposal, /const contextProject = clientProjects\.find\(\(project\) => project\.id === context\.projectId\)/);
  assert.match(adminProposal, /const websiteProjects = clientProjects\.filter\(\(project\) => project\.managed_website_id === context\.websiteId\)/);
  assert.match(adminProposal, /return clientProjects\.length === 1 \? clientProjects\[0\]\.id : null/);
  assert.match(adminProposal, /project_id: resolveMatchingProjectId\(\)/);
});

test("sending repairs a still-unlinked proposal before publishing it", () => {
  assert.match(adminProposal, /if \(!proposal\.project_id\)[\s\S]+update\(\{ project_id: projectId \}\)\.eq\("id", proposal\.id\)/);
  assert.match(adminProposal, /proposal\.project_id = projectId/);
});
