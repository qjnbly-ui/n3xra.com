import { CAPABILITIES, type AssistantRequest, type Capability, type Intent, type ModelProvider, type SessionIdentity } from "./contracts";
import { parseStructuredIntent } from "./protocol";

type CapabilityDefinition = {
  capability: Capability;
  concepts: readonly string[];
  live: boolean;
  admin: boolean;
};

const DEFINITIONS: readonly CapabilityDefinition[] = [
  { capability: "admin_applications", concepts: ["application", "apply", "applicant", "candidate", "career", "job", "resume", "partner application", "creator application", "talent"], live: true, admin: true },
  { capability: "admin_support", concepts: ["support case", "support request", "ticket", "customer issue", "urgent case", "inbox case"], live: true, admin: true },
  { capability: "admin_accounts", concepts: ["account", "customer", "profile", "user", "membership", "access", "subscriber"], live: true, admin: true },
  { capability: "admin_notifications", concepts: ["notification", "admin inbox", "alert", "unread", "platform message"], live: true, admin: true },
  { capability: "admin_websites", concepts: ["website request", "proposal", "onboarding", "website project", "client website", "launch", "domain"], live: true, admin: true },
  { capability: "admin_billing", concepts: ["billing", "invoice", "subscription", "payment", "amount due", "paid", "revenue"], live: true, admin: true },
  { capability: "admin_operations", concepts: ["financial operations", "finance", "accounting", "transaction", "financial account", "deposit", "business project", "party", "financial ledger", "operations ledger"], live: true, admin: true },
  { capability: "admin_analytics", concepts: ["analytics", "pageview", "visitor", "traffic", "referrer", "site usage"], live: true, admin: true },
  { capability: "admin_overview", concepts: ["admin overview", "admin summary", "dashboard summary", "attention", "platform status", "everything pending", "pending across platform"], live: true, admin: true },
  { capability: "account", concepts: ["my account", "my plan", "my subscription", "my profile", "my access", "signed in"], live: true, admin: false },
  { capability: "current_page", concepts: ["this page", "where am i", "what can i do here", "current screen", "page help"], live: false, admin: false },
];

