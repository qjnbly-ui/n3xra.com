type Item = { id?: string; type?: string; phase?: string; text?: string; command?: string; aggregatedOutput?: string; exitCode?: number; changes?: unknown };

export const conversationSchema = {
  type: "object",
  properties: {
    message: { type: "string", description: "A clear, short reply to the website owner in everyday language. Explain the result, limitations, and any action they need to take. No logs, paths, commands, or implementation details." },
    technicalNotes: { type: "string", description: "Developer diagnostics: files, checks, errors, and implementation details. Never include credentials or secrets. Empty string if none." },
  },
  required: ["message", "technicalNotes"],
  additionalProperties: false,
};

export function redactNotes(text: string): string {
  let safe = text;
  for (const [name, value] of Object.entries(process.env)) {
    if (/TOKEN|SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY/.test(name) && value && value.length >= 8) safe = safe.split(value).join("[redacted]");
  }
  return safe.replace(/([?&](?:token|code|secret)=)[^\s&"']+/gi, "$1[redacted]")
    .replace(/\bBearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, "[redacted]")
    .slice(-32_000);
}

export function readableError(detail: string): string {
  if (/sign.in|authenticat|token.*expired/i.test(detail)) return "Your connection needs attention. Reconnect your account, then try again.";
  if (/Another astro dev server|preview/i.test(detail)) return "The live preview couldn’t start. Try restarting the preview. Technical notes contain the details.";
  if (/git.*author|commit.*identity|verified.*identity/i.test(detail)) return "Saving needs a connected GitHub identity. The administrator needs to check the builder’s GitHub settings.";
  if (/disconnect|interrupt/i.test(detail)) return "The builder was disconnected before finishing. Check the preview and your changes before trying again.";
  return "Build Studio couldn’t finish this step. Check your changes before trying again. Technical notes contain the details.";
}

// Keep only public agent messages and bounded tool diagnostics, never reasoning items.
export class ConversationTurn {
  private messages = new Map<string, { text: string; phase?: string }>();
  private notes: string[] = [];
  delta(id: string, text: string) {
    const entry = this.messages.get(id) || { text: "" };
    entry.text = (entry.text + text).slice(-32_000);
    this.messages.set(id, entry);
    if (this.messages.size > 100) this.messages.delete(this.messages.keys().next().value!);
  }
  item(item: Item, completed: boolean): string | undefined {
    if (item.type === "agentMessage") {
      const entry = this.messages.get(String(item.id)) || { text: "" };
      if (item.phase) entry.phase = item.phase;
      if (completed && typeof item.text === "string") entry.text = item.text.slice(-32_000);
      this.messages.set(String(item.id), entry);
      return item.phase === "final_answer" ? "Preparing your reply…" : "Working through your request…";
    }
    if (completed && ["commandExecution", "fileChange"].includes(String(item.type))) {
      this.notes.push(redactNotes(JSON.stringify({ type: item.type, command: item.command, output: item.aggregatedOutput, exitCode: item.exitCode, changes: item.changes }).slice(-6000)));
      if (this.notes.length > 30) this.notes.shift();
    }
    return ({ commandExecution: "Checking the website…", fileChange: "Updating the website…", webSearch: "Looking up information…", mcpToolCall: "Working with the connected tools…", contextCompaction: "Organizing the conversation so I can continue…" } as Record<string, string>)[String(item.type)];
  }
  finish(failure?: string) {
    const entries = [...this.messages.values()];
    const final = entries.filter(item => item.phase === "final_answer").at(-1) || entries.filter(item => item.phase !== "commentary").at(-1);
    const raw = final?.text || "";
    let message = "The builder finished without a readable reply. Check the preview and your changes before continuing.";
    let detail = raw;
    try {
      const result = JSON.parse(raw);
      if (typeof result.message === "string" && result.message.trim() && typeof result.technicalNotes === "string") {
        message = redactNotes(result.message);
        detail = result.technicalNotes;
      }
    } catch { /* Preserve malformed replies in diagnostics instead of showing raw JSON/logs. */ }
    const technicalNotes = redactNotes([...this.notes, ...entries.filter(item => item !== final).map(item => item.text), detail, failure || ""].filter(Boolean).join("\n\n"));
    return { message: failure ? readableError(failure) : message, technicalNotes };
  }
}
