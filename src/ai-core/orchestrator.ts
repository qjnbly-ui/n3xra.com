import {
  AssistantError,
  type AssistantRequest,
  type AssistantResponse,
  type ModelProvider,
  type SessionIdentity,
  type ToolResult,
} from "./contracts";
import { IdentityResolver, getAuthorizationToken, type AssistantEnvironment } from "./auth";
import { deterministicAnswer, describeFreshness, structuredSummary } from "./deterministic-answers";
import { AdminDataSource } from "./live-data";
import { getSiteContext, localGroundedAnswer } from "./local-knowledge";
import { createProviderChain, completeWithFallback } from "./providers";
import { parseAssistantBody, readJsonBody } from "./protocol";
import { classifyRequest } from "./router";
import { ConversationStateStore } from "./state";
import { redactSensitiveText, redactWarnings } from "./security";
import { publicAiSecurity } from "./public-ai-security";

type JsonRecord = Record<string, unknown>;
type HeaderValue = string | string[] | undefined;

interface HttpRequest {
  method?: string;
  body?: unknown;
  headers: Record<string, HeaderValue>;
  on?: (event: string, callback: (value?: Buffer | Error) => void) => void;
}

interface HttpResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

interface IdentityService {
  resolve(token: string): Promise<SessionIdentity>;
}

interface LiveDataService {
  load(capability: AssistantRequest extends never ? never : Parameters<AdminDataSource["load"]>[0], identity: SessionIdentity): Promise<ToolResult<JsonRecord>>;
}

export interface OrchestratorDependencies {
  env?: AssistantEnvironment;
  identity?: IdentityService;
  liveData?: LiveDataService | null;
  providers?: ModelProvider[];
  state?: ConversationStateStore;
}

function dedupeAnswer(value: string): string {
  const seen = new Set<string>();
  return value.split(/\n+/).map((line) => line.trim()).filter((line) => {
    if (!line) return false;
    const key = line.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^\w/\s]/g, "").replace(/\s+/g, " ").trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join("\n");
}

function sourceForResult(result: ToolResult<unknown>): "live" | "cache" {
  return result.status === "cached" ? "cache" : "live";
}

function noAdminAccess(request: AssistantRequest, identity: SessionIdentity): AssistantResponse {
  return {
    answer: "I recognize that you are signed in, but this account is not an active platform administrator. I can help with public N3XRA information and your own account context, but I cannot read platform-admin data.",
    audience: identity.audience,
    capability: "account",
    source: "local",
    dataStatus: null,
    freshness: null,
    conversationId: request.conversationId,
    warnings: [],
  };
}

export class AssistantOrchestrator {
  private readonly identity: IdentityService;
  private readonly liveData: LiveDataService | null;
  private readonly providers: ModelProvider[];
  private readonly state: ConversationStateStore;

  constructor(dependencies: OrchestratorDependencies = {}) {
    const env = dependencies.env ?? process.env;
    this.identity = dependencies.identity ?? new IdentityResolver(env);
    if (dependencies.liveData !== undefined) this.liveData = dependencies.liveData;
    else {
      try { this.liveData = new AdminDataSource(env); } catch { this.liveData = null; }
    }
    this.providers = dependencies.providers ?? createProviderChain(env);
    this.state = dependencies.state ?? new ConversationStateStore();
  }

  async sessionMode(token: string): Promise<{ audience: SessionIdentity["audience"]; label: string; signedIn: boolean }> {
    const identity = await this.identity.resolve(token);
    return {
      audience: identity.audience,
      label: identity.audience === "admin" ? "Admin AI" : identity.audience === "account" ? "Account AI" : "Ask N3XRA",
      signedIn: Boolean(identity.user),
    };
  }