const ACTION_CONCEPTS = ["delete", "send", "email", "text", "post", "publish", "submit", "approve", "reject", "refund", "charge", "purchase", "transfer", "change status", "update", "create", "invite"];
const CONCEPT_STOP_WORDS = new Set(["a", "all", "and", "are", "everything", "for", "i", "in", "is", "me", "my", "of", "on", "the", "this", "to", "what", "you"]);
const ADMIN_DRAFTING_REQUEST = /\b(rewrite|redraft|revise|proofread|critique|improve|polish)\b|\b(review|edit|update|analyze|assess)\s+(this|the|my|these|those)?\s*(drafts?|copy|emails?|messages?|templates?|letters?|outreach)\b|\bwhat(?:'s|\s+is)\s+wrong\s+with\s+(this|the|my|these|those)?\s*(drafts?|copy|emails?|messages?|templates?|letters?|outreach)\b|\bsend\s+(it|this|them)\s+back\s+to\s+me\b/i;
const ADMIN_EXTERNAL_SEND_REQUEST = /^(?:(?:please|can\s+you|could\s+you|i\s+want\s+you\s+to)\s+)?(?:(?:rewrite|redraft|revise|edit|polish)\b.{0,100}\band\s+)?(?:send|email|text|notify|post|publish)\b.{0,120}\b(?:to|on)\s+(?!me\b)\S/i;
const LIVE_DATA_REQUEST = /^(?:please\s+)?(?:show|list|count|summarize|check|give\s+me|tell\s+me|which|who|where|what|how\s+many|how\s+much|are\s+there|do\s+we\s+have|did\s+anyone|has\s+anyone)\b|^(?:please\s+)?any\b.{0,80}\b(?:new|open|pending|recent|unread|waiting)\b|\b(?:needs?\s+(?:my\s+)?attention|platform\s+status|everything\s+pending)\b/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function conceptScore(text: string, concepts: readonly string[]): number {
  let score = 0;
  for (const concept of concepts) {
    const normalized = normalize(concept);
    if (text.includes(normalized)) score += normalized.includes(" ") ? 4 : 2;
    else {
      const words = normalized.split(" ").filter((word) => !CONCEPT_STOP_WORDS.has(word));
      const matches = words.filter((word) => text.split(" ").includes(word)).length;
      score += matches / Math.max(1, words.length);
    }
  }
  return score;
}

function intentFor(capability: Capability, confidence: number, reason: string): Intent {
  const definition = DEFINITIONS.find((item) => item.capability === capability);
  const requiresAdmin = definition?.admin ?? capability.startsWith("admin_");
  return {
    capability,
    confidence,
    entities: {},
    requiresLiveData: definition?.live ?? false,
    requiresAdmin,
    requiresConfirmation: capability === "admin_action",
    reason,
  };
}

export function classifyDeterministically(request: AssistantRequest, identity: SessionIdentity): Intent {
  const text = normalize(request.question);
  if (request.page.path.startsWith("/n3xra-records")) return intentFor("records_handoff", 1, "Records routes keep their existing assistant.");
  if (identity.audience === "admin" && ADMIN_EXTERNAL_SEND_REQUEST.test(request.question)) {
    return intentFor("admin_action", 0.98, "The administrator explicitly asked to transmit or publish content outside the conversation.");
  }
  if (identity.audience === "admin" && ADMIN_DRAFTING_REQUEST.test(request.question)) {
    return intentFor("admin_advisory", 0.96, "The administrator asked for drafting, review, or analysis without an external side effect.");
  }
  const actionScore = conceptScore(text, ACTION_CONCEPTS);
  if (identity.audience === "admin" && actionScore >= 2 && /\b(please|can you|could you|go ahead|i want you to|do it)\b/.test(text)) {
    return intentFor("admin_action", Math.min(0.98, 0.72 + actionScore / 20), "The request asks the administrator assistant to change external state.");
  }
  const ranked = DEFINITIONS.map((definition) => ({ definition, score: conceptScore(text, definition.concepts) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  const mayUseLiveData = identity.audience !== "admin" || LIVE_DATA_REQUEST.test(request.question.trim());
  if (best && best.score >= 2 && (!best.definition.live || mayUseLiveData)) {
    if (best.definition.admin && identity.audience !== "admin") {
      if (identity.audience === "account" && /\b(my|mine)\b/.test(text)) {
        return intentFor("account", 0.78, "A signed-in user asked about their own data.");
      }
      if (!(/\b(admin|platform admin)\b/.test(text) || /\ball\b.*\b(accounts|users|customers)\b/.test(text))) {
        return intentFor("public_site", 0.7, "The request uses a public topic without verified admin scope.");
      }
    }
    const confidence = Math.min(0.96, 0.58 + best.score / 16);
    return intentFor(best.definition.capability, confidence, "Matched the request to a capability definition.");
  }
  if (identity.audience === "admin") return intentFor("admin_advisory", 0.82, "The request is general administrator work rather than an explicit live-data lookup.");
  if (identity.audience !== "public" && /\bmy\b/.test(text)) return intentFor("account", 0.64, "The signed-in user asked about their own context.");
  return intentFor("public_site", 0.52, "No live-data capability had a reliable semantic match.");
}

export async function classifyRequest(request: AssistantRequest, identity: SessionIdentity, provider?: ModelProvider): Promise<Intent> {
  const deterministic = classifyDeterministically(request, identity);
  if (deterministic.confidence >= 0.68 || !provider) return deterministic;
  try {
    const result = await provider.completeStructured({
      schemaName: "n3xra_assistant_intent",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["capability", "confidence", "reason"],
        properties: {
          capability: { type: "string", enum: [...CAPABILITIES] },
          confidence: { type: "number", minimum: 0, maximum: 1 },
          reason: { type: "string" },
        },
      },
      maxTokens: 180,
      temperature: 0,
      messages: [
        { role: "system", content: "Classify the user request into exactly one N3XRA capability. Route by meaning, not by exact phrasing. Return JSON only." },
        { role: "user", content: `Audience: ${identity.audience}\nPage: ${request.page.path}\nRecent conversation:\n${request.history.slice(-4).map((item) => `${item.role}: ${item.content}`).join("\n")}\nRequest: ${request.question}` },
      ],
    });
    const structured = parseStructuredIntent(result.text);
    return intentFor(structured.capability, structured.confidence, structured.reason);
  } catch {
    return deterministic;
  }
}
