import {
  AssistantError,
  type ActionStage,
  type ActionState,
  type AssistantRequest,
  type ConversationMessage,
  type ConversationSession,
  type SessionIdentity,
} from "./contracts";

const ACTION_TRANSITIONS: Record<ActionStage, readonly ActionStage[]> = {
  idle: ["proposed"],
  proposed: ["awaiting_confirmation", "cancelled"],
  awaiting_confirmation: ["executing", "cancelled"],
  executing: ["completed", "failed"],
  completed: [],
  cancelled: [],
  failed: [],
};

export function transitionAction(action: ActionState, next: ActionStage, now = new Date()): ActionState {
  if (!ACTION_TRANSITIONS[action.stage].includes(next)) {
    throw new AssistantError("invalid_request", `Action cannot move from ${action.stage} to ${next}.`, 409);
  }
  return { ...action, stage: next, updatedAt: now.toISOString() };
}

export class ConversationStateStore {
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly ttlMs: number;
  private readonly now: () => Date;

  constructor(options: { ttlMs?: number; now?: () => Date } = {}) {
    this.ttlMs = options.ttlMs ?? 30 * 60 * 1000;
    this.now = options.now ?? (() => new Date());
  }

  getOrCreate(request: AssistantRequest, identity: SessionIdentity): ConversationSession {
    this.prune();
    const ownerKey = identity.user?.id || "public";
    const storageKey = `${ownerKey}:${request.conversationId}`;
    const existing = this.sessions.get(storageKey);
    const now = this.now().toISOString();
    if (existing) {
      existing.identity = identity;
      existing.page = request.page;
      existing.history = this.normalizeHistory(request.history.length ? request.history : existing.history);
      existing.updatedAt = now;
      return existing;
    }
    const session: ConversationSession = {
      id: request.conversationId,
      ownerKey,
      identity,
      page: request.page,
      history: this.normalizeHistory(request.history),
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(storageKey, session);
    return session;
  }

  append(session: ConversationSession, messages: ConversationMessage[]): void {
    session.history = this.normalizeHistory([...session.history, ...messages]);
    session.updatedAt = this.now().toISOString();
  }

  size(): number {
    this.prune();
    return this.sessions.size;
  }

  private normalizeHistory(messages: ConversationMessage[]): ConversationMessage[] {
    return messages.slice(-12).map((message) => ({ role: message.role, content: message.content.slice(0, 1_600) }));
  }

  private prune(): void {
    const threshold = this.now().getTime() - this.ttlMs;
    for (const [key, value] of this.sessions) {
      if (new Date(value.updatedAt).getTime() < threshold) this.sessions.delete(key);
    }
  }
}
