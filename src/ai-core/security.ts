const SECRET_TOKEN = /\b(?:sk[-_]|gsk_|sb_secret_)[A-Za-z0-9_-]{12,}\b/g;
const JWT_TOKEN = /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{8,}\b/g;
const SECRET_ASSIGNMENT = /((?:api[_-]?key|secret|password|service[_-]?role(?:[_-]?key)?)["'\s:=]+)["']?[^"'\s,;]{8,}/gi;

export function redactSensitiveText(value: string, maxLength = 20_000): string {
  return String(value || "")
    .slice(0, Math.max(0, maxLength))
    .replace(SECRET_TOKEN, "[REDACTED_SECRET]")
    .replace(JWT_TOKEN, "[REDACTED_TOKEN]")
    .replace(SECRET_ASSIGNMENT, "$1[REDACTED]");
}

export function safeErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : fallback;
  const redacted = redactSensitiveText(message, 500).replace(/[\r\n]+/g, " ").trim();
  return redacted || fallback;
}

export function redactWarnings(warnings: string[]): string[] {
  return warnings.map((warning) => redactSensitiveText(warning, 500));
}
