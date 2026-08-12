import { AssistantError, type Capability, type SessionIdentity, type ToolResult } from "./contracts";
import type { AssistantEnvironment } from "./auth";
import { redactWarnings, safeErrorMessage } from "./security";

type Fetcher = typeof fetch;
type JsonRecord = Record<string, unknown>;

export interface LoadPayload<T> {
  data: T;
  warnings?: string[];
}

type CacheEntry<T> = { data: T; recordedAt: string };

export class ReliableLoader {
  private readonly cache = new Map<string, CacheEntry<unknown>>();
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  async load<T>(
    key: string,
    capability: Capability,
    producer: (signal: AbortSignal) => Promise<LoadPayload<T>>,
    options: { timeoutMs?: number; retries?: number; maxCacheAgeMs?: number } = {},
  ): Promise<ToolResult<T>> {
    const timeoutMs = options.timeoutMs ?? 5_000;
    const retries = options.retries ?? 1;
    let lastError = "Live data could not be loaded.";
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const payload = await producer(AbortSignal.timeout(timeoutMs));
        const fetchedAt = this.now().toISOString();
        const warnings = redactWarnings(payload.warnings || []);
        if (!warnings.length) this.cache.set(key, { data: payload.data, recordedAt: fetchedAt });
        return {
          capability,
          status: warnings.length ? "partial" : "current",
          data: payload.data,
          fetchedAt,
          recordedAt: null,
          freshnessSeconds: 0,
          warnings,
        };
      } catch (error) {
        lastError = safeErrorMessage(error, lastError);
      }
    }
    const cached = this.cache.get(key) as CacheEntry<T> | undefined;
    const maxCacheAgeMs = options.maxCacheAgeMs ?? 24 * 60 * 60 * 1000;
    if (cached) {
      const ageMs = Math.max(0, this.now().getTime() - new Date(cached.recordedAt).getTime());
      if (ageMs <= maxCacheAgeMs) {
        return {
          capability,
          status: "cached",
          data: cached.data,
          fetchedAt: null,
          recordedAt: cached.recordedAt,
          freshnessSeconds: Math.round(ageMs / 1_000),
          warnings: [`Live data was unavailable: ${lastError}`],
        };
      }
    }
    return {
      capability,
      status: "unavailable",
      data: null,
      fetchedAt: null,
      recordedAt: null,
      freshnessSeconds: null,
      warnings: [lastError],
    };
  }
}

class SupabaseRestClient {
  private readonly baseUrl: string;
  private readonly serviceKey: string;
  private readonly fetcher: Fetcher;

  constructor(env: AssistantEnvironment, fetcher: Fetcher) {
    this.baseUrl = String(env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || "https://vdbjlgmbpykjblprqnak.supabase.co").replace(/\/+$/, "");
    this.serviceKey = String(env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY || env.SERVICE_ROLE_KEY || "").trim();
    this.fetcher = fetcher;
    if (!this.serviceKey) throw new AssistantError("live_data_unavailable", "Admin data access is not configured.", 503);
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      apikey: this.serviceKey,
      ...(this.serviceKey.startsWith("sb_secret_") ? {} : { Authorization: `Bearer ${this.serviceKey}` }),
      Accept: "application/json",
      ...extra,
    };
  }

  async rows(table: string, select: string, query: string, signal: AbortSignal): Promise<JsonRecord[]> {
    const response = await this.fetcher(`${this.baseUrl}/rest/v1/${table}?select=${encodeURIComponent(select)}${query ? `&${query}` : ""}`, {
      headers: this.headers(),
      signal,
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok || !Array.isArray(payload)) {
      const message = payload && typeof payload === "object" ? String((payload as JsonRecord).message || (payload as JsonRecord).error || "") : "";
      throw new Error(message || `${table} returned ${response.status}.`);
    }
    return payload as JsonRecord[];
  }

  async count(table: string, query: string, signal: AbortSignal): Promise<number> {
    const response = await this.fetcher(`${this.baseUrl}/rest/v1/${table}?select=id${query ? `&${query}` : ""}&limit=1`, {
      headers: this.headers({
        Prefer: "count=exact",
        Range: "0-0",
      }),
      signal,
    });
    if (!response.ok) throw new Error(`${table} count returned ${response.status}.`);
    const range = response.headers.get("content-range") || "";
    const total = Number(range.split("/")[1]);
    if (!Number.isFinite(total)) throw new Error(`${table} did not return an exact count.`);
    return total;
  }
}

async function partialObject(
  entries: Record<string, () => Promise<unknown>>,
): Promise<LoadPayload<Record<string, unknown>>> {
  const result: Record<string, unknown> = {};
  const warnings: string[] = [];
  await Promise.all(Object.entries(entries).map(async ([key, load]) => {
    try {
      result[key] = await load();
    } catch (error) {
      warnings.push(`${key}: ${safeErrorMessage(error, "unavailable")}`);
    }
  }));
  if (!Object.keys(result).length) throw new Error(warnings.join(" ") || "All live data sources were unavailable.");
  return { data: result, warnings };
}

export class AdminDataSource {
  private readonly client: SupabaseRestClient;
  private readonly reliable: ReliableLoader;

  constructor(env: AssistantEnvironment, options: { fetcher?: Fetcher; loader?: ReliableLoader } = {}) {
    this.client = new SupabaseRestClient(env, options.fetcher ?? fetch);
    this.reliable = options.loader ?? new ReliableLoader();
  }

  async load(capability: Capability, identity: SessionIdentity): Promise<ToolResult<Record<string, unknown>>> {
    if (!identity.user) return this.unavailable(capability, "Sign in to load account data.");
    if (capability.startsWith("admin_") && identity.audience !== "admin") {
      return this.unavailable(capability, "Active platform administrator access is required.");
    }
    const key = `${identity.user.id}:${capability}`;
    return this.reliable.load(key, capability, (signal) => this.loadCapability(capability, identity, signal), { retries: 1, timeoutMs: 5_000 });
  }

