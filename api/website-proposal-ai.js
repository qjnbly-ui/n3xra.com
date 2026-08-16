const { randomUUID } = require("node:crypto");
const {
  apiError, callerRpc, parseJson, serviceRequest, verifyAdminRequest,
} = require("./_website-proposal-ai-supabase");
const {
  buildSourceManifest, evidenceSources, loadProposalCopilotContext,
} = require("./_website-proposal-context");
const { validateChangeSet } = require("./_website-proposal-ai-validation");

const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const MODEL = String(
  process.env.GROQ_PROPOSAL_MODEL
  || "openai/gpt-oss-120b"
).trim();
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 5;
const rateMap = new Map();
const TARGET_SECTIONS = new Set(["overview", "scope", "schedule", "investment", "terms"]);

const LINE_ITEM_VALUE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    category: { type: "string", enum: ["website_build", "domain", "hosting", "maintenance", "email", "ssl_cdn", "content", "ecommerce", "integration", "other"] },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    billing_type: { type: "string", enum: ["one_time", "recurring"] },
    quantity: { type: "number" },
    unit_amount_cents: { type: "integer" },
    recurring_interval: { type: ["string", "null"], enum: [null, "monthly", "quarterly", "yearly"] },
    sort_order: { type: "integer" },
  },
  required: ["category", "name", "description", "billing_type", "quantity", "unit_amount_cents", "recurring_interval", "sort_order"],
};
const OPERATION_VALUE_SCHEMA = {
  anyOf: [
    { type: "string" }, { type: "number" }, { type: "boolean" }, { type: "null" },
    { type: "array", items: { type: "string" } }, LINE_ITEM_VALUE_SCHEMA,
  ],
};
const CHANGE_SET_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          target: {
            type: "object",
            additionalProperties: false,
            properties: {
              kind: { type: "string", enum: ["proposal", "version", "line_item"] },
              id: { type: ["string", "null"] },
            },
            required: ["kind", "id"],
          },
          operation: { type: "string", enum: ["replace", "add", "remove"] },
          field: { type: "string" },
          original: OPERATION_VALUE_SCHEMA,
          proposed: OPERATION_VALUE_SCHEMA,
          rationale: { type: "string" },
          risk: { type: "string", enum: ["standard", "protected"] },
          evidence: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                source_type: { type: "string" },
                source_id: { type: "string" },
                field_path: { type: "string" },
                supporting_value: { type: "string" },
              },
              required: ["source_type", "source_id", "field_path", "supporting_value"],
            },
          },
        },
        required: ["id", "target", "operation", "field", "original", "proposed", "rationale", "risk", "evidence"],
      },
    },
  },
  required: ["summary", "operations"],
};

