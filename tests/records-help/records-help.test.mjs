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
  assert.match(prompt, /\[\[action:account\.voice\]\]/);
  assert.match(prompt, /Speaker detection is enabled by default/);
  assert.match(prompt, /Generic guide format/);
  assert.match(prompt, /Use 2 to 7 verified interface labels/);
  assert.match(prompt, /Keep each answer and guide scoped to the topic the user asked about/);
  assert.match(prompt, /Do not add a cancel, close, discard, or rollback step unless the user explicitly asks/);
});

test("help actions are extracted from an allowlist and removed from answer copy", () => {
  const result = recordsHelp.extractHelpActions(
    "Use the button to open the right area.\n\n[[action:account.ai]]\n[[action:not.allowed]]\n[[action:account.ai]]"
  );

  assert.equal(result.answer, "Use the button to open the right area.");
  assert.deepEqual(result.actions, [{ id: "account.ai", label: "Open AI settings" }]);
});

test("ordinary how-to questions receive a grounded guided action when the model omits one", () => {
  assert.equal(
    recordsHelp.inferRecordsHelpAction(
      "Show me how to add a new contact without saving it.",
      "Open Contacts and complete the contact form."
    ),
    "account.contacts"
  );
  assert.equal(
    recordsHelp.inferRecordsHelpAction(
      "Are you able to help me create a new document? I’m not sure how to do that.",
      "Create a new app-native document from Document Builder. In the left navigation, click Document Builder, then press New document."
    ),
    "documents.new"
  );
  assert.equal(
    recordsHelp.inferRecordsHelpAction(
      "Can you help me find the Phone Meetings settings?",
      "Open Manage library, then choose Phone Meetings."
    ),
    "account.phone"
  );
  assert.equal(
    recordsHelp.inferRecordsHelpAction(
      "Where do I enroll my voice?",
      "Open Voice profiles under People and access."
    ),
    "account.voice"
  );
  assert.equal(
    recordsHelp.inferRecordsHelpAction(
      "What is Document Builder?",
      "Document Builder is where app-native documents are created."
    ),
    null
  );
  assert.equal(
    recordsHelp.inferRecordsHelpAction(
      "Help me understand these settings.",
      "Library settings and Phone Meetings are separate destinations."
    ),
    null
  );
});

test("the verified UI catalog is generated from the current destination markup", () => {
  const labels = recordsHelp.loadRecordsUiCatalog("account.contacts");
  const meetingLabels = recordsHelp.loadRecordsUiCatalog("meeting.new");
  const voiceLabels = recordsHelp.loadRecordsUiCatalog("account.voice");

  assert.ok(labels.includes("New contact"));
  assert.ok(labels.includes("Name"));
  assert.ok(labels.includes("Email"));
  assert.ok(labels.includes("Notes"));
  assert.ok(labels.includes("Add contact"));
  assert.ok(labels.includes("Cancel edit"));
  assert.equal(labels.includes("Phone number"), false);
  assert.equal(recordsHelp.resolveRecordsUiLabel("Email address", labels), "Email");
  assert.equal(recordsHelp.resolveRecordsUiLabel("Cancel", labels), "Cancel edit");
  assert.equal(recordsHelp.resolveRecordsUiLabel("Phone number", labels), "");
  assert.equal(recordsHelp.isRecordsHelpGuideGrounded({
    steps: [{ target: "New contact" }, { target: "Name" }, { target: "Phone number" }],
  }, "account.contacts"), false);
  assert.equal(recordsHelp.isRecordsHelpGuideGrounded({
    steps: [{ target: "Contacts" }],
  }, "account.contacts"), false);
  assert.ok(meetingLabels.includes("New meeting note"));
  assert.ok(voiceLabels.includes("Voice profiles"));
  assert.ok(voiceLabels.includes("Create voice profile"));
  assert.equal(meetingLabels.some((label) => /New meeting note\s+Start\s*\+/i.test(label)), false);
});

test("a same-page task guide cannot collapse into destination-only guidance", () => {
  const answer = [
    "Open **Contacts**, start a new entry, fill the fields, and stop before clicking **Add contact**.",
    "",
    "1. In the left navigation, select **Contacts**.",
    "2. Click **New contact**.",
    "3. Enter the **Name**.",
    "4. Enter the **Email**.",
    "5. Add any **Notes** you want.",
    "6. Do not press **Add contact**.",
  ].join("\n");
  const guide = recordsHelp.normalizeRecordsTaskGuide({
    buttonLabel: "Show me how",
    route: "/n3xra-records/account/?view=contacts",
    steps: [{ target: "Contacts", narration: "Open Contacts." }],
  }, "account.contacts", answer);

  assert.deepEqual(guide.steps.map((step) => step.target), [
    "Contacts",
    "New contact",
    "Name",
    "Email",
    "Notes",
    "Add contact",
  ]);
});