  private unavailable(capability: Capability, warning: string): ToolResult<Record<string, unknown>> {
    return { capability, status: "unavailable", data: null, fetchedAt: null, recordedAt: null, freshnessSeconds: null, warnings: [warning] };
  }

  private async loadCapability(capability: Capability, identity: SessionIdentity, signal: AbortSignal): Promise<LoadPayload<Record<string, unknown>>> {
    switch (capability) {
      case "account":
        return partialObject({
          profile: async () => (await this.client.rows("profiles", "id,email,full_name,organization_name,role,subscription_tier,account_status,subscription_current_period_end,updated_at", `id=eq.${encodeURIComponent(identity.user!.id)}&limit=1`, signal))[0] || null,
          organizations: () => this.client.rows("organization_memberships", "organization_id,role,status,created_at", `user_id=eq.${encodeURIComponent(identity.user!.id)}&limit=25`, signal),
        });
      case "admin_overview":
        return partialObject({
          accounts: () => this.client.count("profiles", "", signal),
          openSupport: () => this.client.count("platform_support_requests", "status=not.in.(resolved,closed)", signal),
          careerApplications: () => this.client.count("careers_applications", "", signal),
          partnerApplications: () => this.client.count("founding_partner_applications", "", signal),
          creatorApplications: () => this.client.count("virals_creator_applications", "", signal),
          websiteRequests: () => this.client.count("website_service_requests", "", signal),
          activeWebsiteProjects: () => this.client.count("website_projects", "status=not.in.(completed,cancelled)", signal),
          unreadNotifications: () => this.client.count("admin_notifications", "read_at=is.null&archived_at=is.null&deleted_at=is.null", signal),
        });
      case "admin_accounts":
        return partialObject({
          total: () => this.client.count("profiles", "", signal),
          recent: () => this.client.rows("profiles", "id,email,full_name,organization_name,role,subscription_tier,account_status,created_at,updated_at", "order=created_at.desc&limit=25", signal),
        });
      case "admin_applications":
        return partialObject({
          careers: () => this.client.rows("careers_applications", "id,full_name,email,role_interest,status,created_at,updated_at", "order=created_at.desc&limit=25", signal),
          partners: () => this.client.rows("founding_partner_applications", "id,full_name,email,organization,status,created_at,updated_at", "order=created_at.desc&limit=25", signal),
          creators: () => this.client.rows("virals_creator_applications", "id,display_name,email,tiktok_username,status,created_at,updated_at", "order=created_at.desc&limit=25", signal),
        });
      case "admin_support":
        return partialObject({
          open: () => this.client.rows("platform_support_requests", "id,requester_name,requester_email,organization_name,topic,subject,status,priority,created_at,updated_at", "status=not.in.(resolved,closed)&order=created_at.desc&limit=25", signal),
        });
      case "admin_notifications":
        return partialObject({
          unread: () => this.client.rows("admin_notifications", "id,event_type,product,priority,title,summary,action_url,read_at,created_at", "read_at=is.null&archived_at=is.null&deleted_at=is.null&order=created_at.desc&limit=25", signal),
        });
      case "admin_websites":
        return partialObject({
          requests: () => this.client.rows("website_service_requests", "id,contact_name,business_name,project_type,status,service_plan,created_at,updated_at", "order=created_at.desc&limit=20", signal),
          proposals: () => this.client.rows("website_proposals", "id,title,status,sent_at,decided_at,created_at,updated_at", "order=created_at.desc&limit=20", signal),
          projects: () => this.client.rows("website_projects", "id,name,status,current_stage,progress_percent,target_launch_date,admin_next_step,created_at,updated_at", "order=created_at.desc&limit=20", signal),
          websites: () => this.client.rows("client_websites", "id,name,live_url,status,portal_enabled,created_at,updated_at", "order=created_at.desc&limit=20", signal),
        });
      case "admin_billing":
        return partialObject({
          subscriptions: () => this.client.rows("website_subscriptions", "id,service_plan,billing_interval,amount_cents,status,current_period_end,cancel_at_period_end,created_at,updated_at", "order=created_at.desc&limit=25", signal),
          websiteInvoices: () => this.client.rows("website_invoices", "id,status,currency,total_cents,amount_due_cents,amount_paid_cents,due_at,paid_at,created_at,updated_at", "order=created_at.desc&limit=25", signal),
          operationsInvoices: () => this.client.rows("operations_invoices", "id,invoice_number,total_cents,status,issue_date,due_date,created_at,updated_at", "order=created_at.desc&limit=25", signal),
        });
      case "admin_operations":
        return partialObject({
          parties: () => this.client.rows("operations_parties", "id,party_type,name,email,status,created_at,updated_at", "order=created_at.desc&limit=20", signal),
          projects: () => this.client.rows("operations_projects", "id,name,status,started_on,completed_on,created_at,updated_at", "order=created_at.desc&limit=20", signal),
          invoices: () => this.client.rows("operations_invoices", "id,invoice_number,total_cents,status,issue_date,due_date,created_at,updated_at", "order=created_at.desc&limit=20", signal),
          transactions: () => this.client.rows("operations_transactions", "id,transaction_type,transaction_date,amount_cents,status,category,description,created_at,updated_at", "order=transaction_date.desc&limit=20", signal),
        });
      case "admin_analytics":
        throw new Error("Live Vercel Analytics requires the deployment analytics credentials and is not yet connected to the shared assistant.");
      default:
        throw new Error(`The ${capability} capability does not use live admin data.`);
    }
  }
}

export { partialObject };
