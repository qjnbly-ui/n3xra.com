import { AssistantError, type SessionIdentity } from "./contracts";

export interface AssistantEnvironment {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SERVICE_ROLE_KEY?: string;
  GROQ_API_KEY?: string;
  GROQ_ASK_MODEL?: string;
  GROQ_ASSISTANT_MODEL?: string;
  GROQ_FALLBACK_MODEL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_ASSISTANT_MODEL?: string;
  [key: string]: string | undefined;
}

type Fetcher = typeof fetch;

function bearerToken(value: string | string[] | undefined): string {
  const header = Array.isArray(value) ? value[0] || "" : value || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function withTimeout(timeoutMs: number): AbortSignal {
  return AbortSignal.timeout(Math.max(100, timeoutMs));
}

function elevatedHeaders(key: string): Record<string, string> {
  return key.startsWith("sb_secret_")
    ? { apikey: key, Accept: "application/json" }
    : { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" };
}

export function getAuthorizationToken(headers: Record<string, string | string[] | undefined>): string {
  return bearerToken(headers.authorization || headers.Authorization);
}

export class IdentityResolver {
  private readonly env: AssistantEnvironment;
  private readonly fetcher: Fetcher;
  private readonly timeoutMs: number;

  constructor(env: AssistantEnvironment, options: { fetcher?: Fetcher; timeoutMs?: number } = {}) {
    this.env = env;
    this.fetcher = options.fetcher ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 5_000;
  }

  async resolve(token: string): Promise<SessionIdentity> {
    if (!token) return { audience: "public", user: null, adminRole: null };
    const supabaseUrl = String(this.env.SUPABASE_URL || this.env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
    const publishableKey = String(this.env.SUPABASE_ANON_KEY || this.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
    if (!publishableKey) throw new AssistantError("unauthorized", "Account verification is not configured.", 401);
    const response = await this.fetcher(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
      signal: withTimeout(this.timeoutMs),
    });
    const rawUser = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok || !rawUser?.id) throw new AssistantError("unauthorized", "Your session is no longer valid.", 401);
    const email = String(rawUser.email || "").trim();
    const metadata = rawUser.user_metadata && typeof rawUser.user_metadata === "object"
      ? rawUser.user_metadata as Record<string, unknown>
      : {};
    const user = {
      id: String(rawUser.id),
      email,
      displayName: String(metadata.full_name || metadata.name || email.split("@")[0] || "Account user").trim(),
    };
    const serviceKey = String(this.env.SUPABASE_SECRET_KEY || this.env.SUPABASE_SERVICE_ROLE_KEY || this.env.SERVICE_ROLE_KEY || "").trim();
    if (!serviceKey) return { audience: "account", user, adminRole: null };
    const adminResponse = await this.fetcher(
      `${supabaseUrl}/rest/v1/platform_admins?select=role,status,access_scope&user_id=eq.${encodeURIComponent(user.id)}&status=eq.active&limit=1`,
      {
        headers: elevatedHeaders(serviceKey),
        signal: withTimeout(this.timeoutMs),
      },
    );
    const admins = await adminResponse.json().catch(() => []) as Array<Record<string, unknown>>;
    const role = adminResponse.ok ? String(admins[0]?.role || "").toLowerCase() : "";
    const accessScope = adminResponse.ok ? String(admins[0]?.access_scope || "full").toLowerCase() : "";
    const isAdmin = ["owner", "admin"].includes(role) && accessScope === "full";
    return { audience: isAdmin ? "admin" : "account", user, adminRole: isAdmin ? role : null };
  }
}