test("a preview guide stops at the real final action instead of inventing a rollback step", () => {
  const answer = [
    "Open **Contacts**, fill the fields, then close the form without saving.",
    "",
    "1. Select **Contacts**.",
    "2. Click **New contact**.",
    "3. Enter the **Name**, **Email**, and **Notes**.",
    "4. Choose **Cancel edit** instead of **Add contact**.",
  ].join("\n");
  const guide = recordsHelp.normalizeRecordsTaskGuide({
    buttonLabel: "Show me how",
    route: "/n3xra-records/account/?view=contacts",
    steps: [{ target: "Contacts" }],
  }, "account.contacts", answer, "Help me add a new contact, but don't save anything.");

  assert.deepEqual(guide.steps.map((step) => step.target), [
    "Contacts",
    "New contact",
    "Name",
    "Email",
    "Notes",
    "Add contact",
  ]);
  assert.equal(guide.steps.some((step) => step.target === "Cancel edit"), false);
});

test("task answers become workflow guides while explicit navigation stays destination-only", () => {
  const answer = [
    "Invite the staff member from **Invites & access**.",
    "",
    "1. Open **Manage library**, then choose **Invites & access**.",
    "2. Expand **Invite codes**.",
    "3. Set **Role** to Editor.",
    "4. Review **Create code + send email**, but do not submit it yet.",
  ].join("\n");
  const action = recordsHelp.inferRecordsWorkflowGuide("account.access", answer);

  assert.equal(recordsHelp.isRecordsNavigationOnlyRequest("Take me to Billing."), true);
  assert.equal(recordsHelp.isRecordsNavigationOnlyRequest("How do I check Billing?"), false);
  assert.equal(action.guide.route, "/n3xra-records/account/?view=access");
  assert.equal(action.guide.arrivalNarration, "Invite the staff member from Invites & access.");
  assert.deepEqual(action.guide.steps.map((step) => step.target), [
    "Invite codes",
    "Role",
    "Uses",
    "Expires at",
    "Recipient email (optional)",
    "Create invite code",
    "Create code + send email",
  ]);
});

test("task aliases recover a verified workflow when the model returns only a short answer", () => {
  const question = "Help me create an invite code for a new staff member, but don't create or send anything yet.";
  const answer = "Create the invite code but stop before sending.";
  const actionId = recordsHelp.inferRecordsHelpAction(question, answer);
  const action = recordsHelp.inferRecordsWorkflowGuide(actionId, answer);

  assert.equal(actionId, "account.access");
  assert.equal(action.guide.route, "/n3xra-records/account/?view=access");
  assert.deepEqual(action.guide.steps.map((step) => step.target), [
    "Invite codes",
    "Role",
    "Uses",
    "Expires at",
    "Recipient email (optional)",
    "Create invite code",
    "Create code + send email",
  ]);
  assert.match(action.guide.steps.at(-1).narration, /emails it to the recipient/i);
  assert.doesNotMatch(action.guide.steps.at(-1).narration, /untouched/i);
});

test("preview-only task guides use safe copy and never present an execution button", () => {
  const answer = "Create the invite code but stop before sending it.";
  const modelGuide = {
    buttonLabel: "Create invite code",
    route: "/n3xra-records/account/?view=access",
    steps: [
      { target: "Create invite code", narration: "Press Create invite code." },
      { target: "Invite codes", narration: "Open Invite codes." },
    ],
  };
  const guide = recordsHelp.normalizeRecordsTaskGuide(modelGuide, "account.access", answer);

  assert.equal(recordsHelp.isRecordsPreviewOnlyRequest("Don’t create or send anything yet."), true);
  assert.equal(guide.buttonLabel, "Show me how");
  assert.equal(guide.steps[0].target, "Invite codes");
  assert.match(guide.steps.find((step) => step.target === "Create invite code").narration, /without emailing it/i);
  assert.doesNotMatch(guide.steps.find((step) => step.target === "Create invite code").narration, /^Press /i);
  assert.doesNotMatch(guide.steps.find((step) => step.target === "Create invite code").narration, /consequential action/i);
  assert.doesNotMatch(guide.steps.find((step) => step.target === "Create invite code").narration, /untouched/i);
});

test("meeting guides focus on the requested capture method", () => {
  const modelGuide = {
    buttonLabel: "Show me how",
    route: "/n3xra-records/meeting-notes",
    steps: [
      { target: "Meeting title", narration: "Add a title." },
      { target: "Recording", narration: "Choose recording." },
    ],
  };
  const guide = recordsHelp.normalizeRecordsTaskGuide(
    modelGuide,
    "meeting.new",
    "Prepare a phone-call meeting note without starting the call."
  );

  assert.deepEqual(guide.steps.map((step) => step.target), [
    "Meeting title",
    "Document template",
    "Phone call",
    "Start phone meeting",
  ]);
  assert.doesNotMatch(guide.steps.map((step) => step.target).join(" "), /\bRecording\b/);

  const overview = recordsHelp.normalizeRecordsTaskGuide(
    modelGuide,
    "meeting.new",
    "Explain the available recording methods.",
    "Give me an overview of every recording option."
  );
  assert.deepEqual(overview.steps.map((step) => step.target), [
    "Meeting title",
    "Document template",
    "App recording",
    "Phone call",
    "Both",
    "Upload recording",
  ]);
});