  async answer(body: unknown, token = ""): Promise<AssistantResponse> {
    const identity = await this.identity.resolve(token);
    const request = parseAssistantBody(body, identity.audience);
    const session = this.state.getOrCreate(request, identity);
    const intent = await classifyRequest(request, identity, this.providers[0]);
    if (intent.requiresAdmin && identity.audience !== "admin") return noAdminAccess(request, identity);
    if (intent.capability === "records_handoff" || intent.capability === "admin_action") {
      const answer = redactSensitiveText(localGroundedAnswer(request.question, intent.capability, request.page));
      this.state.append(session, [{ role: "user", content: request.question }, { role: "assistant", content: answer }]);
      return { answer, audience: identity.audience, capability: intent.capability, source: "local", dataStatus: null, freshness: null, conversationId: request.conversationId, warnings: [] };
    }

    let liveResult: ToolResult<JsonRecord> | null = null;
    if (intent.requiresLiveData) {
      liveResult = this.liveData
        ? await this.liveData.load(intent.capability, identity)
        : { capability: intent.capability, status: "unavailable", data: null, fetchedAt: null, recordedAt: null, freshnessSeconds: null, warnings: ["Live data access is not configured."] };
      const directAnswer = deterministicAnswer(intent, liveResult, identity);
      const direct = directAnswer ? redactSensitiveText(directAnswer) : null;
      if (direct) {
        this.state.append(session, [{ role: "user", content: request.question }, { role: "assistant", content: direct }]);
        return {
          answer: direct,
          audience: identity.audience,
          capability: intent.capability,
          source: sourceForResult(liveResult),
          dataStatus: liveResult.status,
          freshness: describeFreshness(liveResult),
          conversationId: request.conversationId,
          warnings: redactWarnings(liveResult.warnings),
        };
      }
    }

    const siteContext = await getSiteContext(request.question, session.history, identity, request.page, intent.capability);
    const trustedDataSummary = liveResult?.data ? structuredSummary(intent.capability, liveResult) : "No verified live data is available for this request.";
    const completion = await completeWithFallback(this.providers, {
      maxTokens: identity.audience === "admin" ? 1_800 : 700,
      temperature: 0.15,
      messages: [
        { role: "system", content: `${siteContext}\n\nSERVER-VERIFIED CONTEXT:\nAudience: ${identity.audience}.\nCapability: ${intent.capability}.\n${trustedDataSummary}\nDo not reinterpret raw JSON; use only this normalized summary for current facts.` },
        ...session.history,
        { role: "user", content: request.question },
      ],
    });
    const answer = redactSensitiveText(dedupeAnswer(completion.result?.text || localGroundedAnswer(request.question, intent.capability, request.page)));
    this.state.append(session, [{ role: "user", content: request.question }, { role: "assistant", content: answer }]);
    return {
      answer,
      audience: identity.audience,
      capability: intent.capability,
      source: completion.result ? (completion.providerIndex === 0 ? "primary_ai" : "fallback_ai") : "local",
      dataStatus: liveResult?.status ?? null,
      freshness: describeFreshness(liveResult),
      conversationId: request.conversationId,
      warnings: redactWarnings([...(liveResult?.warnings || []), ...completion.warnings]),
    };
  }
}

const defaultOrchestrator = new AssistantOrchestrator();
const rateMap = new Map<string, { startedAt: number; count: number }>();

function isRateLimited(ip: string, limit: number): boolean {
  if (!ip) return false;
  const now = Date.now();
  const current = rateMap.get(ip);
  if (!current || now - current.startedAt > 60_000) {
    rateMap.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  current.count += 1;
  return current.count > limit;
}

function clientIp(headers: Record<string, HeaderValue>): string {
  const value = headers["x-forwarded-for"];
  const first = Array.isArray(value) ? value[0] : value;
  return String(first || "").split(",")[0]!.trim();
}

function sendJson(response: HttpResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "private, no-store");
  response.end(JSON.stringify(payload));
}

export async function handleAssistantRequest(request: HttpRequest, response: HttpResponse): Promise<void> {
  if (!['GET', 'POST'].includes(request.method || "")) {
    response.setHeader("Allow", "GET, POST");
    sendJson(response, 405, { error: "Method not allowed." });
    return;
  }
  try {
    const token = getAuthorizationToken(request.headers);
    if (request.method === "GET") {
      sendJson(response, 200, await defaultOrchestrator.sessionMode(token));
      return;
    }
    const mode = await defaultOrchestrator.sessionMode(token);
    const body = await readJsonBody(request, mode.audience);
    parseAssistantBody(body, mode.audience);
    if (!mode.signedIn) await publicAiSecurity.requireAccess(request, "ask");
    const requestLimit = mode.audience === "admin" ? 120 : 12;
    if (isRateLimited(`${mode.audience}:${clientIp(request.headers)}`, requestLimit)) throw new AssistantError("rate_limited", "Too many requests. Try again in a minute.", 429);
    sendJson(response, 200, await defaultOrchestrator.answer(body, token));
  } catch (error) {
    const known = error instanceof AssistantError ? error : new AssistantError("internal_error", "The assistant could not complete this request.", 500);
    sendJson(response, known.status, { error: redactSensitiveText(known.message, 500), code: known.code });
  }
}

export { getSiteContext } from "./local-knowledge";
