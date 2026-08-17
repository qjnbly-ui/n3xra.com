import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { AssistantError } from "./contracts";
import type { AssistantEnvironment } from "./auth";

type HeaderValue = string | string[] | undefined;
type RequestLike = { headers: Record<string, HeaderValue> };
type Fetcher = typeof fetch;
type GrantPayload = { v: 1; id: string; exp: number };

const COOKIE_NAME = "n3xra_ask_grant";
const GRANT_TTL_SECONDS = 8 * 60 * 60;

function headerValue(value: HeaderValue): string {
  return Array.isArray(value) ? value[0] || "" : value || "";
}

function clientIp(request: RequestLike): string {
  return headerValue(request.headers["x-forwarded-for"]).split(",")[0]!.trim() || "unknown";
}

function cookieValue(request: RequestLike, name: string): string {
  const cookie = headerValue(request.headers.cookie);
  for (const part of cookie.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return "";
}

function grantSecret(env: AssistantEnvironment): string {
  return String(env.ASK_AI_GRANT_SECRET || env.TURNSTILE_SECRET_KEY || env.CLOUDFLARE_TURNSTILE_SECRET_KEY || "").trim();
}

function turnstileSecret(env: AssistantEnvironment): string {
  return String(env.TURNSTILE_SECRET_KEY || env.CLOUDFLARE_TURNSTILE_SECRET_KEY || "").trim();
}

function sign(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function createGrant(env: AssistantEnvironment, now: () => number, id = randomUUID()): string {
  const secret = grantSecret(env);
  if (!secret) throw new AssistantError("provider_unavailable", "Public AI security is not configured.", 503);
  const payload: GrantPayload = { v: 1, id, exp: Math.floor(now() / 1000) + GRANT_TTL_SECONDS };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, secret)}`;
}

function readGrant(request: RequestLike, env: AssistantEnvironment, now: () => number): GrantPayload | null {
  const secret = grantSecret(env);
  const raw = cookieValue(request, COOKIE_NAME);
  if (!secret || !raw) return null;
  const [encoded = "", signature = ""] = raw.split(".");
  if (!encoded || !signature || !safeEqual(signature, sign(encoded, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as GrantPayload;
    if (payload.v !== 1 || !/^[0-9a-f-]{36}$/i.test(payload.id) || payload.exp <= Math.floor(now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

function serviceHeaders(key: string): Record<string, string> {
  return key.startsWith("sb_secret_")
    ? { apikey: key, "Content-Type": "application/json" }
    : { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

async function consumeLimit(
  env: AssistantEnvironment,
  fetcher: Fetcher,
  scope: string,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const supabaseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
  const serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || "").trim();
  if (!serviceKey) throw new AssistantError("provider_unavailable", "Public AI rate limiting is not configured.", 503);
  const keyHash = createHash("sha256").update(`${scope}:${key}`).digest("hex");
  const response = await fetcher(`${supabaseUrl}/rest/v1/rpc/consume_public_ai_rate_limit`, {
    method: "POST",
    headers: serviceHeaders(serviceKey),
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({ input_scope: scope, input_key_hash: keyHash, input_limit: limit, input_window_seconds: windowSeconds }),
  });
  if (!response.ok) throw new AssistantError("provider_unavailable", "Public AI usage controls are temporarily unavailable.", 503);
  return (await response.json().catch(() => false)) === true;
}

export function createPublicAiSecurity(options: { env?: AssistantEnvironment; fetcher?: Fetcher; now?: () => number } = {}) {
  const env = options.env || process.env;
  const fetcher = options.fetcher || fetch;
  const now = options.now || (() => Date.now());

  return {
    hasGrant(request: RequestLike): boolean {
      return Boolean(readGrant(request, env, now));
    },

    async verifyChallenge(token: string, request: RequestLike): Promise<string> {
      const secret = turnstileSecret(env);
      if (!secret) throw new AssistantError("provider_unavailable", "Public AI security is not configured.", 503);
      if (!token) throw new AssistantError("security_required", "Complete the security check to use Ask N3XRA.", 403);
      const body = new URLSearchParams({ secret, response: token, remoteip: clientIp(request) });
      const response = await fetcher("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(8_000),
        body,
      });
      const result = await response.json().catch(() => ({})) as { success?: boolean; action?: string };
      if (!response.ok || result.success !== true || result.action !== "ask-ai") {
        throw new AssistantError("security_required", "The security check expired. Please try again.", 403);
      }
      return createGrant(env, now);
    },

    cookie(grant: string): string {
      return `${COOKIE_NAME}=${encodeURIComponent(grant)}; Path=/api/; HttpOnly; Secure; SameSite=Lax`;
    },

    async requireAccess(request: RequestLike, scope = "ask"): Promise<void> {
      const grant = readGrant(request, env, now);
      if (!grant) throw new AssistantError("security_required", "A quick security check is required to use Ask N3XRA.", 403);
      const [sessionAllowed, addressAllowed] = await Promise.all([
        consumeLimit(env, fetcher, scope, `grant:${grant.id}`, 8, 60 * 60),
        consumeLimit(env, fetcher, scope, `ip:${clientIp(request)}`, 20, 60 * 60),
      ]);
      if (!sessionAllowed || !addressAllowed) {
        throw new AssistantError("rate_limited", "Ask N3XRA has reached its hourly limit for this session. Please try again later.", 429);
      }
    },
  };
}

export const publicAiSecurity = createPublicAiSecurity();
