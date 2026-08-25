type ConversationMessage = { role: "user" | "assistant"; content: string };

type Provider = {
  name: string;
  complete(request: {
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    maxTokens: number;
    temperature: number;
  }): Promise<{ text: string }>;
};

type GenerateInput = {
  body: string;
  history?: ConversationMessage[];
  accountKnown?: boolean;
};

type GenerateDependencies = {
  getContext?: (
    question: string,
    history: ConversationMessage[],
    identity: Record<string, unknown>,
    page: { path: string; title: string },
    capability: string,
  ) => Promise<string>;
  providers?: Provider[];
  complete?: (
    providers: Provider[],
    request: {
      messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
      maxTokens: number;
      temperature: number;
    },
  ) => Promise<{ result: { text: string } | null }>;
};

const { getSiteContext } = require("./_ai-core/local-knowledge") as {
  getSiteContext: NonNullable<GenerateDependencies["getContext"]>;
};
const { createProviderChain, completeWithFallback } = require("./_ai-core/providers") as {
  createProviderChain: (environment: NodeJS.ProcessEnv, fetcher?: typeof fetch, timeoutMs?: number) => Provider[];
  completeWithFallback: NonNullable<GenerateDependencies["complete"]>;
};
const { redactSensitiveText } = require("./_ai-core/security") as {
  redactSensitiveText: (value: string, maximum?: number) => string;
};

const SMS_INSTRUCTIONS = [
  "You are replying as Nex in a one-to-one N3XRA text conversation.",
  "Be warm, direct, and useful. Keep the reply under 600 characters and normally under four short sentences.",
  "Never imply that you are Quentin or another human. If identity matters, say that you are Nex, N3XRA's AI assistant.",
  "Do not claim to complete purchases, account changes, approvals, refunds, legal decisions, or other consequential actions.",
  "For anything requiring private account data or a human decision, explain the next safe step and say the N3XRA team can follow up.",
  "Do not include markdown, internal implementation details, or more than one link.",
].join(" ");

function normalizeHistory(value: ConversationMessage[] | undefined): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-10).flatMap((message): ConversationMessage[] => {
    if (!message || !["user", "assistant"].includes(message.role)) return [];
    const content = String(message.content || "").trim().slice(0, 1600);
    return content ? [{ role: message.role, content }] : [];
  });
}

function cleanReply(value: string): string {
  return redactSensitiveText(String(value || "").replace(/\n{3,}/g, "\n\n").trim(), 600).trim();
}

export async function generateNexConversationReply(
  input: GenerateInput,
  dependencies: GenerateDependencies = {},
): Promise<string | null> {
  const body = String(input.body || "").trim().slice(0, 1600);
  if (!body) return null;
  const history = normalizeHistory(input.history);
  const identity = input.accountKnown
    ? { audience: "account", user: { id: "sms-contact", email: "", displayName: "Text contact" }, adminRole: null }
    : { audience: "public", user: null, adminRole: null };
  const context = await (dependencies.getContext ?? getSiteContext)(
    body,
    history,
    identity,
    { path: "/support", title: "N3XRA text conversation" },
    input.accountKnown ? "account" : "public_site",
  );
  const providers = dependencies.providers ?? createProviderChain(process.env, fetch, 8_000).slice(0, 1);
  if (!providers.length) return null;
  const completion = await (dependencies.complete ?? completeWithFallback)(providers, {
    maxTokens: 240,
    temperature: 0.15,
    messages: [
      { role: "system", content: `${context}\n\nTEXT CONVERSATION RULES:\n${SMS_INSTRUCTIONS}` },
      ...history,
      { role: "user", content: body },
    ],
  });
  const reply = cleanReply(completion.result?.text || "");
  return reply || null;
}

export { SMS_INSTRUCTIONS };