test("metadata-only responses retain their action and receive visible fallback copy", () => {
  const metadataOnly = recordsHelp.extractHelpActions("[[action:documents.new]]");

  assert.equal(metadataOnly.answer, "");
  assert.deepEqual(metadataOnly.actions, [
    { id: "documents.new", label: "Show Document Builder" },
  ]);
  assert.equal(
    recordsHelp.buildRecordsHelpEmptyAnswerFallback(metadataOnly.actions),
    "I can guide you to Document Builder. Use the option below and Records AI will show you where to go."
  );
  assert.deepEqual(
    recordsHelp.mergeRecordsHelpActions(
      metadataOnly.actions,
      [{ id: "documents.new", label: "Show Document Builder" }]
    ),
    metadataOnly.actions
  );
  assert.deepEqual(
    recordsHelp.combineRecordsHelpUsage(
      { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
      { promptTokens: 120, completionTokens: 20, totalTokens: 140 }
    ),
    { promptTokens: 220, completionTokens: 25, totalTokens: 245 }
  );
});

test("generic guides compose verified UI labels without workflow-specific code", () => {
  const result = recordsHelp.extractHelpActions(
    "I’ll show you the path.\n[[guide:Show the workflow|/n3xra-records/meeting-notes|New meeting note~First, choose New meeting note.>Phone call~Choose Phone call.>Start phone meeting~Finish here.]]"
  );

  assert.equal(result.answer, "I’ll show you the path.");
  assert.deepEqual(result.actions[0], {
    id: "guided.path",
    label: "Show the workflow",
    guide: {
      buttonLabel: "Show the workflow",
      route: "/n3xra-records/meeting-notes",
      steps: [
        { target: "New meeting note", narration: "First, choose New meeting note." },
        { target: "Phone call", narration: "Choose Phone call." },
        { target: "Start phone meeting", narration: "Finish here." },
      ],
    },
  });
  assert.equal(recordsHelp.parseRecordsGuideToken("Unsafe|/outside|Delete~Delete it."), null);
});

test("truncated guide markers are salvaged and never exposed in answer copy", () => {
  const result = recordsHelp.extractHelpActions(
    "Start in Meeting Notes.\n[[guide:Start phone meeting|/n3xra-records/meeting-\nnotes|Meeting Notes~Open Meeting Notes workspace>New meeting note~Open the new meeting note area>Phone call~Select phone call capture>"
  );

  assert.equal(result.answer, "Start in Meeting Notes.");
  assert.doesNotMatch(result.answer, /\[\[guide:/);
  assert.equal(result.actions[0].id, "guided.path");
  assert.equal(result.actions[0].guide.route, "/n3xra-records/meeting-notes");
  assert.deepEqual(result.actions[0].guide.steps.map((step) => step.target), [
    "Meeting Notes",
    "New meeting note",
    "Phone call",
  ]);
});

test("incomplete answer formatting is detected and repaired generically", () => {
  const incomplete = "Open **Manage library**, then choose **Invites & access";

  assert.equal(recordsHelp.isRecordsHelpAnswerIncomplete(incomplete), true);
  assert.equal(
    recordsHelp.repairRecordsHelpMarkdown(incomplete),
    "Open **Manage library**, then choose Invites & access"
  );
  assert.equal(recordsHelp.isRecordsHelpAnswerIncomplete("Open **Manage library**."), false);
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
  assert.match(knowledge, /Creating a phone meeting starts in \*\*Meeting Notes\*\* → \*\*New meeting note\*\*/);
  assert.match(knowledge, /\*\*App recording\*\* is the default capture method/);
  assert.match(knowledge, /then select \*\*Start phone meeting\*\*/);
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
  assert.match(knowledge, /There is no control labeled \*\*Invite user\*\*/);
  assert.match(knowledge, /\*\*Manage library\*\* → \*\*Invites & access\*\* → \*\*Invite codes\*\*/);
  assert.match(knowledge, /\*\*Create code \+ send email\*\*/);
});

test("knowledge documents AI Search scope and approval-based saved memory", () => {
  const knowledge = recordsHelp.loadHelpKnowledge();

  assert.match(knowledge, /AI Search can load up to 400 accessible documents/);
  assert.match(knowledge, /up to 3,000 characters per selected document/);
  assert.match(knowledge, /does not save that memory automatically/);
  assert.match(knowledge, /must review and confirm the proposal/);
});
