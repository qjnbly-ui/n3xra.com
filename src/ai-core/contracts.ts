export const CAPABILITIES = [
  "public_site",
  "current_page",
  "account",
  "admin_overview",
  "admin_accounts",
  "admin_applications",
  "admin_support",
  "admin_notifications",
  "admin_websites",
  "admin_billing",
  "admin_operations",
  "admin_analytics",
  "admin_action",
  "records_handoff",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type Audience = "public" | "account" | "admin";
export type DataStatus = "current" | "cached" | "partial" | "unavailable";
export type AnswerSource = "live" | "cache" | "primary_ai" | "fallback_ai" | "local";
export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
}

export interface PageContext {
  path: string;
  title: string;
  description?: string;
  adminView?: string;
}

export interface AssistantRequest {
  question: string;
  conversationId: string;
  history: ConversationMessage[];
  page: PageContext;
}

export interface Intent {
  capability: Capability;
  confidence: number;
  entities: Record<string, string>;
  requiresLiveData: boolean;
  requiresAdmin: boolean;
  requiresConfirmation: boolean;
  reason: string;
}

export interface ToolResult<T = unknown> {
  capability: Capability;
  status: DataStatus;
  data: T | null;
  fetchedAt: string | null;
  recordedAt: string | null;
  freshnessSeconds: number | null;
  warnings: string[];
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
}

export interface SessionIdentity {
  audience: Audience;
  user: AuthenticatedUser | null;
  adminRole: string | null;
}

export interface ConversationSession {
  id: string;
  ownerKey: string;
  identity: SessionIdentity;
  page: PageContext;
  history: ConversationMessage[];
  createdAt: string;
  updatedAt: string;
}

export type ActionStage = "idle" | "proposed" | "awaiting_confirmation" | "executing" | "completed" | "cancelled" | "failed";

export interface ActionState {
  id: string;
  kind: string;
  stage: ActionStage;
  summary: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderMessage {
  role: "system" | MessageRole;
  content: string;
}

export interface ProviderRequest {
  messages: ProviderMessage[];
  maxTokens: number;
  temperature: number;
}

export interface StructuredProviderRequest extends ProviderRequest {
  schemaName: string;
  schema: Record<string, unknown>;
}

export interface ProviderResult {
  text: string;
  provider: string;
  model: string;
}

export interface ModelProvider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResult>;
  completeStructured(request: StructuredProviderRequest): Promise<ProviderResult>;
}

export interface AssistantResponse {
  answer: string;
  audience: Audience;
  capability: Capability;
  source: AnswerSource;
  dataStatus: DataStatus | null;
  freshness: string | null;
  conversationId: string;
  warnings: string[];
}

export type ErrorCode = "invalid_request" | "unauthorized" | "forbidden" | "rate_limited" | "live_data_unavailable" | "provider_unavailable" | "protocol_error" | "internal_error";

export class AssistantError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AssistantError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
