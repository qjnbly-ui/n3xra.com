import { AssistantError, type ModelProvider, type ProviderRequest, type ProviderResult, type StructuredProviderRequest } from "./contracts";
import { validateProviderPayload } from "./protocol";
import type { AssistantEnvironment } from "./auth";
import { safeErrorMessage } from "./security";

type Fetcher = typeof fetch;

async function responseError(response: Response): Promise<string> {
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  const error = payload?.error && typeof payload.error === "object" ? payload.error as Record<string, unknown> : null;
  return safeErrorMessage(error?.message || payload?.message, `Provider returned ${response.status}.`);
}

export class GroqProvider implements ModelProvider {
  readonly name = "groq";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model: string, fetcher: Fetcher = fetch, timeoutMs = 18_000) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  complete(request: ProviderRequest): Promise<ProviderResult> {
    return this.send(request, false);
  }

  completeStructured(request: StructuredProviderRequest): Promise<ProviderResult> {
    return this.send(request, true);
  }

  private async send(request: ProviderRequest, structured: boolean): Promise<ProviderResult> {
    if (!this.apiKey || !this.model) throw new AssistantError("provider_unavailable", "The primary AI provider is not configured.", 503);
    const response = await this.fetcher("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        messages: request.messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...(structured ? { response_format: { type: "json_object" } } : {}),
      }),
    });
    if (!response.ok) throw new AssistantError("provider_unavailable", await responseError(response), 502);
    return validateProviderPayload(await response.json(), this.name, this.model);
  }
}

export class OpenAiResponsesProvider implements ModelProvider {
  readonly name = "openai";
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(apiKey: string, model: string, fetcher: Fetcher = fetch, timeoutMs = 20_000) {
    this.apiKey = apiKey;
    this.model = model;
    this.fetcher = fetcher;
    this.timeoutMs = timeoutMs;
  }

  complete(request: ProviderRequest): Promise<ProviderResult> {
    return this.send(request);
  }

  completeStructured(request: StructuredProviderRequest): Promise<ProviderResult> {
    return this.send(request, {
      format: {
        type: "json_schema",
        name: request.schemaName,
        strict: true,
        schema: request.schema,
      },
    });
  }

  private async send(request: ProviderRequest, text?: Record<string, unknown>): Promise<ProviderResult> {
    if (!this.apiKey || !this.model) throw new AssistantError("provider_unavailable", "The fallback AI provider is not configured.", 503);
    const response = await this.fetcher("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
      body: JSON.stringify({
        model: this.model,
        input: request.messages,
        max_output_tokens: request.maxTokens,
        ...(text ? { text } : {}),
      }),
    });
    if (!response.ok) throw new AssistantError("provider_unavailable", await responseError(response), 502);
    return validateProviderPayload(await response.json(), this.name, this.model);
  }
}

export function createProviderChain(env: AssistantEnvironment, fetcher: Fetcher = fetch, timeoutMs?: number): ModelProvider[] {
  const providers: ModelProvider[] = [];
  const groqKey = String(env.GROQ_API_KEY || "").trim();
  const primaryModel = String(env.GROQ_ASSISTANT_MODEL || env.GROQ_ASK_MODEL || "openai/gpt-oss-120b").trim();
  if (groqKey && primaryModel) providers.push(new GroqProvider(groqKey, primaryModel, fetcher, timeoutMs));
  const openAiKey = String(env.OPENAI_API_KEY || "").trim();
  const openAiModel = String(env.OPENAI_ASSISTANT_MODEL || "").trim();
  if (openAiKey && openAiModel) providers.push(new OpenAiResponsesProvider(openAiKey, openAiModel, fetcher, timeoutMs));
  const fallbackGroqModel = String(env.GROQ_FALLBACK_MODEL || "").trim();
  if (groqKey && fallbackGroqModel && fallbackGroqModel !== primaryModel) providers.push(new GroqProvider(groqKey, fallbackGroqModel, fetcher, timeoutMs));
  return providers;
}

export async function completeWithFallback(
  providers: ModelProvider[],
  request: ProviderRequest,
): Promise<{ result: ProviderResult | null; providerIndex: number; warnings: string[] }> {
  const warnings: string[] = [];
  for (let index = 0; index < providers.length; index += 1) {
    try {
      return { result: await providers[index]!.complete(request), providerIndex: index, warnings };
    } catch (error) {
      warnings.push(`${providers[index]!.name}: ${safeErrorMessage(error, "unavailable")}`);
    }
  }
  return { result: null, providerIndex: -1, warnings };
}
