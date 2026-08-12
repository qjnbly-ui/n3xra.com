const baseUrl = String(process.env.AI_SMOKE_BASE_URL || "").replace(/\/+$/, "");
const accountToken = String(process.env.AI_SMOKE_ACCOUNT_TOKEN || "").trim();
const adminToken = String(process.env.AI_SMOKE_ADMIN_TOKEN || "").trim();
const recordsToken = String(process.env.AI_SMOKE_RECORDS_TOKEN || "").trim();
const recordsOrganizationId = String(process.env.AI_SMOKE_RECORDS_ORGANIZATION_ID || "").trim();

if (!baseUrl) {
  console.error("Set AI_SMOKE_BASE_URL to a staging or preview deployment.");
  process.exit(2);
}

function headers(token = "") {
  return { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

async function readResponse(response, label) {
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${label}: ${result.error || response.status}`);
  return result;
}

async function expectStatus(response, expectedStatus, label) {
  const result = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`${label}: expected ${expectedStatus}, received ${response.status} (${result.error || "no error message"})`);
  console.log(`PASS ${label} · denied with ${expectedStatus}`);
}

async function probeSharedMode(label, token, expectedAudience, questions) {
  const mode = await readResponse(await fetch(`${baseUrl}/api/ask`, { headers: headers(token) }), `${label} session probe`);
  if (mode.audience !== expectedAudience) throw new Error(`${label}: expected ${expectedAudience}, received ${mode.audience}`);
  console.log(`PASS ${label} session · ${mode.label}`);

  const conversationId = `smoke-${label.toLowerCase()}-${crypto.randomUUID()}`;
  for (const [question, expectedCapability, path] of questions) {
    const result = await readResponse(await fetch(`${baseUrl}/api/ask`, {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ question, conversationId, history: [], page: { path, title: `${label} staging smoke test` } }),
    }), `${label}: ${question}`);
    if (!String(result.answer || "").trim()) throw new Error(`${label}: empty answer`);
    if (result.capability !== expectedCapability) throw new Error(`${label}: expected ${expectedCapability}, received ${result.capability}`);
    if (/sorry,? i can'?t do that right now/i.test(result.answer)) throw new Error(`${label}: generic failure response`);
    console.log(`PASS ${label} · ${result.capability} · ${result.source}`);
  }
}

await probeSharedMode("Public", "", "public", [
  ["What does N3XRA build?", "public_site", "/"],
  ["What can I do on this page?", "current_page", "/services"],
]);
await expectStatus(await fetch(`${baseUrl}/api/codebase-ai`, { headers: headers() }), 401, "Public → Codebase boundary");

if (accountToken) {
  await probeSharedMode("Account", accountToken, "account", [
    ["What is my account status?", "account", "/account"],
    ["Show all platform admin accounts", "account", "/account"],
  ]);
  await expectStatus(await fetch(`${baseUrl}/api/codebase-ai`, { headers: headers(accountToken) }), 403, "Account → Codebase boundary");
} else {
  console.log("SKIP Account mode · set AI_SMOKE_ACCOUNT_TOKEN");
}

if (adminToken) {
  await probeSharedMode("Admin", adminToken, "admin", [
    ["Did anyone submit a career application today?", "admin_applications", "/account/admin/applications"],
    ["What support cases need attention?", "admin_support", "/account/admin/support"],
    ["Give me an overview of everything pending.", "admin_overview", "/account"],
  ]);

  const index = await readResponse(await fetch(`${baseUrl}/api/codebase-ai`, { headers: headers(adminToken) }), "Codebase AI index probe");
  if (!Number.isFinite(index?.index?.chunkCount) || index.index.chunkCount < 1) throw new Error("Codebase AI: private index is empty");
  const codebase = await readResponse(await fetch(`${baseUrl}/api/codebase-ai`, {
    method: "POST",
    headers: headers(adminToken),
    body: JSON.stringify({ question: "How is Codebase AI authorization enforced?", history: [] }),
  }), "Codebase AI answer probe");
  if (!String(codebase.answer || "").trim() || !Array.isArray(codebase.sources) || !codebase.sources.length) {
    throw new Error("Codebase AI: answer or source citations are missing");
  }
  console.log("PASS Codebase AI · verified admin + private source index");
} else {
  console.log("SKIP Admin and Codebase modes · set AI_SMOKE_ADMIN_TOKEN");
}

if (recordsToken && recordsOrganizationId) {
  const records = await readResponse(await fetch(`${baseUrl}/api/records-help`, {
    method: "POST",
    headers: headers(recordsToken),
    body: JSON.stringify({
      question: "Where do I search my Records library?",
      history: [],
      context: { organizationId: recordsOrganizationId, path: "/n3xra-records/library" },
    }),
  }), "Records AI answer probe");
  if (!String(records.answer || "").trim()) throw new Error("Records AI: empty answer");
  console.log("PASS Records AI · authenticated organization-scoped workflow");
} else {
  console.log("SKIP Records mode · set AI_SMOKE_RECORDS_TOKEN and AI_SMOKE_RECORDS_ORGANIZATION_ID");
}
