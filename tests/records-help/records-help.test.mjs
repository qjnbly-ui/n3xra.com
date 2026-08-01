import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const recordsHelp = require("../../api/records-help.js");

test("the completion budget can finish a concise formatted workflow", () => {
  assert.equal(recordsHelp.RECORDS_HELP_MAX_TOKENS, 650);
});

test("the help prompt explicitly prohibits unverified interface guesses", () => {
  const prompt = recordsHelp.buildSystemPrompt(
    { email: "member@example.com" },
    {
      role: "Viewer",
      plan: "Organization",
      libraryName: "Town Records",
      currentPath: "/n3xra-records/library",
      displayMode: "desktop",
      viewportWidth: 1440,
      viewportHeight: 900,
    }
  );

  assert.match(prompt, /Never invent a button, menu, tab, field, page location, role rule, plan name, limit, feature toggle, or workflow step/);
  assert.match(prompt, /When the supplied knowledge does not verify an exact label or step/);
  assert.match(prompt, /Current role: Viewer/);
  assert.match(prompt, /Current plan: Organization/);
  assert.match(prompt, /persistent left navigation/);
  assert.match(prompt, /not limited to file rows currently visible/);
  assert.match(prompt, /Year and Reset belong to Keyword search and must never be described as Files section filters/);
  assert.match(prompt, /Keyword results update as the user types; there is no Keyword search icon or submit button/);
  assert.match(prompt, /Year dropdown filters saved document-year metadata, not the date a file was added/);
  assert.match(prompt, /File is the only required selection\. Document title, Year, and Month are optional metadata/);
  assert.match(prompt, /Do not send an Editor or Viewer to Manage library > Users/);
  assert.match(prompt, /Do not recommend a named browser unless the supplied product knowledge verifies it/);
  assert.match(prompt, /Account Admin does not automatically mean billing Owner/);
  assert.match(prompt, /Never call it a header-right Profile link/);
  assert.match(prompt, /safe navigation and page-highlighting buttons/);
  assert.match(prompt, /\[\[action:library\.search\]\]/);
});

test("help actions are extracted from an allowlist and removed from answer copy", () => {
  const result = recordsHelp.extractHelpActions(
    "Use the button to open the right area.\n\n[[action:account.ai]]\n[[action:not.allowed]]\n[[action:account.ai]]"
  );

  assert.equal(result.answer, "Use the button to open the right area.");
  assert.deepEqual(result.actions, [{ id: "account.ai", label: "Open AI settings" }]);
});

test("verified role labels come from server-side access context", () => {
  assert.equal(recordsHelp.formatVerifiedRole({ membershipRole: "account_admin" }), "Account Admin");
  assert.equal(recordsHelp.formatVerifiedRole({ membershipRole: "account_owner" }), "Account Admin");
  assert.equal(recordsHelp.formatVerifiedRole({ membershipRole: "editor" }), "Editor");
  assert.equal(recordsHelp.formatVerifiedRole({ membershipRole: "viewer" }), "Viewer");
  assert.equal(recordsHelp.formatVerifiedRole({ isPlatformAdmin: true }), "N3XRA support");
  assert.equal(recordsHelp.formatVerifiedRole({}), "unknown");
});

test("knowledge contains the verified plan and Meeting Notes rules", () => {
  const knowledge = recordsHelp.loadHelpKnowledge();

  assert.match(knowledge, /only current Records plans are \*\*Free\*\*, \*\*Starter\*\*, and \*\*Organization\*\*/);
  assert.match(knowledge, /Meeting Notes requires the active library to be on Organization/);
  assert.match(knowledge, /Viewer on an Organization library can open Meeting Notes but cannot create or change meeting notes/);
  assert.match(knowledge, /\*\*Organization\*\* is \$39 per month or \$375 per year/);
});

test("knowledge preserves exact labels from the corrected workflows", () => {
  const knowledge = recordsHelp.loadHelpKnowledge();

  assert.match(knowledge, /There is no desktop navigation destination labeled \*\*Files\*\* or \*\*Admin Settings\*\*/);
  assert.match(knowledge, /\*\*Workspace\*\* is a fixed group label, not an expandable control/);
  assert.match(knowledge, /exact Files section filter buttons are \*\*All\*\*, \*\*Uploaded files\*\*, \*\*Agendas\*\*, and \*\*Supporting documents\*\*/);
  assert.match(knowledge, /does not document a Month filter, a public\/private-status filter, or user-defined file tags/);
  assert.match(knowledge, /exact submit label is \*\*Upload and save extracted text\*\*/);
  assert.match(knowledge, /\*\*Document title\*\*, \*\*Year\*\*, and \*\*Month\*\* are optional metadata/);
  assert.match(knowledge, /Each file row opens its menu with \*\*Action\*\*/);
  assert.match(knowledge, /exact action is \*\*Send document\*\*/);
  assert.match(knowledge, /optional scopes \*\*View documents\*\*, \*\*View recordings and transcripts\*\*, \*\*Download files\*\*, and \*\*Change content or settings\*\*/);
});

test("knowledge documents AI Search scope and approval-based saved memory", () => {
  const knowledge = recordsHelp.loadHelpKnowledge();

  assert.match(knowledge, /AI Search can load up to 400 accessible documents/);
  assert.match(knowledge, /up to 3,000 characters per selected document/);
  assert.match(knowledge, /does not save that memory automatically/);
  assert.match(knowledge, /must review and confirm the proposal/);
});
