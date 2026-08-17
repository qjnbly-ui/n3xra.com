import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectFile = (path) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the client shell opens an action-required proposal notice on each new portal visit", async () => {
  const [shell, notice, styles] = await Promise.all([
    projectFile("client-portal/client-shell.js"),
    projectFile("src/client-portal/pending-proposal-notice.ts"),
    projectFile("client-portal/client-shell.css"),
  ]);

  assert.match(shell, /initializePendingProposalNotice/);
  assert.match(notice, /\.eq\("status", "sent"\)/);
  assert.match(notice, /version\.status === "sent"/);
  assert.match(notice, /version\.valid_until >= today/);
  assert.match(notice, /window\.sessionStorage/);
  assert.match(notice, /Review and accept/);
  assert.match(notice, /Ask a question/);
  assert.match(notice, /It will appear again the next time you enter your portal until you respond/);
  assert.match(styles, /\.client-proposal-action-banner/);
  assert.match(styles, /\.client-proposal-action-dialog::backdrop/);
});

test("the proposal notice respects tenant scope and clears as soon as the client responds", async () => {
  const [notice, proposals, portalShell, clientShell] = await Promise.all([
    projectFile("src/client-portal/pending-proposal-notice.ts"),
    projectFile("proposals/proposals.js"),
    projectFile("src/client-portal/portal-shell.ts"),
    projectFile("client-portal/client-shell.js"),
  ]);

  assert.match(notice, /resolvePortalTenant/);
  assert.match(notice, /project\.managed_website_id === tenant\.website_id/);
  assert.match(notice, /n3xra-client-workspace-context/);
  assert.match(notice, /project\.id === context\.projectId/);
  assert.match(notice, /project\.managed_website_id === context\.websiteId/);
  assert.match(clientShell, /initializeClientWorkspaceContext[\s\S]*\.then\(\(\) => initializePendingProposalNotice\(\)\)/);
  assert.match(notice, /n3xra:proposal-resolved/);
  assert.match(proposals, /new CustomEvent\("n3xra:proposal-resolved"/);
  assert.match(portalShell, /clearPendingProposalNoticeDismissals\(\)/);
});