function limited(userId) {
  const now = Date.now();
  const current = rateMap.get(userId);
  if (!current || now - current.startedAt > RATE_WINDOW_MS) {
    rateMap.set(userId, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > RATE_MAX;
}

function cleanIds(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function isRunRemovable(run) {
  return run?.status !== "applied" || Number(run?.accepted_count || 0) === 0;
}

function operationSection(operation) {
  if (operation.target?.kind === "proposal" || ["introduction", "project_objective"].includes(operation.field)) return "overview";
  if (["scope_summary", "deliverables", "exclusions"].includes(operation.field)) return "scope";
  if (["timeline", "estimated_start_date", "estimated_completion_date", "valid_until"].includes(operation.field)) return "schedule";
  if (operation.target?.kind === "line_item" || ["discount_cents", "deposit_cents", "payment_schedule"].includes(operation.field)) return "investment";
  return "terms";
}

function extractGroqOutput(data) {
  const message = data?.choices?.[0]?.message;
  if (message?.refusal) throw apiError(message.refusal || "Proposal AI declined this request.", 422);
  if (typeof message?.content === "string" && message.content.trim()) return message.content;
  if (Array.isArray(message?.content)) {
    const text = message.content.map((part) => part?.text || "").join("").trim();
    if (text) return text;
  }
  throw apiError("Groq returned no structured proposal suggestions.", 502);
}

function isGroqSchemaError(data) {
  const message = String(data?.error?.message || "");
  return Boolean(data?.error?.failed_generation)
    || /generated json|expected schema|jsonschema|schema validation/i.test(message);
}

function promptFor(context, instruction, targetSections, instructionSource) {
  const sourceText = context.includedSources.map((item) => [
    `SOURCE ${item.source_type}:${item.source_id}`,
    `Authority: ${item.authority}; status: ${item.status}`,
    JSON.stringify(item.content),
  ].join("\n")).join("\n\n");
  return [
    `ADMIN INSTRUCTION SOURCE ${instructionSource.source_type}:${instructionSource.source_id}`,
    instruction,
    "",
    `TARGET SECTIONS: ${targetSections.length ? targetSections.join(", ") : "all editable sections"}`,
    "",
    sourceText,
  ].join("\n");
}

async function callGroq(context, instruction, targetSections, instructionSource) {
  if (!GROQ_API_KEY) throw apiError("GROQ_API_KEY is not configured.", 503);
  const systemInstruction = [
    "You are Proposal AI for a website-services administrator.",
    "Return only useful, discrete edits to the existing proposal baseline using the required schema.",
    "When a requested target section has blank or incomplete standard fields, draft client-ready values from the included authoritative sources. When it already has useful content, improve it without discarding accurate details.",
    "Use project_objective as the complete client-facing Project Summary. Do not propose a separate introduction; combine any useful introductory context into project_objective.",
    "Target mapping is exact: overview may edit proposal.title and version.project_objective; scope may edit scope_summary, deliverables, and exclusions; schedule may edit timeline and proposal dates; investment may edit billing items, discounts, deposits, and payment_schedule; terms may edit revision_policy and terms.",
    "Never infer or invent a price, discount, deposit, recurring charge, date, duration, deadline, promise, revision limit, support hour allowance, payment term, contractual term, or billing line item.",
    "A protected commercial or contractual edit is allowed only when an authoritative included source states the exact final value or exact replacement language. Otherwise omit the operation and mention the missing decision in the summary.",
    "Project context may support descriptive scope language, but implied functionality is not permission to create a charge, commitment, or contract term.",
    "Use only record IDs shown in the supplied baseline. For a line-item addition use a null target ID and field item. When billing type and recurring interval change together, replace the complete line item using field item so the values remain consistent.",
    "For every line item, use billing_type one_time with a null recurring_interval, or billing_type recurring with recurring_interval monthly, quarterly, or yearly. Prices are integer cents and sort_order is an integer.",
    "Replace deliverables and exclusions only as complete arrays. Do not emit subtotal, total, or recurring summary edits; the server recalculates them from line items.",
    "For each evidence item, source_type and source_id must exactly match a supplied SOURCE label.",
    "Cite the exact authoritative evidence for every protected value. Omit the protected operation when exact evidence is unavailable.",
    "Keep suggestions concise and return no more than 12 complete operations. Never begin an operation unless every required property can be completed. If the instruction is already satisfied, return no operation for it and explain briefly in summary.",
  ].join(" ");
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        reasoning_effort: "low",
        max_completion_tokens: 20000,
        messages: [
          { role: "system", content: attempt
            ? `${systemInstruction} This is a retry after an incomplete structured response. Return fewer operations and complete every required property.`
            : systemInstruction },
          { role: "user", content: promptFor(context, instruction, targetSections, instructionSource) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "website_proposal_change_set",
            strict: true,
            schema: CHANGE_SET_SCHEMA,
          },
        },
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      if (attempt === 0 && isGroqSchemaError(data)) continue;
      if (isGroqSchemaError(data)) {
        throw apiError("Proposal AI could not finish a valid draft. Try one section at a time, or shorten the instruction.", 502);
      }
      throw apiError(data?.error?.message || `Groq request failed (${response.status}).`, response.status === 429 ? 429 : 502, data);
    }
    try {
      return JSON.parse(extractGroqOutput(data));
    } catch (error) {
      if (error?.status) throw error;
      if (attempt === 0) continue;
      throw apiError("Proposal AI could not finish a valid draft. Try one section at a time, or shorten the instruction.", 502);
    }
  }
  throw apiError("Proposal AI could not finish a valid draft.", 502);
}

async function updateRun(runId, values) {
  const rows = await serviceRequest(`website_proposal_ai_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify(values),
  });
  return rows?.[0] || null;
}

async function generate(body, auth) {
  if (limited(auth.user.id)) throw apiError("Too many Proposal Copilot requests. Try again in a minute.", 429);
  const proposalId = String(body.proposal_id || "").trim();
  const instruction = String(body.instruction || "").trim();
  if (!proposalId) throw apiError("Choose a saved proposal first.", 400);
  if (!instruction) throw apiError("Enter the change or idea you want Copilot to consider.", 400);
  if (instruction.length > 6000) throw apiError("Keep the instruction under 6,000 characters.", 400);
  const targetSections = cleanIds(body.target_sections).filter((value) => TARGET_SECTIONS.has(value));
  const runId = randomUUID();
  const instructionSource = {
    source_type: "admin_instruction", source_id: runId, label: "Admin instruction",
    authority: "admin_instruction", status: "immutable", updated_at: new Date().toISOString(),
    target_sections: targetSections,
  };
  const context = await loadProposalCopilotContext(proposalId);
  const manifest = buildSourceManifest(context, instructionSource);
  const inserted = await serviceRequest("website_proposal_ai_runs", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      id: runId,
      proposal_id: proposalId,
      base_version_id: context.proposalBaseline.version.id,
      created_by_user_id: auth.user.id,
      instruction,
      source_manifest: manifest,
      model: `groq:${MODEL}`,
    }),
  });
  const run = inserted?.[0];
  if (!run) throw apiError("Unable to create the Proposal Copilot run.", 500);

  try {
    const raw = await callGroq(context, instruction, targetSections, instructionSource);
    const evidenceMap = evidenceSources(context, instructionSource, instruction);
    const changeSet = validateChangeSet(raw, context.proposalBaseline, evidenceMap, new Date(run.created_at));
    if (targetSections.length) {
      changeSet.operations = changeSet.operations.filter((operation) => targetSections.includes(operationSection(operation)));
    }
    const affectedSections = [...new Set(changeSet.operations.map((operation) => `${operation.target.kind}.${operation.field}`))];
    const completed = await updateRun(runId, {
      status: "ready",
      change_set: changeSet,
      affected_sections: affectedSections,
      suggestion_count: changeSet.operations.length,
      completed_at: new Date().toISOString(),
    });
    return { run: completed };
  } catch (error) {
    await updateRun(runId, {
      status: "failed", error: String(error?.message || "Proposal generation failed.").slice(0, 2000),
      completed_at: new Date().toISOString(),
    }).catch(() => null);
    throw error;
  }
}

async function history(body) {
  const proposalId = String(body.proposal_id || "").trim();
  if (!proposalId) throw apiError("Choose a saved proposal first.", 400);
  const context = await loadProposalCopilotContext(proposalId);
  const runs = await serviceRequest(
    `website_proposal_ai_runs?select=id,proposal_id,base_version_id,instruction,model,status,error,affected_sections,suggestion_count,accepted_count,rejected_count,applied_version_id,created_at,completed_at,applied_at&proposal_id=eq.${encodeURIComponent(proposalId)}&order=created_at.desc&limit=25`,
  );
  const summaries = (runs || []).map(({ instruction, ...run }) => ({
    ...run,
    instruction_preview: String(instruction || "").trim().slice(0, 140),
  }));
  return { runs: summaries };
}

async function detail(body) {
  const runId = String(body.run_id || "").trim();
  const proposalId = String(body.proposal_id || "").trim();
  if (!runId || !proposalId) throw apiError("Choose a Proposal Copilot run.", 400);
  const rows = await serviceRequest(
    `website_proposal_ai_runs?select=*&id=eq.${encodeURIComponent(runId)}&proposal_id=eq.${encodeURIComponent(proposalId)}&limit=1`,
  );
  const run = rows?.[0];
  if (!run) throw apiError("This Proposal Copilot run no longer exists.", 404);
  return { run };
}

async function remove(body) {
  const runId = String(body.run_id || "").trim();
  const proposalId = String(body.proposal_id || "").trim();
  if (!runId || !proposalId) throw apiError("Choose a Proposal Copilot run.", 400);
  const rows = await serviceRequest(
    `website_proposal_ai_runs?select=id,status,accepted_count&id=eq.${encodeURIComponent(runId)}&proposal_id=eq.${encodeURIComponent(proposalId)}&limit=1`,
  );
  const run = rows?.[0];
  if (!run) throw apiError("This Proposal Copilot run no longer exists.", 404);
  if (!isRunRemovable(run)) {
    throw apiError("Applied Proposal AI history stays with the proposal and cannot be removed independently.", 409);
  }
  const deleted = await serviceRequest(
    `website_proposal_ai_runs?id=eq.${encodeURIComponent(runId)}&proposal_id=eq.${encodeURIComponent(proposalId)}`,
    { method: "DELETE", headers: { Prefer: "return=representation" } },
  );
  if (!deleted?.length) throw apiError("This Proposal Copilot run could not be removed.", 409);
  return { deleted: true, run_id: runId };
}

async function apply(body, auth) {
  const runId = String(body.run_id || "").trim();
  const proposalId = String(body.proposal_id || "").trim();
  if (!runId || !proposalId) throw apiError("Choose a Proposal Copilot run.", 400);
  const rows = await serviceRequest(
    `website_proposal_ai_runs?select=id,proposal_id,status,change_set,applied_version_id&id=eq.${encodeURIComponent(runId)}&proposal_id=eq.${encodeURIComponent(proposalId)}&limit=1`,
  );
  const run = rows?.[0];
  if (!run) throw apiError("This Proposal Copilot run no longer exists.", 404);
  if (run.status !== "ready" || run.applied_version_id) throw apiError("This Proposal Copilot run cannot be applied again.", 409);
  const accepted = cleanIds(body.accepted_operation_ids);
  const rejected = cleanIds(body.rejected_operation_ids);
  const result = await callerRpc("apply_website_proposal_ai_run", auth.token, {
    target_run_id: runId,
    accepted_operation_ids: accepted,
    rejected_operation_ids: rejected,
  });
  return { result };
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed." });
  }
  try {
    const auth = await verifyAdminRequest(req);
    const body = await parseJson(req);
    const action = String(body.action || "").trim();
    let result;
    if (action === "generate") result = await generate(body, auth);
    else if (action === "history") result = await history(body);
    else if (action === "detail") result = await detail(body);
    else if (action === "remove") result = await remove(body);
    else if (action === "apply") result = await apply(body, auth);
    else throw apiError("Unknown Proposal Copilot action.", 400);
    return res.status(200).json(result);
  } catch (error) {
    const status = Number(error?.status) || (error?.name === "TimeoutError" ? 504 : 500);
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: error?.message || "Proposal Copilot failed." });
  }
};

module.exports._test = { extractGroqOutput, isGroqSchemaError, isRunRemovable, CHANGE_SET_SCHEMA };
