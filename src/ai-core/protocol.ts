import {
  AssistantError,
  CAPABILITIES,
  type AssistantRequest,
  type Capability,
  type ConversationMessage,
  type PageContext,
  type ProviderResult,
} from "./contracts";

const MAX_BODY_BYTES = 96_000;
const MAX_QUESTION_CHARS = 1_200;
const MAX_HISTORY_MESSAGES = 12;
const MAX_HISTORY_CHARS = 1_600;

type IncomingRequest = {
  body?: unknown;
  on?: (event: string, callback: (value?: Buffer | Error) => void) => void;
};

function cleanText(value: unknown, limit: number): string {
  return String(value ?? "").trim().slice(0, limit);
}

function parseHistory(value: unknown): ConversationMessage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_HISTORY_MESSAGES).flatMap((item): ConversationMessage[] => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const role = candidate.role === "user" || candidate.role === "assistant" ? candidate.role : null;
    const content = cleanText(candidate.content, MAX_HISTORY_CHARS);
    return role && content ? [{ role, content }] : [];
  });
}

function parsePage(value: unknown): PageContext {
  const page = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const path = cleanText(page.path, 500) || "/";
  const normalizedPath = path.startsWith("/") && !path.startsWith("//") ? path : "/";
  const context: PageContext = {
    path: normalizedPath,
    title: cleanText(page.title, 240),
  };
  const description = cleanText(page.description, 600);
  const adminView = cleanText(page.adminView, 120);
  if (description) context.description = description;
  if (adminView) context.adminView = adminView;
  return context;
}

export function parseAssistantBody(value: unknown): AssistantRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AssistantError("invalid_request", "Send a JSON request object.", 400);
  }
  const body = value as Record<string, unknown>;
  const question = cleanText(body.question, MAX_QUESTION_CHARS + 1);
  if (!question) throw new AssistantError("invalid_request", "Please enter a question.", 400);
  if (question.length > MAX_QUESTION_CHARS) {
    throw new AssistantError("invalid_request", `Keep the question under ${MAX_QUESTION_CHARS.toLocaleString()} characters.`, 400);
  }
  const suppliedConversationId = cleanText(body.conversationId, 120);
  const conversationId = /^[a-zA-Z0-9:_-]{8,120}$/.test(suppliedConversationId)
    ? suppliedConversationId
    : `conversation-${crypto.randomUUID()}`;
  return {
    question,
    conversationId,
    history: parseHistory(body.history),
    page: parsePage(body.page),
  };
}

export async function readJsonBody(request: IncomingRequest): Promise<unknown> {
  if (request.body && typeof request.body === "object") {
    if (Buffer.byteLength(JSON.stringify(request.body), "utf8") > MAX_BODY_BYTES) {
      throw new AssistantError("invalid_request", "Request body is too large.", 413);
    }
    return request.body;
  }
  if (!request.on) return {};
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let failed = false;
    request.on?.("data", (value) => {
      if (failed) return;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(String(value ?? ""));
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        failed = true;
        reject(new AssistantError("invalid_request", "Request body is too large.", 413));
        return;
      }
      chunks.push(chunk);
    });
    request.on?.("end", () => {
      if (failed) return;
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new AssistantError("invalid_request", "Request body must be valid JSON.", 400));
      }
    });
    request.on?.("error", (value) => reject(value));
  });
}

function extractOpenAiResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string") return payload.output_text.trim();
  if (!Array.isArray(payload.output)) return "";
  return payload.output.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      if (!part || typeof part !== "object") return [];
      const text = (part as Record<string, unknown>).text;
      return typeof text === "string" ? [text] : [];
    });
  }).join("\n").trim();
}

export function validateProviderPayload(payload: unknown, provider: string, model: string): ProviderResult {
  if (!payload || typeof payload !== "object") {
    throw new AssistantError("protocol_error", `${provider} returned an invalid response.`, 502);
  }
  const record = payload as Record<string, unknown>;
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first = choices[0] as Record<string, unknown> | undefined;
  const message = first?.message as Record<string, unknown> | undefined;
  const chatText = typeof message?.content === "string" ? message.content.trim() : "";
  const text = chatText || extractOpenAiResponseText(record);
  if (!text) throw new AssistantError("protocol_error", `${provider} returned an empty response.`, 502);
  return { text, provider, model };
}

export function parseStructuredIntent(text: string): { capability: Capability; confidence: number; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new AssistantError("protocol_error", "The intent provider returned invalid JSON.", 502);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new AssistantError("protocol_error", "The intent provider returned an invalid object.", 502);
  }
  const record = parsed as Record<string, unknown>;
  const capability = String(record.capability || "") as Capability;
  if (!CAPABILITIES.includes(capability)) {
    throw new AssistantError("protocol_error", "The intent provider returned an unsupported capability.", 502);
  }
  const confidence = Number(record.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new AssistantError("protocol_error", "The intent provider returned invalid confidence.", 502);
  }
  return { capability, confidence, reason: cleanText(record.reason, 240) || "Structured provider classification." };
}
